// Ce que la fenêtre de l'extension et son arrière-plan partagent : la liaison
// au serveur, la session ouverte, la lecture du coffre et le remplissage.
//
// Ce qui est gardé, et où :
//   - storage.local (disque) : l'adresse du serveur et le jeton de l'appareil,
//     qui ne lit que du chiffré ; le délai de verrouillage ;
//   - storage.session (mémoire du navigateur, effacée à sa fermeture, hors
//     d'atteinte des pages) : la clé du coffre ouvert et son échéance, si un
//     délai est choisi. Avec « à chaque fois », rien n'y est écrit ;
//   - rien d'autre : les éléments déchiffrés ne vivent que dans la fenêtre
//     ouverte, ou le temps d'un remplissage.
import * as C from './lib/crypto.js';

export const navigateur = globalThis.browser ?? globalThis.chrome;
const local = navigateur.storage.local;
const memoire = navigateur.storage.session;

export const DELAIS = [[0, 'À chaque ouverture'], [1, '1 min'], [5, '5 min'], [15, '15 min'], [60, '1 h']];
export const DELAI_DEFAUT = 5;
export const PRESSE_SECONDES = 30;

const CODE = /^CV1\.([A-Za-z0-9_-]{8,400})\.(cvd_[A-Za-z0-9_-]{43})$/;
// Le serveur : en HTTPS, ou sur la boucle locale pour l'essai. Les sites remplis : en HTTPS seulement.
const serveurSur = u => u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));

/** Le code collé : l'origine du serveur (HTTPS, ou localhost pour l'essai) et le jeton. */
export function lireCode(texte) {
  const m = CODE.exec(String(texte || '').trim());
  if (!m) throw new Error('Ce n’est pas un code de liaison CODVAULT.');
  let u;
  try { u = new URL(new TextDecoder().decode(Uint8Array.from(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))); } catch { throw new Error('Adresse du serveur illisible.'); }
  if (!serveurSur(u)) throw new Error('Le serveur doit être en HTTPS.');
  if (u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new Error('Adresse du serveur inattendue.');
  return { origine: u.origin, jeton: m[2] };
}
export const motifHote = origine => `${new URL(origine).origin}/*`;

export async function liaison() {
  const { serveur, jeton, delai } = await local.get(['serveur', 'jeton', 'delai']);
  return serveur && jeton ? { serveur, jeton, delai: Number.isInteger(delai) ? delai : DELAI_DEFAUT } : null;
}
export const lier = (serveur, jeton) => local.set({ serveur, jeton });
export async function delier() { await verrouiller(); await local.remove(['serveur', 'jeton']); }
export const choisirDelai = async delai => { await local.set({ delai }); if (!delai) await verrouiller(); };

async function lire(l, chemin) {
  let r;
  try {
    r = await fetch(l.serveur + chemin, { headers: { Authorization: `Bearer ${l.jeton}` }, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
  } catch { throw new Error('Serveur injoignable.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { const e = new Error('Cet appareil n’est plus relié : crée un nouveau code dans CODVAULT.'); e.delie = true; throw e; }
  if (!r.ok) throw new Error(j.error || `Le serveur a répondu ${r.status}.`);
  return j;
}
const lireCoffre = l => lire(l, '/api/appareil/coffre');

/** Vérifie un jeton tout juste collé. */
export const essayer = (serveur, jeton) => lireCoffre({ serveur, jeton });

// ---- session ----
export async function verrouiller() {
  await memoire.remove(['cle', 'compte', 'echeance']);
  await navigateur.alarms.clear('verrou');
}
async function garder(cle, compte, delai) {
  if (!delai) return;
  const echeance = Date.now() + delai * 60e3;
  await memoire.set({ cle, compte, echeance });
  await navigateur.alarms.create('verrou', { when: echeance });
}

/** Ouvrir avec le mot de passe maître. */
export async function ouvrirAvec(l, motDePasse) {
  const coffre = await lireCoffre(l);
  const { session, cle } = await C.deverrouillerAppareil(motDePasse, coffre, coffre.compte);
  await garder(cle, coffre.compte, l.delai);
  return session;
}

/** La session gardée, si son échéance n'est pas passée ; chaque usage la repousse. */
export async function reprendre(l) {
  if (!l.delai) return null;
  const { cle, compte, echeance } = await memoire.get(['cle', 'compte', 'echeance']);
  if (!cle || !(echeance > Date.now())) { await verrouiller(); return null; }
  const coffre = await lireCoffre(l);
  if (coffre.compte !== compte) { await verrouiller(); return null; }
  try {
    const s = await C.reprendre(cle, coffre, compte);
    await garder(cle, compte, l.delai);
    return s;
  } catch { await verrouiller(); return null; }
}

/** Les éléments, déchiffrés ici. Un bloc qui ne s'ouvre pas est compté, jamais montré. */
export async function elements(l, s) {
  const { elements: lignes } = await lire(l, '/api/appareil/elements');
  const sortie = [];
  let illisibles = 0;
  for (const ligne of lignes) {
    try { sortie.push({ id: ligne.id, ...(await C.dechiffrerElement(s, ligne)) }); } catch { illisibles++; }
  }
  return { elements: sortie, illisibles };
}

// ---- le site ouvert ----
export function hoteDe(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.hostname.toLowerCase().replace(/^www\./, '') : null;
  } catch { return null; }
}
/** Un élément vaut pour un site si son domaine est celui du site, ou un domaine parent (exemple.org vaut pour compte.exemple.org). */
export function convient(e, hote) {
  const d = C.domaineDe(e.url || '');
  return !!(hote && d && (hote === d || hote.endsWith('.' + d)));
}
export const pourLeSite = (liste, hote) => liste.filter(e => e.type !== 'note' && convient(e, hote));

/** Les paramètres A2F d'un élément, ou null (aucun secret, ou secret illisible). */
export const totp = e => { try { return e.totp ? C.lireTotp(e.totp) : null; } catch { return null; } };
export async function code(e) {
  const p = totp(e);
  return p ? C.codeTotp(p) : '';
}

/**
 * Remplir, dans le cadre principal de l'onglet seulement, après avoir revérifié
 * l'adresse dans la page (elle a pu changer depuis le clic). Jamais de cadre
 * intégré, jamais de champ caché ; le mot de passe ne va que dans un champ mot de passe.
 */
export async function remplirOnglet(onglet, e) {
  const actuel = await navigateur.tabs.get(onglet.id);
  const hote = hoteDe(actuel.url);
  if (!convient(e, hote)) throw new Error('Cet élément n’est pas pour ce site.');
  const [r] = await navigateur.scripting.executeScript({
    target: { tabId: onglet.id, frameIds: [0] },
    func: remplirDansLaPage,
    args: [C.domaineDe(e.url), e.identifiant || '', e.motDePasse || '', await code(e)],
  });
  const res = r?.result;
  if (!res?.ok) throw new Error(res?.raison || 'Aucun champ à remplir sur cette page.');
  return res.fait;
}

// Exécutée dans la page (monde isolé de l'extension) : autonome, sans rien d'extérieur.
function remplirDansLaPage(domaine, identifiant, motDePasse, codeA2f) {
  const hote = location.hostname.toLowerCase().replace(/^www\./, '');
  if (window.top !== window) return { ok: false, raison: 'Cadre intégré : refusé.' };
  if (location.protocol !== 'https:') return { ok: false, raison: 'Page sans HTTPS : refusé.' };
  if (!(hote === domaine || hote.endsWith('.' + domaine))) return { ok: false, raison: 'La page a changé de site : refusé.' };
  const visible = el => {
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return r.width >= 4 && r.height >= 4 && st.visibility === 'visible' && st.display !== 'none' && Number(st.opacity) >= 0.5 && !el.disabled && !el.readOnly;
  };
  const champs = [...document.querySelectorAll('input')].filter(visible);
  const texte = i => ['text', 'email', 'tel', ''].includes(i.type);
  const indice = i => `${i.name} ${i.id} ${i.getAttribute('autocomplete') || ''} ${i.getAttribute('aria-label') || ''} ${i.placeholder}`.toLowerCase();
  const poser = (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    for (const t of ['input', 'change']) el.dispatchEvent(new Event(t, { bubbles: true }));
  };
  const fait = [];
  const mdp = champs.filter(i => i.type === 'password' && !/new-password/.test(i.getAttribute('autocomplete') || ''));
  if (motDePasse && mdp.length) {
    const cible = mdp[0];
    poser(cible, motDePasse); fait.push('mot de passe');
    if (identifiant) {
      const avant = champs.filter(i => texte(i) && (i.compareDocumentPosition(cible) & Node.DOCUMENT_POSITION_FOLLOWING));
      const id = avant.filter(i => cible.form && i.form === cible.form).at(-1) || avant.at(-1);
      if (id) { poser(id, identifiant); fait.push('identifiant'); }
    }
    cible.focus();
  } else if (identifiant) {
    const id = champs.find(i => i.type === 'email' || /username|email|login|identifiant|user|account|compte/.test(indice(i)));
    if (id) { poser(id, identifiant); id.focus(); fait.push('identifiant'); }
  }
  if (codeA2f && !mdp.length) {
    const otp = champs.find(i => (i.getAttribute('autocomplete') || '') === 'one-time-code' || /otp|totp|2fa|mfa|one.?time|verification|code/.test(indice(i)));
    if (otp) { poser(otp, codeA2f); otp.focus(); fait.push('code A2F'); }
  }
  return fait.length ? { ok: true, fait } : { ok: false, raison: 'Aucun champ à remplir sur cette page.' };
}

export { C };
