// Routes de CODVAULT. Le serveur ne voit que du chiffré : il range, il vérifie
// qui a le droit de lire ou d'écrire quel bloc, il ne peut rien ouvrir.
//
//   - lecture : son coffre, ses éléments et ceux qu'on lui partage ;
//   - membre : écrire ses éléments, partager les siens ;
//   - un partage en « écriture » permet de modifier l'élément, jamais de le
//     supprimer ni de le repartager ;
//   - changer de mot de passe maître, lire la clé de récupération chiffrée,
//     refaire la clé de récupération, relier un appareil : sous renfort du socle ;
//   - un appareil relié (l'extension) lit son coffre et ses éléments, chiffrés,
//     avec son propre jeton : deux routes en lecture, rien d'autre.
//
// Aucun jeton de service : ni le Hub ni un autre service n'ont de route ici.
import { ErreurHttp, Routeur, lireCorps, valider, repondreJson } from '../socle/src/index.js';
import { effacerCompte } from './base.js';
import { Appareils, MAX_PAR_COMPTE, codeDeLiaison } from './appareils.js';
import { DOMAINE } from './logos.js';
import { VERSION } from './config.js';

const ID = /^[A-Za-z0-9_-]{22}$/;
const B64 = '[A-Za-z0-9_-]';
const BLOC = (min, max) => new RegExp(`^v1\\.${B64}{16}\\.${B64}{${min},${max}}$`);
const CLE_ENVELOPPEE = BLOC(64, 64);                                   // 32 octets + étiquette
const CLE_PARTAGEE = new RegExp(`^e1\\.${B64}{80,200}\\.v1\\.${B64}{16}\\.${B64}{64}$`);
const CHIFFRE = BLOC(22, 140000);                                      // ≈ 100 Kio par élément
const T = (max, o = {}) => ({ type: 'chaine', max, ...o });
const E = (min, max) => ({ type: 'entier', min, max });
// Argon2id : jamais sous le plancher du manuel (19 Mio, 2 passes, 1 voie), jamais
// au-delà de ce qu'un navigateur tient (256 Mio).
const KDF = { type: 'objet', requis: true, champs: {
  algo: T(10, { requis: true, parmi: ['argon2id'] }),
  m: { ...E(19_456, 262_144), requis: true }, t: { ...E(2, 10), requis: true }, p: { ...E(1, 8), requis: true },
  sel: T(22, { requis: true, motif: /^[A-Za-z0-9_-]{22}$/ }),
} };
const PARAMS_KDF = ['m', 't', 'p'];
const kdfJournal = k => ({ m: k.m, t: k.t, p: k.p });

const S = {
  coffre: {
    kdf: KDF, cle: T(90, { requis: true, motif: CLE_ENVELOPPEE }), recuperation: T(90, { requis: true, motif: CLE_ENVELOPPEE }),
    clePublique: T(200, { requis: true, motif: /^[A-Za-z0-9_-]{80,200}$/ }), clePrivee: T(400, { requis: true, motif: BLOC(150, 300) }),
    empreinte: T(40, { requis: true, motif: /^([A-Z2-7]{4} ){5}[A-Z2-7]{4}$/ }),
  },
  maitre: { kdf: KDF, cle: T(90, { requis: true, motif: CLE_ENVELOPPEE }) },
  renfort: { version: { ...E(1, Number.MAX_SAFE_INTEGER), requis: true }, kdf: KDF, cle: T(90, { requis: true, motif: CLE_ENVELOPPEE }) },
  recuperation: { recuperation: T(90, { requis: true, motif: CLE_ENVELOPPEE }) },
  preferences: { preferences: T(20000, { requis: true, motif: BLOC(22, 20000) }) },
  element: { id: T(22, { requis: true, motif: ID }), chiffre: T(140100, { requis: true, motif: CHIFFRE }), cle: T(90, { requis: true, motif: CLE_ENVELOPPEE }) },
  maj: { version: { ...E(1, Number.MAX_SAFE_INTEGER), requis: true }, chiffre: T(140100, { requis: true, motif: CHIFFRE }) },
  lot: { elements: { type: 'liste', max: 500, requis: true, de: { type: 'objet', champs: { id: T(22, { requis: true, motif: ID }), chiffre: T(140100, { requis: true, motif: CHIFFRE }), cle: T(90, { requis: true, motif: CLE_ENVELOPPEE }) } } } },
  rotation: {
    version: { ...E(1, Number.MAX_SAFE_INTEGER), requis: true }, kdf: KDF,
    cle: T(90, { requis: true, motif: CLE_ENVELOPPEE }), recuperation: T(90, { requis: true, motif: CLE_ENVELOPPEE }),
    clePrivee: T(400, { requis: true, motif: BLOC(150, 300) }), preferences: T(20000, { motif: BLOC(22, 20000) }),
    elements: { type: 'liste', max: 100_000, requis: true, de: { type: 'objet', champs: {
      id: T(22, { requis: true, motif: ID }), version: { ...E(1, Number.MAX_SAFE_INTEGER), requis: true },
      chiffre: T(140100, { requis: true, motif: CHIFFRE }), cle: T(90, { requis: true, motif: CLE_ENVELOPPEE }),
      partages: { type: 'liste', max: 1000, requis: true, de: { type: 'objet', champs: { destinataire: T(64, { requis: true, motif: /^[A-Za-z0-9_-]{1,64}$/ }), cle: T(400, { requis: true, motif: CLE_PARTAGEE }) } } },
    } } },
  },
  appareil: { nom: T(60, { requis: true, motif: /^[\p{L}\p{N} ._'()-]{1,60}$/u }) },
  partage: { destinataire: T(64, { requis: true, motif: /^[A-Za-z0-9_-]{1,64}$/ }), cle: T(400, { requis: true, motif: CLE_PARTAGEE }), droits: T(10, { requis: true, parmi: ['lecture', 'ecriture'] }) },
};

export function creerApi({ socle, db, logos, cfg }) {
  const r = new Routeur();
  const { portail, journal, comptes, limiteur } = socle;
  const appareils = new Appareils(db);
  // Toutes les sessions d'un compte tombent (« ce n'était pas moi », réinitialisation,
  // rôle changé, compte désactivé, code de secours) : ses appareils avec elles.
  const fermerToutes = comptes.fermerToutes.bind(comptes);
  comptes.fermerToutes = compte => {
    fermerToutes(compte);
    const n = appareils.retirerTout(compte);
    if (n) journal.ecrire({ acteur: compte, action: 'appareils.retires', objet: compte, details: { appareils: n, cause: 'sessions_fermees' } });
  };
  const session = (ctx, opts = {}) => portail.exiger(ctx, { role: 'lecture', ...opts });
  const corps = async (ctx, schema, limite = 64 * 1024) => valider(await lireCorps(ctx.req, { limite }), schema);
  const tracer = (ctx, s, action, objet, details) => journal.ecrire({ acteur: s.compte, action, objet, ip: ctx.ip, details });
  const maintenant = () => Date.now();

  const coffreDe = compte => db.prepare('SELECT * FROM coffres WHERE compte = ?').get(compte);
  const vueCoffre = c => c && ({
    kdf: JSON.parse(c.kdf), cle: c.cle, clePublique: c.cle_publique, clePrivee: c.cle_privee, empreinte: c.empreinte,
    preferences: c.preferences || null, version: c.version,
  });
  const exigerCoffre = compte => { const c = coffreDe(compte); if (!c) throw new ErreurHttp(409, 'Crée d’abord ton coffre.'); return c; };
  const element = id => db.prepare('SELECT * FROM elements WHERE id = ?').get(id);
  const partage = (id, compte) => db.prepare('SELECT * FROM partages WHERE element = ? AND destinataire = ?').get(id, compte);
  // « ? » : le compte vient d'être effacé, ses partages partent avec lui.
  const nomDe = id => db.prepare('SELECT identifiant FROM socle_comptes WHERE id = ?').get(id)?.identifiant ?? '?';

  r.get('/api/health', () => ({ ok: true }), { public: true });
  r.get('/api/version', ctx => { session(ctx); return { version: VERSION, logos: cfg.logos === 'oui' }; });

  r.get('/api/coffre', ctx => {
    const s = session(ctx);
    const c = coffreDe(s.compte);
    return c ? { etat: 'pret', compte: s.compte, ...vueCoffre(c) } : { etat: 'nouveau', compte: s.compte };
  });
  r.post('/api/coffre', async ctx => {
    const s = session(ctx);
    const b = await corps(ctx, S.coffre);
    if (coffreDe(s.compte)) throw new ErreurHttp(409, 'Ton coffre existe déjà.');
    const t = maintenant();
    db.prepare('INSERT INTO coffres(compte, kdf, cle, recuperation, cle_publique, cle_privee, empreinte, cree, modifie) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(s.compte, JSON.stringify(b.kdf), b.cle, b.recuperation, b.clePublique, b.clePrivee, b.empreinte, t, t);
    tracer(ctx, s, 'coffre.cree', null, kdfJournal(b.kdf));
    return { etat: 'pret', compte: s.compte, ...vueCoffre(coffreDe(s.compte)) };
  });
  // Changer de mot de passe maître (avec l'ancien, ou avec la clé de récupération) : sous renfort.
  r.put('/api/coffre/maitre', async ctx => {
    const s = session(ctx, { renfort: true });
    exigerCoffre(s.compte);
    const b = await corps(ctx, S.maitre);
    db.prepare('UPDATE coffres SET kdf = ?, cle = ?, version = version + 1, modifie = ? WHERE compte = ?').run(JSON.stringify(b.kdf), b.cle, maintenant(), s.compte);
    tracer(ctx, s, 'coffre.maitre_change', null, kdfJournal(b.kdf));
    return vueCoffre(coffreDe(s.compte));
  });
  // Renforcer la dérivation juste après un déverrouillage (même mot de passe,
  // paramètres plus forts). Sans renfort : la route ne fait que monter les
  // paramètres, jamais les baisser, et refuse une version périmée.
  r.put('/api/coffre/kdf', async ctx => {
    const s = session(ctx);
    const c = exigerCoffre(s.compte);
    const b = await corps(ctx, S.renfort);
    const avant = JSON.parse(c.kdf);
    if (PARAMS_KDF.some(x => b.kdf[x] < avant[x]) || PARAMS_KDF.every(x => b.kdf[x] === avant[x])) throw new ErreurHttp(400, 'Paramètres plus faibles ou identiques : refusé.');
    const fait = db.prepare('UPDATE coffres SET kdf = ?, cle = ?, version = version + 1, modifie = ? WHERE compte = ? AND version = ?').run(JSON.stringify(b.kdf), b.cle, maintenant(), s.compte, b.version);
    if (!fait.changes) throw new ErreurHttp(409, 'Ton coffre a changé entre-temps : déverrouille-le à nouveau.');
    tracer(ctx, s, 'coffre.kdf_renforce', null, { avant: kdfJournal(avant), apres: kdfJournal(b.kdf) });
    return vueCoffre(coffreDe(s.compte));
  });
  // Renouveler la clé du coffre : tout ce que le compte possède, rechiffré d'un
  // coup, ou rien. L'ensemble envoyé doit être exactement l'état actuel (mêmes
  // éléments, mêmes versions, mêmes destinataires) : un changement entre-temps
  // fait tout refuser. Les autres sessions et les appareils reliés tombent.
  r.put('/api/coffre/cle', async ctx => {
    const s = session(ctx, { renfort: true });
    const c = exigerCoffre(s.compte);
    const b = await corps(ctx, S.rotation, (cfg.maxMio * 2 + 2) * 1024 * 1024);
    const change = () => new ErreurHttp(409, 'Ton coffre a changé entre-temps : recharge et recommence.');
    if (b.version !== c.version) throw change();
    const avant = JSON.parse(c.kdf);
    if (PARAMS_KDF.some(x => b.kdf[x] < avant[x])) throw new ErreurHttp(400, 'Paramètres plus faibles : refusé.');
    const propres = db.prepare('SELECT id, version FROM elements WHERE proprietaire = ?').all(s.compte);
    const recus = new Map(b.elements.map(e => [e.id, e]));
    if (recus.size !== b.elements.length || recus.size !== propres.length || propres.some(p => recus.get(p.id)?.version !== p.version)) throw change();
    const lirePartages = db.prepare('SELECT destinataire FROM partages WHERE element = ?');
    for (const p of propres) {
      const actuels = lirePartages.all(p.id).map(x => x.destinataire).sort();
      const envoyes = recus.get(p.id).partages.map(x => x.destinataire).sort();
      if (actuels.length !== envoyes.length || actuels.some((d, i) => d !== envoyes[i])) throw change();
    }
    if (b.elements.reduce((n, e) => n + taille(e), 0) > cfg.maxMio * 1024 * 1024) throw new ErreurHttp(409, `Plafond atteint : ${cfg.maxMio} Mio par coffre.`);
    const t = maintenant();
    db.exec('BEGIN IMMEDIATE');
    try {
      const fait = db.prepare('UPDATE coffres SET kdf = ?, cle = ?, recuperation = ?, cle_privee = ?, preferences = ?, version = version + 1, modifie = ? WHERE compte = ? AND version = ?')
        .run(JSON.stringify(b.kdf), b.cle, b.recuperation, b.clePrivee, b.preferences ?? null, t, s.compte, c.version);
      if (!fait.changes) throw change();
      const majElement = db.prepare('UPDATE elements SET chiffre = ?, cle = ?, version = version + 1, modifie = ?, modifie_par = ? WHERE id = ? AND proprietaire = ? AND version = ?');
      const majPartage = db.prepare('UPDATE partages SET cle = ? WHERE element = ? AND destinataire = ?');
      for (const e of b.elements) {
        if (!majElement.run(e.chiffre, e.cle, t, s.compte, e.id, s.compte, e.version).changes) throw change();
        for (const p of e.partages) if (!majPartage.run(p.cle, e.id, p.destinataire).changes) throw change();
      }
      db.prepare('DELETE FROM socle_sessions WHERE compte = ? AND id <> ?').run(s.compte, s.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const retires = appareils.retirerTout(s.compte);
    tracer(ctx, s, 'coffre.cle_renouvelee', null, { elements: b.elements.length, appareils: retires, ...kdfJournal(b.kdf) });
    return vueCoffre(coffreDe(s.compte));
  });
  // La clé du coffre enveloppée par la clé de récupération : n'aide que qui tient la clé imprimée. Sous renfort.
  r.get('/api/coffre/recuperation', ctx => {
    const s = session(ctx, { renfort: true });
    const c = exigerCoffre(s.compte);
    tracer(ctx, s, 'coffre.recuperation_lue', null, {});
    return { recuperation: c.recuperation };
  });
  r.put('/api/coffre/recuperation', async ctx => {
    const s = session(ctx, { renfort: true });
    exigerCoffre(s.compte);
    const b = await corps(ctx, S.recuperation);
    db.prepare('UPDATE coffres SET recuperation = ?, version = version + 1, modifie = ? WHERE compte = ?').run(b.recuperation, maintenant(), s.compte);
    tracer(ctx, s, 'coffre.recuperation_refaite', null, {});
    return { ok: true };
  });
  r.put('/api/coffre/preferences', async ctx => {
    const s = session(ctx);
    exigerCoffre(s.compte);
    const b = await corps(ctx, S.preferences, 32 * 1024);
    db.prepare('UPDATE coffres SET preferences = ?, modifie = ? WHERE compte = ?').run(b.preferences, maintenant(), s.compte);
    return { ok: true };
  });

  const vue = (e, compte) => {
    if (e.proprietaire === compte) {
      const parts = db.prepare('SELECT destinataire, droits, cree FROM partages WHERE element = ?').all(e.id);
      return { id: e.id, via: 'propre', chiffre: e.chiffre, cle: e.cle, version: e.version, modifie: e.modifie, cree: e.cree,
        partages: parts.map(p => ({ destinataire: p.destinataire, identifiant: nomDe(p.destinataire), droits: p.droits, cree: p.cree })) };
    }
    const p = partage(e.id, compte);
    return { id: e.id, via: 'partage', chiffre: e.chiffre, cle: p.cle, version: e.version, modifie: e.modifie, cree: e.cree, droits: p.droits, proprietaire: nomDe(e.proprietaire) };
  };
  const elementsDe = compte => [
    ...db.prepare('SELECT * FROM elements WHERE proprietaire = ? ORDER BY modifie DESC').all(compte),
    ...db.prepare('SELECT e.* FROM elements e JOIN partages p ON p.element = e.id WHERE p.destinataire = ? ORDER BY e.modifie DESC').all(compte),
  ];
  r.get('/api/elements', ctx => {
    const s = session(ctx);
    return { elements: elementsDe(s.compte).map(e => vue(e, s.compte)) };
  });

  const ajouter = (s, b, t) => db.prepare('INSERT INTO elements(id, proprietaire, chiffre, cle, cree, modifie, modifie_par) VALUES(?, ?, ?, ?, ?, ?, ?)').run(b.id, s.compte, b.chiffre, b.cle, t, t, s.compte);
  // Plafonds du propriétaire : nombre d'éléments et octets chiffrés, partages
  // en écriture compris (c'est son coffre qui grossit).
  const place = (proprietaire, n, octets, retires = 0) => {
    const { c, o } = db.prepare('SELECT count(*) c, coalesce(sum(length(chiffre) + length(cle)), 0) o FROM elements WHERE proprietaire = ?').get(proprietaire);
    if (c + n > cfg.maxElements) throw new ErreurHttp(409, `Plafond atteint : ${cfg.maxElements} éléments par coffre.`);
    if (o - retires + octets > cfg.maxMio * 1024 * 1024) throw new ErreurHttp(409, `Plafond atteint : ${cfg.maxMio} Mio par coffre.`);
  };
  const taille = e => e.chiffre.length + e.cle.length;
  r.post('/api/elements', async ctx => {
    const s = session(ctx, { role: 'membre' });
    exigerCoffre(s.compte);
    const b = await corps(ctx, S.element, 160 * 1024);
    place(s.compte, 1, taille(b));
    if (element(b.id)) throw new ErreurHttp(409, 'Identifiant déjà pris.');
    ajouter(s, b, maintenant());
    tracer(ctx, s, 'element.ajoute', b.id, {});
    return vue(element(b.id), s.compte);
  });
  // L'import : un lot, tout ou rien.
  r.post('/api/elements/lot', async ctx => {
    const s = session(ctx, { role: 'membre' });
    exigerCoffre(s.compte);
    const b = await corps(ctx, S.lot, 8 * 1024 * 1024);
    place(s.compte, b.elements.length, b.elements.reduce((n, e) => n + taille(e), 0));
    const t = maintenant();
    db.exec('BEGIN');
    try {
      for (const e of b.elements) { if (element(e.id)) throw new ErreurHttp(409, 'Identifiant déjà pris.'); ajouter(s, e, t); }
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    tracer(ctx, s, 'elements.importes', null, { nombre: b.elements.length });
    return { ajoutes: b.elements.length };
  });
  r.put('/api/elements/:id', async ctx => {
    const s = session(ctx, { role: 'membre' });
    const e = element(ctx.params.id);
    const p = e && e.proprietaire !== s.compte ? partage(e.id, s.compte) : null;
    if (!e || (e.proprietaire !== s.compte && !p)) throw new ErreurHttp(404, 'Introuvable.');
    if (p && p.droits !== 'ecriture') throw new ErreurHttp(403, 'Partagé avec toi en lecture seule.');
    const b = await corps(ctx, S.maj, 160 * 1024);
    place(e.proprietaire, 0, b.chiffre.length, e.chiffre.length);
    // Deux appareils qui modifient le même élément : le second est prévenu, rien n'est écrasé.
    const fait = db.prepare('UPDATE elements SET chiffre = ?, version = version + 1, modifie = ?, modifie_par = ? WHERE id = ? AND version = ?').run(b.chiffre, maintenant(), s.compte, e.id, b.version);
    if (!fait.changes) throw new ErreurHttp(409, 'Modifié ailleurs entre-temps : recharge l’élément avant de l’enregistrer.');
    tracer(ctx, s, 'element.modifie', e.id, p ? { partage: true } : {});
    return vue(element(e.id), s.compte);
  });
  r.del('/api/elements/:id', ctx => {
    const s = session(ctx, { role: 'membre' });
    const e = element(ctx.params.id);
    if (!e || e.proprietaire !== s.compte) throw new ErreurHttp(404, 'Introuvable.');
    db.prepare('DELETE FROM elements WHERE id = ?').run(e.id);
    tracer(ctx, s, 'element.supprime', e.id, {});
    return { ok: true };
  });

  // Les comptes qui ont un coffre, avec leur clé publique et son empreinte (à vérifier de vive voix).
  r.get('/api/destinataires', ctx => {
    const s = session(ctx, { role: 'membre' });
    return { destinataires: db.prepare('SELECT compte, cle_publique, empreinte FROM coffres WHERE compte <> ?').all(s.compte)
      .map(c => ({ id: c.compte, identifiant: nomDe(c.compte), clePublique: c.cle_publique, empreinte: c.empreinte })).filter(d => d.identifiant !== '?') };
  });
  r.put('/api/elements/:id/partages', async ctx => {
    const s = session(ctx, { role: 'membre' });
    const e = element(ctx.params.id);
    if (!e || e.proprietaire !== s.compte) throw new ErreurHttp(404, 'Introuvable.');
    const b = await corps(ctx, S.partage);
    if (b.destinataire === s.compte) throw new ErreurHttp(400, 'C’est déjà ton élément.');
    if (!coffreDe(b.destinataire)) throw new ErreurHttp(404, 'Ce compte n’a pas encore de coffre.');
    db.prepare('INSERT INTO partages(element, destinataire, cle, droits, cree) VALUES(?, ?, ?, ?, ?) ON CONFLICT(element, destinataire) DO UPDATE SET cle = excluded.cle, droits = excluded.droits')
      .run(e.id, b.destinataire, b.cle, b.droits, maintenant());
    tracer(ctx, s, 'element.partage', e.id, { destinataire: b.destinataire, droits: b.droits });
    return vue(element(e.id), s.compte);
  });
  r.del('/api/elements/:id/partages/:dest', ctx => {
    const s = session(ctx, { role: 'lecture' });
    const e = element(ctx.params.id);
    // Le propriétaire retire un partage ; le destinataire peut aussi le quitter.
    if (!e || (e.proprietaire !== s.compte && ctx.params.dest !== s.compte)) throw new ErreurHttp(404, 'Introuvable.');
    db.prepare('DELETE FROM partages WHERE element = ? AND destinataire = ?').run(e.id, ctx.params.dest);
    tracer(ctx, s, 'element.partage_retire', e.id, { destinataire: ctx.params.dest });
    return { ok: true };
  });

  r.get('/api/logos/:domaine', async ctx => {
    session(ctx);
    const d = String(ctx.params.domaine).toLowerCase();
    if (!DOMAINE.test(d)) throw new ErreurHttp(404, 'Introuvable.');
    const l = await logos.obtenir(d);
    if (!l) { ctx.res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=3600' }); ctx.res.end('{"error":"Pas de logo."}'); return; }
    ctx.res.writeHead(200, {
      'Content-Type': 'image/png', 'Content-Length': l.octets.length, 'Cache-Control': 'private, max-age=86400', 'Content-Disposition': 'attachment',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
    });
    ctx.res.end(l.octets);
  });

  // ---- appareils reliés (extension de navigateur) ----
  r.get('/api/appareils', ctx => {
    const s = session(ctx);
    return { appareils: appareils.lister(s.compte), max: MAX_PAR_COMPTE };
  });
  r.post('/api/appareils', async ctx => {
    const s = session(ctx, { renfort: true });
    exigerCoffre(s.compte);
    const b = await corps(ctx, S.appareil);
    const origine = socle.cfg.urlPublique ? new URL(socle.cfg.urlPublique).origin : ctx.origine;
    if (!origine || !ctx.sur) throw new ErreurHttp(409, 'Relier un appareil demande CODVAULT en HTTPS, à son adresse publique.');
    const a = appareils.relier(s.compte, b.nom);
    if (!a) throw new ErreurHttp(409, `Plafond atteint : ${MAX_PAR_COMPTE} appareils. Retires-en un d’abord.`);
    tracer(ctx, s, 'appareil.relie', a.id, { nom: b.nom });
    return { id: a.id, code: codeDeLiaison(origine, a.jeton) };
  });
  r.del('/api/appareils/:id', ctx => {
    const s = session(ctx);
    if (!appareils.retirer(s.compte, ctx.params.id)) throw new ErreurHttp(404, 'Appareil introuvable.');
    tracer(ctx, s, 'appareil.retire', ctx.params.id, {});
    return { ok: true };
  });

  // Les deux routes de l'appareil : en HTTPS seulement, jeton dans l'en-tête,
  // aucun cookie lu. Un jeton refusé compte parmi les échecs de l'adresse.
  const appareil = ctx => {
    if (!ctx.sur) throw new ErreurHttp(403, 'HTTPS exigé.');
    const cles = [`ip:${ctx.ip}`];
    limiteur.controler(cles);
    const a = appareils.authentifier(ctx.req.headers.authorization);
    const actif = a && db.prepare('SELECT actif FROM socle_comptes WHERE id = ?').get(a.compte)?.actif === 1;
    if (!actif) {
      if (a) appareils.retirerTout(a.compte);
      limiteur.echec(cles);
      journal.rare(`appareil:${ctx.ip}`, { action: 'appareil.refuse', objet: ctx.url.pathname, ip: ctx.ip, resultat: 'refus', details: {} });
      throw new ErreurHttp(401, 'Appareil inconnu ou retiré : relie-le à nouveau depuis CODVAULT.');
    }
    return a;
  };
  r.get('/api/appareil/coffre', ctx => {
    const a = appareil(ctx);
    const c = exigerCoffre(a.compte);
    return { compte: a.compte, kdf: JSON.parse(c.kdf), cle: c.cle, clePublique: c.cle_publique, clePrivee: c.cle_privee, preferences: c.preferences || null, version: c.version };
  });
  r.get('/api/appareil/elements', ctx => {
    const a = appareil(ctx);
    return { elements: elementsDe(a.compte).map(e => {
      const v = vue(e, a.compte);
      return { id: v.id, via: v.via, chiffre: v.chiffre, cle: v.cle, version: v.version };
    }) };
  });

  // Un compte effacé (par lui-même ou par un administrateur) part avec tout ce qui est à lui.
  comptes.apresSuppression.push(compte => effacerCompte(db, compte));
  // L'export de ses données (socle) : son coffre tel qu'il est stocké, chiffré.
  portail.exporteur = async compte => ({
    coffre: vueCoffre(coffreDe(compte)) || null,
    elements: db.prepare('SELECT id, chiffre, cle, version, cree, modifie FROM elements WHERE proprietaire = ?').all(compte),
    note: 'Tout est chiffré par ton mot de passe maître : ce fichier ne s’ouvre qu’avec lui (ou la clé de récupération), dans CODVAULT.',
  });

  const PARAM = { id: ID, dest: /^[A-Za-z0-9_-]{1,64}$/, domaine: /^[a-z0-9.-]{4,253}$/i };
  return {
    appareils,
    async traiter(ctx) {
      const p = ctx.url.pathname;
      if (!p.startsWith('/api/')) return false;
      const t = r.trouver(ctx.req.method, p);
      if (!t) throw new ErreurHttp(404, 'Route inconnue.');
      if (t.methodes) { ctx.res.setHeader('Allow', t.methodes.join(', ')); throw new ErreurHttp(405, 'Méthode non admise.'); }
      if (Object.entries(t.params).some(([k, v]) => !(PARAM[k] || ID).test(v))) throw new ErreurHttp(404, 'Introuvable.');
      if (ctx.url.search) throw new ErreurHttp(400, 'Paramètres de requête inattendus.');
      ctx.params = t.params;
      const reponse = await t.route.gestionnaire(ctx);
      if (reponse !== undefined) repondreJson(ctx.res, 200, reponse, { 'Cache-Control': 'no-store' });
      return true;
    },
  };
}
