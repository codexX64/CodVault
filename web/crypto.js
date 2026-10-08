// Chiffrement de SÉSAME, dans le navigateur seul (WebCrypto). Le serveur ne
// reçoit que des blocs chiffrés : ni le mot de passe maître, ni la clé du
// coffre, ni un mot de passe enregistré ne quittent jamais cette page en clair.
//
//   mot de passe maître ─Argon2id (64 Mio, 3 passes, 4 voies, sel propre)─▶ clé maîtresse
//   clé maîtresse ─HKDF─▶ clé d'enveloppe ─AES-256-GCM─▶ clé du coffre (32 octets)
//   clé de récupération (32 octets, imprimée une fois) ─HKDF─▶ seconde enveloppe
//   chaque élément : sa propre clé (32 octets), enveloppée par la clé du coffre ;
//   un partage : la clé de l'élément enveloppée pour la clé publique du
//   destinataire (ECDH P-256 éphémère + HKDF + AES-256-GCM).
//
// Chaque chiffrement porte des données associées qui le lient à sa place
// (compte, identifiant de l'élément, destinataire) : un serveur qui
// déplacerait un bloc d'un élément ou d'un compte à l'autre est détecté.
//
// Ce fichier est aussi chargé par les essais (Node fournit le même WebCrypto).

import { argon2idAsync } from './vendor/noble-hashes/argon2.js';

const subtle = globalThis.crypto.subtle;
const te = new TextEncoder();
const td = new TextDecoder();

// Les paramètres d'Argon2id vont avec chaque enveloppe : le serveur refuse
// sous le plancher, et un coffre plus faible que la cible est renforcé au
// déverrouillage suivant.
export const KDF_DEFAUT = Object.freeze({ algo: 'argon2id', m: 65536, t: 3, p: 4 });
export const KDF_PLANCHER = Object.freeze({ m: 19456, t: 2, p: 1 });
export const KDF_PLAFOND = Object.freeze({ m: 262144, t: 10, p: 8 });
const PARAMS = ['m', 't', 'p'];
const kdfAdmis = k => k?.algo === 'argon2id' && typeof k.sel === 'string'
  && PARAMS.every(x => Number.isInteger(k[x]) && k[x] >= KDF_PLANCHER[x] && k[x] <= KDF_PLAFOND[x]);
/** Vrai si l'un des paramètres est sous la cible. */
export const kdfPlusFaible = (k, cible = KDF_DEFAUT) => PARAMS.some(x => k[x] < cible[x]);
const nouveauKdf = (p = KDF_DEFAUT) => ({ algo: 'argon2id', m: p.m, t: p.t, p: p.p, sel: b64u(aleatoire(16)) });
// Jamais moins que la cible, jamais moins que ce que le coffre avait déjà.
const auMoins = k => nouveauKdf({ m: Math.max(k.m, KDF_DEFAUT.m), t: Math.max(k.t, KDF_DEFAUT.t), p: Math.max(k.p, KDF_DEFAUT.p) });
export const VERSION_BLOC = 'v1';

export function b64u(octets) {
  const o = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
  let s = '';
  for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function deB64u(texte) {
  const s = String(texte).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}
export const aleatoire = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
const effacer = o => { if (o instanceof Uint8Array) o.fill(0); };

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(octets) {
  let bits = 0, valeur = 0, out = '';
  for (const b of octets) {
    valeur = (valeur << 8) | b; bits += 8;
    while (bits >= 5) { out += BASE32[(valeur >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += BASE32[(valeur << (5 - bits)) & 31];
  return out;
}
export function deBase32(texte) {
  const s = String(texte).toUpperCase().replace(/[\s=-]/g, '');
  if (!/^[A-Z2-7]+$/.test(s)) throw new Error('Clé en base 32 invalide.');
  let bits = 0, valeur = 0;
  const out = [];
  for (const c of s) {
    valeur = (valeur << 5) | BASE32.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((valeur >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function aes(cle, usages = ['encrypt', 'decrypt']) {
  return subtle.importKey('raw', cle, { name: 'AES-GCM' }, false, usages);
}
async function hkdf(secret, info, usages = ['encrypt', 'decrypt']) {
  const base = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: te.encode('sesame/hkdf/v1'), info: te.encode(info) }, base, { name: 'AES-GCM', length: 256 }, false, usages);
}
/** Bloc « v1.<iv>.<chiffré> » : AES-256-GCM, IV aléatoire de 96 bits, données associées obligatoires. */
export async function sceller(cle, clair, aad) {
  const iv = aleatoire(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad), tagLength: 128 }, cle, clair);
  return `${VERSION_BLOC}.${b64u(iv)}.${b64u(ct)}`;
}
export async function ouvrir(cle, bloc, aad) {
  const m = /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22,})$/.exec(String(bloc || ''));
  if (!m) throw new Error('Bloc chiffré illisible.');
  try {
    return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: deB64u(m[1]), additionalData: te.encode(aad), tagLength: 128 }, cle, deB64u(m[2])));
  } catch { throw new Error('Déchiffrement refusé : clé fausse ou bloc altéré.'); }
}

// Les données associées : chaque bloc n'est valable qu'à sa place.
const AAD = {
  coffre: compte => `sesame/coffre/v1/${compte}`,
  recuperation: compte => `sesame/recuperation/v1/${compte}`,
  identite: compte => `sesame/identite/v1/${compte}`,
  preferences: compte => `sesame/preferences/v1/${compte}`,
  element: id => `sesame/element/v1/${id}`,
  cle: (id, compte) => `sesame/cle/v1/${id}/${compte}`,
  partage: (id, dest) => `sesame/partage/v1/${id}/${dest}`,
  export: () => 'sesame/export/v1',
};

/** Le mot de passe maître étiré par Argon2id, puis HKDF vers la clé d'enveloppe. */
export async function deriverEnveloppe(motDePasse, kdf) {
  if (!kdfAdmis(kdf)) throw new Error('Paramètres de dérivation refusés.');
  const mdp = te.encode(String(motDePasse).normalize('NFKC'));
  // asyncTick : la main revient au navigateur toutes les 10 ms, la page reste vivante pendant le calcul.
  const bits = await argon2idAsync(mdp, deB64u(kdf.sel), { m: kdf.m, t: kdf.t, p: kdf.p, dkLen: 32, asyncTick: 10 });
  try { return await hkdf(bits, 'sesame/enveloppe/v1'); } finally { effacer(bits); effacer(mdp); }
}

/** La clé de récupération telle qu'on l'imprime : 32 octets en base 32, par groupes de quatre. */
export const formaterRecuperation = octets => base32(octets).match(/.{1,4}/g).join('-');
const enveloppeRecuperation = async texte => {
  // Recopiée à la main : 0, 1 et 8 n'existent pas en base 32, c'est O, I et B mal lus.
  const o = deBase32(String(texte).toUpperCase().replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B'));
  if (o.length !== 32) throw new Error('Clé de récupération incomplète : 52 caractères attendus.');
  try { return await hkdf(o, 'sesame/recuperation/v1'); } finally { effacer(o); }
};

/** L'empreinte d'une clé publique, à comparer de vive voix avant un partage. */
export async function empreinte(clePubliqueB64u) {
  const h = new Uint8Array(await subtle.digest('SHA-256', deB64u(clePubliqueB64u)));
  return base32(h.subarray(0, 15)).match(/.{4}/g).join(' ');
}

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };

/**
 * Un coffre neuf. Ce qui part au serveur (`publique`) n'est que du chiffré et
 * une clé publique ; la clé de récupération en clair (`recuperation`) est
 * montrée une fois à l'utilisateur, puis oubliée.
 */
export async function creerCoffre(motDePasse, compte, { kdf: params = KDF_DEFAUT } = {}) {
  const kdf = nouveauKdf(params);
  const brute = aleatoire(32);
  const recup = aleatoire(32);
  const recuperation = formaterRecuperation(recup);
  try {
    const enveloppe = await deriverEnveloppe(motDePasse, kdf);
    const cle = await sceller(enveloppe, brute, AAD.coffre(compte));
    const cleRecuperation = await sceller(await enveloppeRecuperation(recuperation), brute, AAD.recuperation(compte));
    const cleCoffre = await aes(brute);
    const paire = await subtle.generateKey(ECDH, true, ['deriveBits']);
    const pub = b64u(await subtle.exportKey('spki', paire.publicKey));
    const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', paire.privateKey));
    const clePrivee = await sceller(cleCoffre, pkcs8, AAD.identite(compte));
    effacer(pkcs8);
    const privee = await subtle.importKey('pkcs8', await ouvrir(cleCoffre, clePrivee, AAD.identite(compte)), ECDH, false, ['deriveBits']);
    return {
      publique: { kdf, cle, recuperation: cleRecuperation, clePublique: pub, clePrivee, empreinte: await empreinte(pub) },
      recuperation,
      session: { compte, cleCoffre, privee, clePublique: pub },
    };
  } finally { effacer(brute); effacer(recup); }
}

async function session(compte, brute, coffre) {
  const cleCoffre = await aes(brute);
  const pkcs8 = await ouvrir(cleCoffre, coffre.clePrivee, AAD.identite(compte));
  try {
    const privee = await subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits']);
    return { compte, cleCoffre, privee, clePublique: coffre.clePublique };
  } finally { effacer(pkcs8); }
}

/**
 * Déverrouiller : la clé du coffre n'existe en mémoire que le temps de la
 * session, non exportable. Si l'enveloppe date de paramètres plus faibles que
 * la cible, `renfort` porte la même clé réenveloppée aux paramètres actuels,
 * à renvoyer au serveur tout de suite.
 */
export async function deverrouiller(motDePasse, coffre, compte) {
  const enveloppe = await deriverEnveloppe(motDePasse, coffre.kdf);
  let brute;
  try { brute = await ouvrir(enveloppe, coffre.cle, AAD.coffre(compte)); } catch { throw new Error('Mot de passe maître incorrect.'); }
  try {
    const s = await session(compte, brute, coffre);
    if (kdfPlusFaible(coffre.kdf)) {
      const kdf = auMoins(coffre.kdf);
      s.renfort = { kdf, cle: await sceller(await deriverEnveloppe(motDePasse, kdf), brute, AAD.coffre(compte)) };
    }
    return s;
  } finally { effacer(brute); }
}

/** Changer de mot de passe maître : la clé du coffre ne change pas, seule son enveloppe. */
export async function changerMaitre({ ancien, recuperation }, nouveau, coffre, compte) {
  let brute;
  if (recuperation) {
    try { brute = await ouvrir(await enveloppeRecuperation(recuperation), coffre.recuperation, AAD.recuperation(compte)); } catch { throw new Error('Clé de récupération incorrecte.'); }
  } else {
    try { brute = await ouvrir(await deriverEnveloppe(ancien, coffre.kdf), coffre.cle, AAD.coffre(compte)); } catch { throw new Error('Mot de passe maître actuel incorrect.'); }
  }
  try {
    const kdf = auMoins(coffre.kdf);
    const cle = await sceller(await deriverEnveloppe(nouveau, kdf), brute, AAD.coffre(compte));
    return { kdf, cle, session: await session(compte, brute, coffre) };
  } finally { effacer(brute); }
}

/** Une nouvelle clé de récupération (l'ancienne cesse de valoir). Demande le mot de passe maître. */
export async function nouvelleRecuperation(motDePasse, coffre, compte) {
  let brute;
  try { brute = await ouvrir(await deriverEnveloppe(motDePasse, coffre.kdf), coffre.cle, AAD.coffre(compte)); } catch { throw new Error('Mot de passe maître incorrect.'); }
  const recup = aleatoire(32);
  const texte = formaterRecuperation(recup);
  try { return { recuperation: texte, bloc: await sceller(await enveloppeRecuperation(texte), brute, AAD.recuperation(compte)) }; } finally { effacer(brute); effacer(recup); }
}

// Les préférences (favoris, verrouillage) : chiffrées elles aussi.
export const chiffrerPreferences = (s, prefs) => sceller(s.cleCoffre, te.encode(JSON.stringify(prefs)), AAD.preferences(s.compte));
export async function dechiffrerPreferences(s, bloc) {
  if (!bloc) return {};
  return JSON.parse(td.decode(await ouvrir(s.cleCoffre, bloc, AAD.preferences(s.compte))));
}

export const nouvelId = () => b64u(aleatoire(16));

/** Un élément neuf : sa clé propre, enveloppée pour le propriétaire. */
export async function chiffrerNouveau(s, element, id = nouvelId()) {
  const brute = aleatoire(32);
  try {
    const cleEl = await aes(brute);
    return { id, chiffre: await sceller(cleEl, te.encode(JSON.stringify(element)), AAD.element(id)), cle: await sceller(s.cleCoffre, brute, AAD.cle(id, s.compte)) };
  } finally { effacer(brute); }
}

/** La clé brute d'un élément, depuis la ligne reçue : la sienne, ou celle d'un partage. */
async function cleBrute(s, ligne) {
  if (ligne.via === 'partage') {
    const m = /^e1\.([A-Za-z0-9_-]{80,200})\.(v1\..+)$/.exec(String(ligne.cle || ''));
    if (!m) throw new Error('Partage illisible.');
    const eph = await subtle.importKey('spki', deB64u(m[1]), ECDH, false, []);
    const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: eph }, s.privee, 256));
    try { return await ouvrir(await hkdf(secret, `sesame/partage/v1/${ligne.id}/${s.compte}`), m[2], AAD.partage(ligne.id, s.compte)); } finally { effacer(secret); }
  }
  return ouvrir(s.cleCoffre, ligne.cle, AAD.cle(ligne.id, s.compte));
}

export async function dechiffrerElement(s, ligne) {
  const brute = await cleBrute(s, ligne);
  try { return JSON.parse(td.decode(await ouvrir(await aes(brute), ligne.chiffre, AAD.element(ligne.id)))); } finally { effacer(brute); }
}

/** Le même élément, modifié : même clé, nouveau chiffré. */
export async function rechiffrer(s, ligne, element) {
  const brute = await cleBrute(s, ligne);
  try { return await sceller(await aes(brute), te.encode(JSON.stringify(element)), AAD.element(ligne.id)); } finally { effacer(brute); }
}

/** La clé de l'élément, enveloppée pour la clé publique d'un autre compte. */
export async function envelopperPour(s, ligne, destinataire) {
  const brute = await cleBrute(s, ligne);
  try {
    const dest = await subtle.importKey('spki', deB64u(destinataire.clePublique), ECDH, false, []);
    const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
    const secret = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: dest }, eph.privateKey, 256));
    try {
      const k = await hkdf(secret, `sesame/partage/v1/${ligne.id}/${destinataire.id}`);
      return `e1.${b64u(await subtle.exportKey('spki', eph.publicKey))}.${await sceller(k, brute, AAD.partage(ligne.id, destinataire.id))}`;
    } finally { effacer(secret); }
  } finally { effacer(brute); }
}

export async function exporterChiffre(elements, motDePasse) {
  const kdf = nouveauKdf();
  const bloc = await sceller(await deriverEnveloppe(motDePasse, kdf), te.encode(JSON.stringify(elements)), AAD.export());
  return JSON.stringify({ format: 'sesame-export', version: 1, kdf, bloc });
}
export async function importerChiffre(texte, motDePasse) {
  let o;
  try { o = JSON.parse(texte); } catch { throw new Error('Fichier illisible.'); }
  if (o?.format !== 'sesame-export') throw new Error('Ce n’est pas un export de SÉSAME.');
  let elements;
  try { elements = JSON.parse(td.decode(await ouvrir(await deriverEnveloppe(motDePasse, o.kdf), o.bloc, AAD.export()))); } catch (e) { throw new Error(/Paramètres/.test(e.message) ? e.message : 'Mot de passe d’export incorrect.'); }
  if (!Array.isArray(elements)) throw new Error('Export illisible.');
  return elements.filter(e => e && typeof e === 'object').map(borne);
}

/** Un élément importé ramené à la forme de SÉSAME : champs connus seulement, en texte, bornés. */
function borne(e) {
  const t = (v, n) => String(v ?? '').slice(0, n);
  return {
    type: e.type === 'note' ? 'note' : 'acces', nom: t(e.nom, 120) || 'Sans nom', url: t(e.url, 500), identifiant: t(e.identifiant, 300),
    motDePasse: t(e.motDePasse, 1000), notes: t(e.notes, 20000), totp: t(e.totp, 500), espace: t(e.espace, 60), favori: e.favori === true,
  };
}

/** Un entier uniforme dans [0, n) : rejet des valeurs qui biaiseraient le modulo. */
export function uniforme(n) {
  const a = new Uint32Array(1), limite = Math.floor(0x100000000 / n) * n;
  do globalThis.crypto.getRandomValues(a); while (a[0] >= limite);
  return a[0] % n;
}
export const JEUX = { majuscules: 'ABCDEFGHJKLMNPQRSTUVWXYZ', minuscules: 'abcdefghijkmnopqrstuvwxyz', chiffres: '23456789', symboles: '!#$%&*+-=?@^_~' };
const JEUX_COMPLETS = { majuscules: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', minuscules: 'abcdefghijklmnopqrstuvwxyz', chiffres: '0123456789', symboles: '!#$%&*+-=?@^_~' };
/** Au moins un caractère de chaque jeu choisi, puis mélange de Fisher-Yates. */
export function generer({ longueur = 20, majuscules = true, minuscules = true, chiffres = true, symboles = true, ambigus = false } = {}) {
  const src = ambigus ? JEUX_COMPLETS : JEUX;
  const jeux = Object.entries({ majuscules, minuscules, chiffres, symboles }).filter(([, v]) => v).map(([k]) => src[k]);
  if (!jeux.length) throw new Error('Choisis au moins un type de caractère.');
  const n = Math.max(8, Math.min(128, longueur | 0));
  const tous = jeux.join('');
  const out = jeux.map(j => j[uniforme(j.length)]);
  while (out.length < n) out.push(tous[uniforme(tous.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = uniforme(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

/** Entropie estimée (bits) d'après les familles de caractères présentes : un indicateur, pas une garantie. */
export function entropie(mdp) {
  const s = String(mdp || '');
  if (!s) return 0;
  let alphabet = 0;
  if (/[a-z]/.test(s)) alphabet += 26;
  if (/[A-Z]/.test(s)) alphabet += 26;
  if (/\d/.test(s)) alphabet += 10;
  if (/[^A-Za-z0-9]/.test(s)) alphabet += 33;
  // Les répétitions comptent peu : au plus deux positions par caractère distinct.
  const distincts = new Set(s).size;
  const utile = Math.min(s.length, distincts * 2);
  return Math.round(utile * Math.log2(alphabet || 1));
}
export const COMMUNS = new Set(['123456', '123456789', '12345678', 'password', 'motdepasse', 'azerty', 'azertyuiop', 'qwerty', '111111', '000000', 'iloveyou', 'admin', 'soleil', 'doudou', 'loulou', 'chouchou', 'bonjour', 'password1', 'azerty123']);
export function force(mdp) {
  const s = String(mdp || '');
  if (!s) return { niveau: 'vide', bits: 0 };
  if (COMMUNS.has(s.toLowerCase())) return { niveau: 'faible', bits: 0 };
  const bits = entropie(s);
  return { niveau: bits >= 80 && s.length >= 14 ? 'robuste' : bits >= 60 && s.length >= 12 ? 'correct' : 'faible', bits };
}

/** Un secret TOTP, saisi en base 32 ou en adresse otpauth://. */
export function lireTotp(saisie) {
  const t = String(saisie || '').trim();
  if (!t) return null;
  if (/^otpauth:\/\//i.test(t)) {
    const u = new URL(t);
    if (u.host.toLowerCase() !== 'totp') throw new Error('Seuls les codes temporels (totp) sont pris en charge.');
    const p = u.searchParams;
    const algo = (p.get('algorithm') || 'SHA1').toUpperCase();
    if (!['SHA1', 'SHA256', 'SHA512'].includes(algo)) throw new Error('Algorithme A2F inconnu.');
    const chiffres = Number(p.get('digits') || 6), periode = Number(p.get('period') || 30);
    if (![6, 7, 8].includes(chiffres) || !(periode >= 15 && periode <= 120)) throw new Error('Paramètres A2F invalides.');
    const secret = (p.get('secret') || '').toUpperCase().replace(/\s/g, '');
    if (deBase32(secret).length < 10) throw new Error('Secret A2F trop court.');
    return { secret, algo, chiffres, periode, emetteur: p.get('issuer') || decodeURIComponent(u.pathname.slice(1)).split(':')[0] || '' };
  }
  const secret = t.toUpperCase().replace(/[\s-]/g, '');
  if (deBase32(secret).length < 10) throw new Error('Secret A2F trop court (16 caractères base 32 au moins).');
  return { secret, algo: 'SHA1', chiffres: 6, periode: 30, emetteur: '' };
}
export async function codeTotp(p, maintenant = Date.now()) {
  const cle = await subtle.importKey('raw', deBase32(p.secret), { name: 'HMAC', hash: { SHA1: 'SHA-1', SHA256: 'SHA-256', SHA512: 'SHA-512' }[p.algo || 'SHA1'] }, false, ['sign']);
  const pas = new ArrayBuffer(8);
  new DataView(pas).setBigUint64(0, BigInt(Math.floor(maintenant / 1000 / (p.periode || 30))));
  const h = new Uint8Array(await subtle.sign('HMAC', cle, pas));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  const d = p.chiffres || 6;
  return String(n % 10 ** d).padStart(d, '0');
}

export function lireCsv(texte) {
  const lignes = [];
  let champ = '', ligne = [], guillemets = false;
  const s = String(texte).replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (guillemets) {
      if (c === '"') { if (s[i + 1] === '"') { champ += '"'; i++; } else guillemets = false; } else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some(x => x !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); if (ligne.some(x => x !== '')) lignes.push(ligne); }
  return lignes;
}
const COLONNES = {
  nom: ['name', 'title', 'nom'],
  url: ['url', 'login_uri', 'website', 'site', 'adresse'],
  identifiant: ['username', 'login_username', 'login', 'email', 'identifiant'],
  motDePasse: ['password', 'login_password', 'mot de passe', 'motdepasse'],
  notes: ['notes', 'note', 'extra', 'comments'],
  totp: ['totp', 'login_totp', 'otpauth', 'otp'],
  type: ['type'],
  favori: ['favorite', 'favori'],
  espace: ['folder', 'grouping', 'dossier', 'espace'],
};
/** Les lignes d'un export CSV, rendues en éléments de SÉSAME (rien ne part tant qu'ils ne sont pas chiffrés). */
export function depuisCsv(texte) {
  const [tete, ...lignes] = lireCsv(texte);
  if (!tete) throw new Error('Fichier vide.');
  const idx = {};
  const t = tete.map(x => x.trim().toLowerCase());
  for (const [k, noms] of Object.entries(COLONNES)) { const i = t.findIndex(x => noms.includes(x)); if (i >= 0) idx[k] = i; }
  if (idx.motDePasse === undefined && idx.notes === undefined) throw new Error('Colonnes non reconnues : il faut au moins « password » ou « notes ».');
  const lu = (l, k) => (idx[k] === undefined ? '' : String(l[idx[k]] ?? '').trim());
  return lignes.map(l => {
    const type = /note/i.test(lu(l, 'type')) ? 'note' : 'acces';
    const url = lu(l, 'url');
    return borne({
      type, nom: lu(l, 'nom') || domaineDe(url), url, identifiant: lu(l, 'identifiant'), motDePasse: lu(l, 'motDePasse'), notes: lu(l, 'notes'),
      totp: lu(l, 'totp'), espace: lu(l, 'espace'), favori: ['1', 'true', 'oui'].includes(lu(l, 'favori').toLowerCase()),
    });
  }).filter(e => e.motDePasse || e.notes || e.identifiant);
}
const champCsv = v => (/[",\n\r]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
// Un tableur exécute une cellule qui commence par = + - @ : les champs descriptifs
// sont neutralisés par une apostrophe. Le mot de passe et le secret A2F restent
// exacts, sans quoi l'import ailleurs serait faux.
const sansFormule = v => (/^[=+\-@\t\r]/.test(String(v ?? '')) ? `'${v}` : v);
export function versCsv(elements) {
  const entete = ['type', 'name', 'url', 'username', 'password', 'totp', 'notes', 'folder', 'favorite'];
  return [entete.join(','), ...elements.map(e => [e.type, sansFormule(e.nom), sansFormule(e.url), sansFormule(e.identifiant), e.motDePasse, e.totp, sansFormule(e.notes), sansFormule(e.espace), e.favori ? 1 : 0].map(champCsv).join(','))].join('\r\n');
}

/** Le domaine d'une adresse saisie, pour le logo et la recherche ; vide si ce n'en est pas un. */
export function domaineDe(valeur) {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(valeur) ? valeur : `https://${valeur}`);
    if (!['http:', 'https:'].includes(u.protocol)) return '';
    const h = u.hostname.toLowerCase().replace(/^www\./, '');
    return /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(h) ? h : '';
  } catch { return ''; }
}
