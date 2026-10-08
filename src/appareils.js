// Appareils reliés : l'extension de navigateur lit le coffre avec un jeton à
// elle, jamais avec la session du site. Ce jeton ne donne que ce que le
// serveur garde, c'est-à-dire du chiffré : le coffre ne s'ouvre qu'avec le
// mot de passe maître, dans l'extension.
//
//   - un jeton naît sous renfort, se montre une fois, n'est gardé qu'haché ;
//   - il ne lit que deux routes, en GET, et n'écrit rien ;
//   - il tombe après 30 jours sans servir, 180 jours au plus, à la demande,
//     et avec toutes les sessions du compte (« ce n'était pas moi »,
//     réinitialisation, changement de rôle, désactivation, incident).
import crypto from 'node:crypto';

export const PREFIXE = 'cvd_';
const JETON = /^cvd_[A-Za-z0-9_-]{43}$/;
export const INACTIVITE_MS = 30 * 864e5;
export const DUREE_MS = 180 * 864e5;
export const MAX_PAR_COMPTE = 10;
const VU_PAS_MS = 60e3;

const empreinte = jeton => crypto.createHash('sha256').update(jeton).digest('hex');
const b64u = n => crypto.randomBytes(n).toString('base64url');

export class Appareils {
  constructor(db, { maintenant = () => Date.now() } = {}) {
    this.db = db;
    this.maintenant = maintenant;
  }

  purger() {
    const t = this.maintenant();
    this.db.prepare('DELETE FROM appareils WHERE expire <= ? OR vu <= ?').run(t, t - INACTIVITE_MS);
  }

  /** Un appareil neuf : le jeton n'existe en clair que dans cette réponse. */
  relier(compte, nom) {
    this.purger();
    const { n } = this.db.prepare('SELECT count(*) n FROM appareils WHERE compte = ?').get(compte);
    if (n >= MAX_PAR_COMPTE) return null;
    const t = this.maintenant();
    const id = b64u(16), jeton = PREFIXE + b64u(32);
    this.db.prepare('INSERT INTO appareils(id, compte, nom, empreinte, cree, vu, expire) VALUES(?, ?, ?, ?, ?, ?, ?)')
      .run(id, compte, nom, empreinte(jeton), t, t, t + DUREE_MS);
    return { id, jeton };
  }

  lister(compte) {
    this.purger();
    return this.db.prepare('SELECT id, nom, cree, vu, expire FROM appareils WHERE compte = ? ORDER BY cree DESC').all(compte)
      .map(a => ({ ...a, expire: Math.min(a.expire, a.vu + INACTIVITE_MS) }));
  }

  retirer(compte, id) { return this.db.prepare('DELETE FROM appareils WHERE compte = ? AND id = ?').run(compte, id).changes > 0; }
  retirerTout(compte) { return this.db.prepare('DELETE FROM appareils WHERE compte = ?').run(compte).changes; }
  retirerTousComptes() { return this.db.prepare('DELETE FROM appareils').run().changes; }

  /** L'appareil d'un en-tête Authorization, ou null (absent, malformé, inconnu, expiré). */
  authentifier(entete) {
    const m = /^Bearer (\S+)$/.exec(String(entete || ''));
    if (!m || !JETON.test(m[1])) return null;
    const a = this.db.prepare('SELECT id, compte, nom, vu, expire FROM appareils WHERE empreinte = ?').get(empreinte(m[1]));
    if (!a) return null;
    const t = this.maintenant();
    if (a.expire <= t || a.vu <= t - INACTIVITE_MS) {
      this.db.prepare('DELETE FROM appareils WHERE id = ?').run(a.id);
      return null;
    }
    if (t - a.vu > VU_PAS_MS) this.db.prepare('UPDATE appareils SET vu = ? WHERE id = ?').run(t, a.id);
    return { id: a.id, compte: a.compte, nom: a.nom };
  }
}

/** Le code à coller dans l'extension : l'adresse du serveur et le jeton, d'un seul bloc. */
export const codeDeLiaison = (origine, jeton) => `CV1.${Buffer.from(origine).toString('base64url')}.${jeton}`;
