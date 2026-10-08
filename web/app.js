// Interface de CODVAULT. La porte du socle connecte le compte ; puis le coffre
// se déverrouille ICI, avec le mot de passe maître, qui ne quitte jamais la
// page. Tout ce qui part au serveur est chiffré par web/crypto.js ; tout ce
// qui s'affiche a été déchiffré dans ce navigateur.
//
// Rien n'est injecté comme balisage : tout passe par h(), qui écrit du texte.
import {
  Api, porte, pageSecurite, pageComptes, h, icone, basculeTheme, appliquerTheme,
  toast, confirmer, dialogue, ajouterPictos,
} from '/socle/compte.js';
import * as C from '/crypto.js';

appliquerTheme();
const SERVICE = 'CODVAULT';
const api = new Api({ surDeconnexion: () => location.reload() });

ajouterPictos({
  coffre: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.6"/><circle cx="12" cy="12" r="3.4"/><path d="M12 8.6v1.2M12 14.2v1.2M8.6 12h1.2M14.2 12h1.2M6.5 19.5v1.5M17.5 19.5v1.5"/>',
  etoile: '<path d="m12 3.8 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/>',
  etincelle: '<path d="M12 3.5 13.9 10.1 20.5 12l-6.6 1.9L12 20.5l-1.9-6.6L3.5 12l6.6-1.9z"/>',
  horloge2: '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.5V12l3 2"/>',
  note: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h4.5M9 12h6M9 15.5h6"/>',
  partage: '<circle cx="7" cy="12" r="2.4"/><circle cx="17" cy="6.5" r="2.4"/><circle cx="17" cy="17.5" r="2.4"/><path d="m9.1 10.9 5.8-3.2M9.1 13.1l5.8 3.2"/>',
  oeil: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  oeilbarre: '<path d="M4 4l16 16M10.6 6.1A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.7 3.4M6.6 7.6C4 9.3 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.8-.4 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  ouvrir: '<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M17.5 13.5v6h-13v-13h6"/>',
  importer: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
  recherche: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  rafraichir: '<path d="M19.5 7v4.5H15M4.5 17v-4.5H9"/><path d="M5.5 9.5a7 7 0 0 1 12.5-1.9l1.5 3.9M4.5 12.5l1.5 3.9a7 7 0 0 0 12.5-1.9"/>',
  liste: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
});

// En HTTP ailleurs que sur localhost, le navigateur ne donne pas WebCrypto : aucun coffre ne peut s'ouvrir.
if (!globalThis.isSecureContext || !globalThis.crypto?.subtle) {
  document.body.replaceChildren(h('div', { class: 'porte' }, h('div', { class: 'halos', 'aria-hidden': 'true' }, h('i'), h('i')),
    h('div', { class: 'wiz' },
      h('div', { class: 'whead' }, h('div', { class: 'brand' }, h('div', { class: 'g' }, icone('coffre', 18)), h('div', {}, h('b', { text: SERVICE })))),
      h('div', { class: 'wbody' }, h('h1', { text: 'HTTPS demandé' }),
        h('p', { class: 'sub', text: 'Le navigateur ne chiffre qu’en HTTPS, ou sur localhost : ouvre CODVAULT par son adresse en https://, celle du relais ou celle que le Hub publie.' })))));
  await new Promise(() => {});
}
const etatPorte = await porte({ api, service: SERVICE, sousTitre: 'coffre de mots de passe' });
const moi = etatPorte.session.compte;
const admin = moi.role === 'admin';
const membre = admin || moi.role === 'membre';

const sur = fn => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
const quand = t => new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
const pluriel = (n, mot, pl = mot + 's') => `${n} ${n > 1 ? pl : mot}`;
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// L'état du coffre ouvert : en mémoire seulement.
let coffre = null;          // ce que le serveur garde (chiffré)
let cles = null;            // clé du coffre et clé privée : CryptoKey non exportables
let lignes = new Map();     // id → ligne reçue (chiffrée)
let elements = new Map();   // id → élément déchiffré
let illisibles = 0;
let prefs = { favoris: [], verrou: 10, presse: 30 };

function plein(titre, sous, corps, pied = []) {
  const wiz = h('div', { class: 'wiz' },
    h('div', { class: 'whead' }, h('div', { class: 'brand' }, h('div', { class: 'g' }, icone('coffre', 18)),
      h('div', {}, h('b', { text: SERVICE }), h('span', { text: moi.identifiant })), h('div', { class: 'th' }, basculeTheme()))),
    h('div', { class: 'wbody' }, h('h1', { text: titre }), sous ? h('p', { class: 'sub', text: sous }) : null, corps),
    h('div', { class: 'wfoot' }, pied));
  const racine = h('div', { class: 'porte' }, h('div', { class: 'halos', 'aria-hidden': 'true' }, h('i'), h('i')), wiz, h('div', { class: 'credit', text: `${SERVICE} · Codex64` }));
  document.body.replaceChildren(racine);
  wiz.querySelector('input')?.focus();
  return racine;
}
let nChamp = 0;
function champ(etiquette, attrs = {}, aide) {
  const id = `c-${++nChamp}`;
  const input = h('input', { class: 'field', id, ...attrs });
  return { input, noeud: h('label', { class: 'champ', for: id }, h('span', { class: 'lbl', text: etiquette }), input, aide ? h('p', { class: 'hint', text: aide }) : null) };
}
const occupe = async (bouton, err, fn) => {
  err.textContent = '';
  bouton.setAttribute('aria-busy', 'true'); bouton.disabled = true;
  try { await fn(); } catch (e) { err.textContent = e.message; } finally { bouton.removeAttribute('aria-busy'); bouton.disabled = false; }
};
function jaugeMaitre(input) {
  const barre = h('i');
  const txt = h('span', { class: 'hint' });
  input.addEventListener('input', () => {
    const f = C.force(input.value);
    barre.style.width = `${Math.min(100, f.bits)}%`;
    barre.dataset.n = { vide: 0, faible: 1, correct: 3, robuste: 4 }[f.niveau];
    txt.textContent = input.value ? `${{ faible: 'Trop faible', correct: 'Correct', robuste: 'Robuste' }[f.niveau]} · environ ${f.bits} bits` : '';
  });
  return h('div', {}, h('div', { class: 'force', 'aria-hidden': 'true' }, barre), txt);
}
const deconnexion = async () => {
  verrouillerMemoire();
  // Sans confirmation du serveur, la session peut vivre encore : on le dit, le coffre reste verrouillé.
  try { await api.post('/api/compte/deconnexion'); } catch (e) { deverrouillage(); return toast(`Déconnexion non confirmée : ${e.message}`, true); }
  location.reload();
};

async function creation() {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const m1 = champ('Mot de passe maître', { type: 'password', autocomplete: 'new-password', minlength: 12 }, 'Il ouvre ton coffre, ici, dans ce navigateur. Il ne part jamais au serveur : personne ne peut le retrouver pour toi.');
  const m2 = champ('Le même, une seconde fois', { type: 'password', autocomplete: 'new-password' });
  const go = h('button', { class: 'next', type: 'submit' }, 'Créer mon coffre', icone('fleche'));
  const form = h('form', { class: 'grpf', onsubmit: ev => {
    ev.preventDefault();
    occupe(go, err, async () => {
      if (m1.input.value !== m2.input.value) throw new Error('Les deux saisies diffèrent.');
      if (C.force(m1.input.value).niveau === 'faible' || [...m1.input.value].length < 12) throw new Error('Trop faible : douze caractères au moins — une phrase de quatre ou cinq mots fait très bien l’affaire.');
      const neuf = await C.creerCoffre(m1.input.value, moi.id);
      // Enregistré avant d'être montré : une clé de récupération mise de côté vaut pour un coffre qui existe.
      coffre = await api.post('/api/coffre', neuf.publique);
      cles = neuf.session;
      m1.input.value = m2.input.value = '';
      await montrerRecuperation(neuf.recuperation, 'Ta clé de récupération', 'Si tu oublies ton mot de passe maître, c’est le seul moyen de rouvrir ton coffre. Garde-la hors de ce navigateur : imprimée, ou dans un autre gestionnaire.');
      await ouvrirLeCoffre();
    });
  } }, m1.noeud, m2.noeud, jaugeMaitre(m1.input), err, h('div', { class: 'wfoot' }, go));
  plein('Ton coffre', 'Tout ce que tu y ranges est chiffré dans ce navigateur, avant d’être envoyé. Le serveur ne garde que des blocs illisibles.', [form]);
}

/** La clé de récupération, montrée une fois : il faut en recopier la fin pour continuer. */
function montrerRecuperation(texte, titre, sous) {
  return new Promise(resolve => {
    const err = h('p', { class: 'erreur', role: 'alert' });
    const verif = champ('Recopie ses quatre derniers caractères', { autocomplete: 'off', class: 'field mono', spellcheck: false, maxlength: 4 });
    const go = h('button', { class: 'next', type: 'button', onclick: () => {
      if (verif.input.value.trim().toUpperCase() !== texte.slice(-4)) { err.textContent = 'Ce ne sont pas les quatre derniers caractères.'; return; }
      resolve();
    } }, 'Je l’ai mise de côté', icone('fleche'));
    plein(titre, sous, [
      h('div', { class: 'recup mono', text: texte }),
      h('div', { class: 'actions' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => copier(texte, 'Clé copiée', 120) }, icone('copie', 14), 'Copier'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => fichier(`codvault-recuperation-${moi.identifiant}.txt`, `CODVAULT — clé de récupération du compte ${moi.identifiant}\n\n${texte}\n\nElle rouvre le coffre si le mot de passe maître est oublié. Garde-la hors ligne.\n`, 'text/plain') }, icone('telecharge', 14), 'Télécharger')),
      verif.noeud, err], [go]);
  });
}

async function deverrouillage() {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const m = champ('Mot de passe maître', { type: 'password', autocomplete: 'current-password' });
  const go = h('button', { class: 'next', type: 'submit' }, 'Déverrouiller', icone('fleche'));
  const form = h('form', { class: 'grpf', onsubmit: ev => {
    ev.preventDefault();
    occupe(go, err, async () => {
      cles = await C.deverrouiller(m.input.value, coffre, moi.id);
      m.input.value = '';
      if (cles.renfort) {
        // Enveloppe d'avant les paramètres actuels : réenveloppée au passage.
        const { renfort } = cles;
        delete cles.renfort;
        try { coffre = { ...coffre, ...await api.put('/api/coffre/kdf', { version: coffre.version, ...renfort }) }; }
        catch (x) { toast(`Dérivation non renforcée : ${x.message}`, true); }
      }
      await ouvrirLeCoffre();
    });
  } }, m.noeud, err, h('div', { class: 'wfoot' }, go));
  plein('Coffre verrouillé', `${moi.identifiant} · le mot de passe maître ne quitte pas ce navigateur.`, [form,
    h('div', { class: 'actions pile mt12' },
      h('button', { class: 'btn sm flat', type: 'button', onclick: recuperation }, icone('bouee', 14), 'Mot de passe maître oublié'),
      h('button', { class: 'btn sm flat', type: 'button', onclick: deconnexion }, icone('sortie', 14), 'Se déconnecter'))]);
}

async function recuperation() {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const k = champ('Clé de récupération', { autocomplete: 'off', class: 'field mono', spellcheck: false, placeholder: 'XXXX-XXXX-…' });
  const m1 = champ('Nouveau mot de passe maître', { type: 'password', autocomplete: 'new-password' });
  const m2 = champ('Le même, une seconde fois', { type: 'password', autocomplete: 'new-password' });
  const go = h('button', { class: 'next', type: 'submit' }, 'Rouvrir le coffre', icone('fleche'));
  const form = h('form', { class: 'grpf', onsubmit: ev => {
    ev.preventDefault();
    occupe(go, err, async () => {
      if (m1.input.value !== m2.input.value) throw new Error('Les deux saisies diffèrent.');
      if (C.force(m1.input.value).niveau === 'faible') throw new Error('Nouveau mot de passe trop faible.');
      // Lire l'enveloppe de récupération demande de confirmer son identité (renfort du socle).
      const { recuperation: bloc } = await api.get('/api/coffre/recuperation');
      const ch = await C.changerMaitre({ recuperation: k.input.value }, m1.input.value, { ...coffre, recuperation: bloc }, moi.id);
      coffre = { ...coffre, ...(await api.put('/api/coffre/maitre', { kdf: ch.kdf, cle: ch.cle })) };
      cles = ch.session;
      toast('Coffre rouvert : ton nouveau mot de passe maître est en place.');
      await ouvrirLeCoffre();
    });
  } }, k.noeud, m1.noeud, m2.noeud, jaugeMaitre(m1.input), err, h('div', { class: 'wfoot' }, go));
  plein('Rouvrir avec la clé de récupération', 'La clé imprimée à la création du coffre. Tu choisis ensuite un nouveau mot de passe maître.', [form,
    h('button', { class: 'btn sm flat mt12', type: 'button', onclick: deverrouillage }, icone('retour', 14), 'Retour')]);
}

let minuterieVerrou = null;
function verrouillerMemoire() {
  cles = null; lignes = new Map(); elements = new Map(); illisibles = 0;
  clearTimeout(minuterieVerrou); clearInterval(minuterieCodes);
}
function verrouiller(message) {
  verrouillerMemoire();
  deverrouillage();
  if (message) toast(message);
}
const reveil = () => {
  clearTimeout(minuterieVerrou);
  if (cles) minuterieVerrou = setTimeout(() => verrouiller('Coffre verrouillé après inactivité.'), (prefs.verrou || 10) * 60e3);
};
for (const ev of ['pointerdown', 'keydown', 'wheel', 'touchstart']) document.addEventListener(ev, reveil, { passive: true });

let effacement = null;
async function copier(texte, message = 'Copié', secondes = prefs.presse || 30) {
  try { await navigator.clipboard.writeText(texte); } catch { return toast('Copie refusée par le navigateur.', true); }
  toast(`${message} — effacé du presse-papiers dans ${secondes} s.`);
  clearTimeout(effacement);
  // Le navigateur refuse d'écrire dans le presse-papiers d'un onglet sans focus : l'effacement attend alors son retour.
  const vider = () => navigator.clipboard.writeText('').catch(() => addEventListener('focus', vider, { once: true }));
  effacement = setTimeout(vider, secondes * 1000);
}
function fichier(nom, contenu, type) {
  const a = h('a', { href: URL.createObjectURL(new Blob([contenu], { type })), download: nom });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function chargerElements() {
  const { elements: l } = await api.get('/api/elements');
  // Un bloc qui ne s'ouvre pas (altéré, ou partage retiré entre-temps) est compté et signalé, jamais affiché.
  const dechiffres = await Promise.all(l.map(async ligne => {
    try { return [ligne, await C.dechiffrerElement(cles, ligne)]; } catch { return [ligne, null]; }
  }));
  lignes = new Map(); elements = new Map(); illisibles = 0;
  for (const [ligne, el] of dechiffres) {
    lignes.set(ligne.id, ligne);
    if (el) elements.set(ligne.id, el); else illisibles++;
  }
}
async function chargerPrefs() {
  try { prefs = { ...prefs, ...(await C.dechiffrerPreferences(cles, coffre.preferences)) }; } catch { /* préférences illisibles : les défauts */ }
}
const sauverPrefs = async () => { await api.put('/api/coffre/preferences', { preferences: await C.chiffrerPreferences(cles, prefs) }); };

function analyse() {
  const parMdp = new Map();
  for (const [id, e] of elements) if (e.type !== 'note' && e.motDePasse) { const l = parMdp.get(e.motDePasse) || []; l.push(id); parMdp.set(e.motDePasse, l); }
  const reutilises = new Set([...parMdp.values()].filter(l => l.length > 1).flat());
  const faibles = new Set([...elements].filter(([, e]) => e.type !== 'note' && e.motDePasse && C.force(e.motDePasse).niveau === 'faible').map(([id]) => id));
  return { reutilises, faibles };
}

// Logos : initiales tout de suite, le logo du site s'il arrive.
function teinte(texte) { let x = 0; for (const c of String(texte)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; }
function logo(e, taille = 'm') {
  const d = C.domaineDe(e.url || '');
  const base = h('span', { class: `logo ${taille}` }, h('span', { class: 'ini', text: (e.nom || d || '?').trim().slice(0, 1).toUpperCase() }));
  base.style.setProperty('--teinte', teinte(d || e.nom));
  if (e.type === 'note') { base.replaceChildren(icone('note', 15)); base.classList.add('note'); return base; }
  if (d) {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
    img.addEventListener('load', () => base.classList.add('a-image'));
    img.addEventListener('error', () => img.remove());
    img.src = `/api/logos/${encodeURIComponent(d)}`;
    base.append(img);
  }
  return base;
}

let stage, navs = {}, compteurs = {};
const PAGES = {
  coffre: { titre: 'Tout le coffre', ic: 'coffre', rendre: q => pageCoffre(q) },
  favoris: { titre: 'Favoris', ic: 'etoile', rendre: () => pageCoffre(new URLSearchParams('f=favoris')) },
  notes: { titre: 'Notes', ic: 'note', rendre: () => pageCoffre(new URLSearchParams('f=notes')) },
  partages: { titre: 'Partagés', ic: 'partage', rendre: () => pageCoffre(new URLSearchParams('f=partages')) },
  generateur: { titre: 'Générateur', ic: 'etincelle', rendre: pageGenerateur },
  codes: { titre: 'Codes A2F', ic: 'horloge2', rendre: pageCodes },
  importer: { titre: 'Importer, exporter', ic: 'importer', rendre: pageImport },
  cles: { titre: 'Coffre et clés', ic: 'cle', rendre: pageCles },
  securite: { titre: 'Sécurité du compte', ic: 'cadenas', rendre: () => pageSecurite(api, { service: SERVICE, confidentialite: '/confidentialite.txt' }) },
  ...(admin ? { comptes: { titre: 'Comptes', ic: 'utilisateurs', rendre: () => pageComptes(api, { service: SERVICE }) } } : {}),
};
let pageCourante = 'coffre';

function coquille() {
  navs = {}; compteurs = {};
  const lien = k => (navs[k] = h('button', { class: 'nav', type: 'button', 'aria-label': PAGES[k].titre, onclick: () => aller(k) },
    icone(PAGES[k].ic), h('span', { text: PAGES[k].titre }), compteurs[k] = h('span', { class: 'cnt' })));
  const groupe = (nom, l) => h('div', { class: 'grp' }, h('span', { text: nom }), l.filter(k => PAGES[k]).map(lien));
  stage = h('div', { class: 'stage' });
  const app = h('div', { class: 'app' },
    h('nav', { class: 'rail', 'aria-label': 'Navigation' },
      h('div', { class: 'mark' }, h('div', { class: 'g' }, icone('coffre', 15)), h('b', { text: SERVICE })),
      groupe('Coffre', ['coffre', 'favoris', 'notes', 'partages']),
      groupe('Outils', ['generateur', 'codes', 'importer']),
      groupe('Compte', ['cles', 'securite', 'comptes']),
      h('div', { class: 'railcard' },
        h('div', { class: 'row' }, icone('utilisateurs', 14), h('span', { class: 'tronque', text: moi.identifiant })),
        h('button', { class: 'btn sm plein mt12', type: 'button', onclick: () => verrouiller() }, icone('cadenas', 14), 'Verrouiller'),
        h('button', { class: 'btn sm flat plein', type: 'button', onclick: deconnexion }, icone('sortie', 14), 'Se déconnecter'))),
    h('div', { class: 'voile-rail', onclick: () => app.classList.remove('menu-ouvert') }),
    h('main', { class: 'main' },
      h('header', { class: 'top' },
        h('button', { class: 'ghost menu', type: 'button', 'aria-label': 'Menu', onclick: () => app.classList.toggle('menu-ouvert') }, icone('menu')),
        h('div', { class: 'topright' },
          h('button', { class: 'ghost', type: 'button', 'aria-label': 'Verrouiller le coffre', title: 'Verrouiller', onclick: () => verrouiller() }, icone('cadenas')),
          basculeTheme(), h('div', { class: 'who', title: moi.identifiant, text: moi.identifiant.slice(0, 2).toUpperCase() }))),
      stage));
  document.body.replaceChildren(app);
  coquille.app = app;
}
function majCompteurs() {
  const n = f => [...elements.entries()].filter(f).length;
  compteurs.coffre.textContent = elements.size || '';
  compteurs.favoris.textContent = prefs.favoris.filter(id => elements.has(id)).length || '';
  compteurs.notes.textContent = n(([, e]) => e.type === 'note') || '';
  compteurs.partages.textContent = n(([id]) => lignes.get(id)?.via === 'partage' || lignes.get(id)?.partages?.length) || '';
  compteurs.codes.textContent = n(([, e]) => e.totp) || '';
}
async function aller(cible) {
  const [k0, requete = ''] = String(cible).split('?');
  const k = PAGES[k0] ? k0 : 'coffre';
  pageCourante = k;
  clearInterval(minuterieCodes);
  for (const [n, b] of Object.entries(navs)) b.classList.toggle('on', n === k);
  coquille.app?.classList.remove('menu-ouvert');
  history.replaceState(null, '', '#' + k + (requete ? '?' + requete : ''));
  majCompteurs();
  try { stage.replaceChildren(await PAGES[k].rendre(new URLSearchParams(requete))); } catch (e) { stage.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'erreur', text: e.message }))); }
  stage.scrollTop = 0;
}
const rafraichir = () => aller(location.hash.slice(1) || pageCourante);

async function ouvrirLeCoffre() {
  await chargerPrefs();
  await chargerElements();
  coquille();
  reveil();
  await aller(location.hash.slice(1) || 'coffre');
  if (illisibles) toast(`${pluriel(illisibles, 'élément illisible')} : bloc altéré ou partage retiré.`, true);
}

const FILTRES = { tous: 'Tout', favoris: 'Favoris', faibles: 'À renforcer', reutilises: 'Réutilisés', partages: 'Partagés', notes: 'Notes' };
const ESPACE_TOUS = '';
function pageCoffre(q) {
  const f = FILTRES[q.get('f')] ? q.get('f') : 'tous';
  const { reutilises, faibles } = analyse();
  const fav = new Set(prefs.favoris);
  let recherche = q.get('q') || '', espace = ESPACE_TOUS;
  const espaces = [...new Set([...elements.values()].map(e => e.espace).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

  const liste = h('div', { class: 'elements', role: 'list' });
  const pied = h('p', { class: 'hint' });
  const passe = (id, e) => {
    const l = lignes.get(id);
    if (f === 'favoris' && !fav.has(id)) return false;
    if (f === 'faibles' && !faibles.has(id)) return false;
    if (f === 'reutilises' && !reutilises.has(id)) return false;
    if (f === 'partages' && !(l.via === 'partage' || l.partages?.length)) return false;
    if (f === 'notes' && e.type !== 'note') return false;
    if (espace && e.espace !== espace) return false;
    const r = norm(recherche);
    return !r || [e.nom, e.identifiant, C.domaineDe(e.url || ''), e.espace].some(x => norm(x).includes(r));
  };
  const peindre = () => {
    const l = [...elements.entries()].filter(([id, e]) => passe(id, e))
      .sort(([a, x], [b, y]) => (fav.has(b) - fav.has(a)) || String(x.nom).localeCompare(String(y.nom), 'fr'));
    liste.replaceChildren(...(l.length ? l.map(([id, e]) => rangee(id, e, { reutilises, faibles, fav, apres: peindre })) : [h('div', { class: 'vide', text: elements.size ? 'Rien ne correspond.' : 'Ton coffre est vide. Ajoute un premier accès, ou importe ceux de ton ancien gestionnaire.' })]));
    pied.textContent = `${pluriel(l.length, 'élément')} affiché${l.length > 1 ? 's' : ''} · déchiffrés dans ce navigateur`;
  };
  const champRecherche = h('input', { class: 'field', type: 'search', placeholder: 'Rechercher — nom, identifiant, site', value: recherche, 'aria-label': 'Rechercher dans le coffre', autocomplete: 'off', spellcheck: 'false' });
  champRecherche.addEventListener('input', () => { recherche = champRecherche.value; peindre(); });
  const choixEspace = espaces.length ? h('select', { class: 'field espace', 'aria-label': 'Espace', onchange: e => { espace = e.target.value; peindre(); } },
    h('option', { value: ESPACE_TOUS, text: 'Tous les espaces' }), espaces.map(x => h('option', { value: x, text: x }))) : null;
  peindre();
  setTimeout(() => { if (f === 'tous' && !matchMedia('(pointer: coarse)').matches) champRecherche.focus(); }, 0);

  const titre = { tous: 'Mon coffre', favoris: 'Favoris', faibles: 'À renforcer', reutilises: 'Mots de passe réutilisés', partages: 'Partagés', notes: 'Notes sécurisées' }[f];
  const lede = {
    tous: `${pluriel(elements.size, 'élément')} · ${faibles.size} à renforcer · ${reutilises.size} réutilisé${reutilises.size > 1 ? 's' : ''}`,
    favoris: 'Ce que tu ouvres le plus souvent. Les favoris sont chiffrés avec ton coffre.',
    faibles: 'Trop courts, trop simples ou trop connus. Ouvre-les et génère un remplaçant.',
    reutilises: 'Un même mot de passe sur plusieurs sites : une fuite chez l’un ouvre les autres.',
    partages: 'Ce que tu partages, et ce qu’on t’a partagé. Chaque partage est chiffré pour son destinataire.',
    notes: 'Codes, réponses secrètes, informations sensibles : chiffrées comme le reste.',
  }[f];
  return h('div', { class: 'page' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: titre }), h('p', { class: 'lede', text: lede })),
      membre ? h('div', { class: 'actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => editer(null, { type: 'note' }) }, icone('note', 15), 'Note'),
        h('button', { class: 'btn solid', type: 'button', onclick: () => editer(null, { type: 'acces' }) }, icone('plus', 15), 'Accès')) : null),
    h('div', { class: 'outils' }, h('label', { class: 'recherche' }, icone('recherche', 15), champRecherche), choixEspace),
    h('div', { class: 'onglets', role: 'tablist' }, Object.entries(FILTRES).map(([k, t]) => {
      const n = { tous: elements.size, favoris: [...fav].filter(id => elements.has(id)).length, faibles: faibles.size, reutilises: reutilises.size,
        partages: [...lignes.values()].filter(l => elements.has(l.id) && (l.via === 'partage' || l.partages?.length)).length, notes: [...elements.values()].filter(e => e.type === 'note').length }[k];
      return h('button', { class: 'onglet' + (k === f ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': String(k === f), onclick: () => aller(`coffre?f=${k}`) }, t, n ? h('em', { text: n }) : null);
    })),
    liste, pied);
}

function rangee(id, e, { reutilises, faibles, fav, apres }) {
  const l = lignes.get(id);
  const d = C.domaineDe(e.url || '');
  const etoile = h('button', { class: 'etoile' + (fav.has(id) ? ' on' : ''), type: 'button', 'aria-pressed': String(fav.has(id)), 'aria-label': fav.has(id) ? `Retirer ${e.nom} des favoris` : `Mettre ${e.nom} en favori`, onclick: sur(async ev => {
    ev.stopPropagation();
    prefs.favoris = fav.has(id) ? prefs.favoris.filter(x => x !== id) : [...prefs.favoris, id];
    fav.has(id) ? fav.delete(id) : fav.add(id);
    await sauverPrefs(); majCompteurs(); apres();
  }) }, icone('etoile', 15));
  const puces = [
    faibles.has(id) ? h('span', { class: 'chip warn', text: 'À renforcer' }) : null,
    reutilises.has(id) ? h('span', { class: 'chip warn', text: 'Réutilisé' }) : null,
    e.totp ? h('span', { class: 'chip', text: 'A2F' }) : null,
    l.via === 'partage' ? h('span', { class: 'chip info', text: `de ${l.proprietaire}` }) : l.partages?.length ? h('span', { class: 'chip info', text: `partagé · ${l.partages.length}` }) : null,
  ].filter(Boolean);
  return h('div', { class: 'el', role: 'listitem' },
    h('button', { class: 'el-corps', type: 'button', 'data-donnee': '', onclick: () => detail(id) },
      logo(e),
      h('span', { class: 'el-nom' }, h('b', { class: 'tronque', text: e.nom || d || 'Sans nom' }), h('small', { class: 'tronque', text: e.type === 'note' ? (e.espace || 'Note') : (e.identifiant || d || '—') })),
      h('span', { class: 'el-site cache-s mono tronque', text: e.type === 'note' ? '' : d }),
      h('span', { class: 'el-puces cache-m' }, puces)),
    e.type !== 'note' && e.motDePasse ? h('button', { class: 'ghost el-copie', type: 'button', title: 'Copier le mot de passe', 'aria-label': `Copier le mot de passe de ${e.nom}`, onclick: () => copier(e.motDePasse, 'Mot de passe copié') }, icone('copie', 15)) : h('span', { class: 'el-copie' }),
    etoile);
}

let minuterieCodes = null;
function ligneDetail(libelle, valeur, { secret = false, mono = false, lien = null, copie = true } = {}) {
  let visible = !secret;
  const v = h('span', { class: 'val' + (mono || secret ? ' mono' : ''), text: secret ? '••••••••••••' : valeur });
  const oeil = secret ? h('button', { class: 'ghost', type: 'button', 'aria-label': 'Afficher', onclick: () => { visible = !visible; v.textContent = visible ? valeur : '••••••••••••'; oeil.replaceChildren(icone(visible ? 'oeilbarre' : 'oeil', 15)); } }, icone('oeil', 15)) : null;
  return h('div', { class: 'det' }, h('span', { class: 'lbl', text: libelle }), h('div', { class: 'det-val' }, v,
    oeil, lien ? h('a', { class: 'ghost', href: lien, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Ouvrir le site' }, icone('ouvrir', 15)) : null,
    copie ? h('button', { class: 'ghost', type: 'button', 'aria-label': `Copier ${libelle.toLowerCase()}`, onclick: () => copier(valeur, `${libelle} copié`) }, icone('copie', 15)) : null));
}
function codeVivant(totp) {
  let p;
  try { p = C.lireTotp(totp); } catch { return h('div', { class: 'det' }, h('span', { class: 'lbl', text: 'Code A2F' }), h('span', { class: 'erreur', text: 'Secret A2F illisible.' })); }
  const code = h('b', { class: 'code mono', text: '··· ···' });
  const barre = h('i');
  let courant = '';
  const maj = async () => {
    courant = await C.codeTotp(p);
    code.textContent = courant.length === 6 ? `${courant.slice(0, 3)} ${courant.slice(3)}` : courant;
    const reste = (p.periode || 30) - Math.floor(Date.now() / 1000) % (p.periode || 30);
    barre.style.width = `${(reste / (p.periode || 30)) * 100}%`;
    barre.dataset.bas = String(reste <= 5);
  };
  maj();
  const t = setInterval(() => { if (!code.isConnected) return clearInterval(t); maj(); }, 1000);
  return h('div', { class: 'det' }, h('span', { class: 'lbl', text: 'Code A2F' }),
    h('div', { class: 'det-val' }, code, h('button', { class: 'ghost', type: 'button', 'aria-label': 'Copier le code', onclick: () => copier(courant, 'Code copié', 30) }, icone('copie', 15))),
    h('div', { class: 'bar fine' }, barre));
}

async function detail(id) {
  const e = elements.get(id), l = lignes.get(id);
  const d = C.domaineDe(e.url || '');
  const mien = l.via === 'propre';
  const peutEcrire = membre && (mien || l.droits === 'ecriture');
  const contenu = [
    h('div', { class: 'det-tete' }, logo(e, 'l'), h('div', { class: 'grow1' }, h('b', { text: e.nom }), h('small', { text: [d, e.espace].filter(Boolean).join(' · ') || (e.type === 'note' ? 'Note sécurisée' : '') }))),
    e.type !== 'note' && e.identifiant ? ligneDetail('Identifiant', e.identifiant) : null,
    e.type !== 'note' && e.motDePasse ? ligneDetail('Mot de passe', e.motDePasse, { secret: true }) : null,
    e.type !== 'note' && e.url ? ligneDetail('Site', e.url, { lien: /^https?:\/\//i.test(e.url) ? e.url : d ? `https://${d}` : null }) : null,
    e.totp ? codeVivant(e.totp) : null,
    e.notes ? h('div', { class: 'det' }, h('span', { class: 'lbl', text: 'Notes' }), h('pre', { class: 'notes', text: e.notes })) : null,
    h('p', { class: 'hint', text: [mien ? null : `Partagé par ${l.proprietaire} · ${l.droits === 'ecriture' ? 'modifiable' : 'lecture seule'}`,
      l.partages?.length ? `Partagé avec ${l.partages.map(p => p.identifiant).join(', ')}` : null, `Modifié ${quand(l.modifie)}`].filter(Boolean).join(' · ') }),
  ];
  const choix = await dialogue({ titre: e.type === 'note' ? 'Note' : 'Accès', contenu, large: true, boutons: [
    ...(mien && membre ? [{ texte: 'Supprimer', classe: 'flat danger', valeur: 'supprimer' }, { texte: 'Partager', classe: 'flat', valeur: 'partager' }] : []),
    ...(!mien ? [{ texte: 'Quitter le partage', classe: 'flat danger', valeur: 'quitter' }] : []),
    ...(peutEcrire ? [{ texte: 'Modifier', classe: '', valeur: 'modifier' }] : []),
    { texte: 'Fermer', classe: 'solid', valeur: null },
  ] });
  if (choix === 'modifier') return editer(id, e);
  if (choix === 'partager') return partager(id);
  if (choix === 'supprimer') {
    if (!(await confirmer(`Supprimer ${e.nom} ?`, `Supprimé pour toi${l.partages?.length ? ' et pour ceux avec qui tu le partages' : ''}. Sans retour.`, { danger: true, oui: 'Supprimer' }))) return;
    await sur(async () => { await api.del(`/api/elements/${id}`); prefs.favoris = prefs.favoris.filter(x => x !== id); await sauverPrefs().catch(() => { /* un favori orphelin est ignoré à l'affichage */ }); toast('Supprimé.'); await chargerElements(); rafraichir(); })();
  }
  if (choix === 'quitter') {
    if (!(await confirmer(`Quitter le partage de ${e.nom} ?`, `Il disparaît de ton coffre ; ${l.proprietaire} le garde.`, { danger: true, oui: 'Quitter' }))) return;
    await sur(async () => { await api.del(`/api/elements/${id}/partages/${encodeURIComponent(moi.id)}`); await chargerElements(); rafraichir(); })();
  }
}

async function editer(id, base = { type: 'acces' }) {
  const e = { type: 'acces', nom: '', url: '', identifiant: '', motDePasse: '', totp: '', notes: '', espace: '', ...base };
  const note = e.type === 'note';
  const f = {
    nom: champ('Nom', { value: e.nom, maxlength: 120, required: true, autocomplete: 'off', placeholder: note ? 'Code du portail, réponses secrètes…' : 'GitHub' }),
    url: champ('Site', { value: e.url, maxlength: 500, autocomplete: 'off', spellcheck: false, class: 'field mono', placeholder: 'github.com' }),
    identifiant: champ('Identifiant ou adresse', { value: e.identifiant, maxlength: 300, autocomplete: 'off', spellcheck: false }),
    motDePasse: champ('Mot de passe', { value: e.motDePasse, maxlength: 1000, autocomplete: 'new-password', spellcheck: false, class: 'field mono', type: 'password' }),
    totp: champ('Secret A2F', { value: e.totp, maxlength: 500, autocomplete: 'off', spellcheck: false, class: 'field mono', placeholder: 'JBSW Y3DP… ou otpauth://…' }, 'Le secret donné par le site à l’activation de la double authentification (texte sous le QR code).'),
    espace: champ('Espace', { value: e.espace, maxlength: 60, autocomplete: 'off', list: 'espaces', placeholder: 'Personnel' }),
  };
  const notes = h('textarea', { class: 'field', rows: note ? 8 : 3, maxlength: 20000, text: e.notes });
  const espaces = h('datalist', { id: 'espaces' }, [...new Set([...elements.values()].map(x => x.espace).filter(Boolean))].map(x => h('option', { value: x })));
  const err = h('p', { class: 'erreur', role: 'alert' });
  const voir = h('button', { class: 'btn sm flat', type: 'button', onclick: () => { const t = f.motDePasse.input.type === 'password'; f.motDePasse.input.type = t ? 'text' : 'password'; voir.textContent = t ? 'Masquer' : 'Afficher'; } }, 'Afficher');
  const gen = h('button', { class: 'btn sm', type: 'button', onclick: () => { f.motDePasse.input.value = C.generer(prefs.generateur || {}); f.motDePasse.input.type = 'text'; voir.textContent = 'Masquer'; f.motDePasse.input.dispatchEvent(new Event('input')); } }, icone('etincelle', 14), 'Générer');
  const force = h('span', { class: 'hint' });
  f.motDePasse.input.addEventListener('input', () => { const x = C.force(f.motDePasse.input.value); force.textContent = f.motDePasse.input.value ? `${{ faible: 'Faible', correct: 'Correct', robuste: 'Robuste' }[x.niveau]} · environ ${x.bits} bits` : ''; });
  f.motDePasse.input.dispatchEvent(new Event('input'));
  const contenu = note
    ? [f.nom.noeud, h('label', { class: 'champ' }, h('span', { class: 'lbl', text: 'Contenu' }), notes), f.espace.noeud, espaces, err]
    : [f.nom.noeud, f.url.noeud, f.identifiant.noeud, f.motDePasse.noeud, h('div', { class: 'actions' }, gen, voir, force), f.totp.noeud, f.espace.noeud, espaces,
      h('label', { class: 'champ' }, h('span', { class: 'lbl', text: 'Notes' }), notes), err];
  await dialogue({ titre: id ? `Modifier ${e.nom}` : note ? 'Nouvelle note' : 'Nouvel accès', contenu, large: true, boutons: [
    { texte: 'Annuler', classe: 'flat', valeur: null },
    { texte: 'Enregistrer', classe: 'solid', agir: async () => {
      err.textContent = '';
      try {
        const el = { type: e.type, nom: f.nom.input.value.trim(), url: f.url.input.value.trim(), identifiant: f.identifiant.input.value.trim(), motDePasse: f.motDePasse.input.value,
          totp: f.totp.input.value.trim(), notes: notes.value, espace: f.espace.input.value.trim(), modifie: Date.now() };
        if (!el.nom) throw new Error('Donne-lui un nom.');
        if (el.totp) C.lireTotp(el.totp);
        if (note) { delete el.url; delete el.identifiant; delete el.motDePasse; delete el.totp; }
        if (id) {
          const l = lignes.get(id);
          await api.put(`/api/elements/${id}`, { version: l.version, chiffre: await C.rechiffrer(cles, l, el) });
        } else {
          const n = await C.chiffrerNouveau(cles, el);
          await api.post('/api/elements', n);
        }
        await chargerElements();
        toast(id ? 'Enregistré.' : 'Ajouté à ton coffre.');
        rafraichir();
        return true;
      } catch (x) { err.textContent = x.message; return false; }
    } },
  ] });
}

async function partager(id) {
  const e = elements.get(id), l = lignes.get(id);
  const { destinataires } = await api.get('/api/destinataires');
  const err = h('p', { class: 'erreur', role: 'alert' });
  const existants = h('div', { class: 'partages' }, (l.partages || []).map(p => h('div', { class: 'row' },
    h('span', { class: 'grow1 tronque', text: `${p.identifiant} · ${p.droits === 'ecriture' ? 'peut modifier' : 'lecture seule'}` }),
    h('button', { class: 'btn sm flat danger', type: 'button', onclick: sur(async () => {
      await api.del(`/api/elements/${id}/partages/${encodeURIComponent(p.destinataire)}`);
      toast(`Partage retiré pour ${p.identifiant}. S’il a pu lire le mot de passe, change-le sur le site.`);
      await chargerElements(); rafraichir();
    }) }, 'Retirer'))));
  if (!destinataires.length) {
    return dialogue({ titre: `Partager ${e.nom}`, texte: 'Aucun autre compte n’a encore créé son coffre : il faut qu’il se connecte une fois à CODVAULT pour recevoir un partage.', contenu: [existants], boutons: [{ texte: 'Fermer', classe: 'solid', valeur: null }] });
  }
  const qui = h('select', { class: 'field', 'aria-label': 'Destinataire' }, destinataires.map(d => h('option', { value: d.id, text: d.identifiant })));
  const droits = h('select', { class: 'field', 'aria-label': 'Droits' }, h('option', { value: 'lecture', text: 'Lecture seule' }), h('option', { value: 'ecriture', text: 'Peut modifier' }));
  const emp = h('p', { class: 'empreinte mono' });
  const majEmp = async () => { const d = destinataires.find(x => x.id === qui.value); emp.textContent = d ? await C.empreinte(d.clePublique) : ''; };
  qui.addEventListener('change', majEmp); majEmp();
  await dialogue({ titre: `Partager ${e.nom}`, large: true, contenu: [
    h('p', { class: 'hint mt0', text: 'L’élément est chiffré pour la clé publique du destinataire : le serveur ne peut pas le lire. Avant un partage sensible, demande-lui l’empreinte affichée dans « Coffre et clés » et compare-la avec celle-ci.' }),
    h('label', { class: 'champ' }, h('span', { class: 'lbl', text: 'Avec' }), qui),
    h('label', { class: 'champ' }, h('span', { class: 'lbl', text: 'Droits' }), droits),
    h('div', { class: 'champ' }, h('span', { class: 'lbl', text: 'Empreinte de sa clé' }), emp),
    existants, err],
  boutons: [{ texte: 'Fermer', classe: 'flat', valeur: null }, { texte: 'Partager', classe: 'solid', agir: async () => {
    try {
      const d = destinataires.find(x => x.id === qui.value);
      await api.put(`/api/elements/${id}/partages`, { destinataire: d.id, droits: droits.value, cle: await C.envelopperPour(cles, l, d) });
      toast(`Partagé avec ${d.identifiant}.`);
      await chargerElements(); rafraichir();
      return true;
    } catch (x) { err.textContent = x.message; return false; }
  } }] });
}

function pageGenerateur() {
  const o = { longueur: 20, majuscules: true, minuscules: true, chiffres: true, symboles: true, ambigus: false, ...(prefs.generateur || {}) };
  const sortie = h('div', { class: 'genere mono', 'aria-live': 'polite' });
  const info = h('p', { class: 'hint' });
  const longueur = h('input', { type: 'range', min: 8, max: 64, value: o.longueur, 'aria-label': 'Longueur' });
  const lib = h('b', { class: 'mono', text: String(o.longueur) });
  const refaire = () => {
    try { sortie.textContent = C.generer(o); const f = C.force(sortie.textContent); info.textContent = `${{ faible: 'Faible', correct: 'Correct', robuste: 'Robuste' }[f.niveau]} · environ ${f.bits} bits · aléatoire cryptographique du navigateur`; } catch (e) { toast(e.message, true); }
  };
  const garder = sur(async () => { prefs.generateur = { ...o }; await sauverPrefs(); });
  longueur.addEventListener('input', () => { o.longueur = Number(longueur.value); lib.textContent = longueur.value; refaire(); });
  longueur.addEventListener('change', garder);
  const bascule = (k, t, aide) => {
    const b = h('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(!!o[k]), 'aria-label': t }, h('i'));
    b.addEventListener('click', () => {
      const v = b.getAttribute('aria-checked') !== 'true';
      if (!v && k !== 'ambigus' && ['majuscules', 'minuscules', 'chiffres', 'symboles'].filter(x => o[x]).length === 1) return toast('Garde au moins un type de caractère.', true);
      b.setAttribute('aria-checked', String(v)); o[k] = v; refaire(); garder();
    });
    return h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: t }), aide ? h('small', { text: aide }) : null), b);
  };
  refaire();
  return h('div', { class: 'page etroite' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Générateur' }), h('p', { class: 'lede', text: 'Un mot de passe différent pour chaque site. Rien n’est envoyé au serveur.' }))),
    sortie, info,
    h('div', { class: 'actions pile mt12' },
      h('button', { class: 'btn solid', type: 'button', onclick: refaire }, icone('rafraichir', 15), 'Générer'),
      h('button', { class: 'btn', type: 'button', onclick: () => copier(sortie.textContent, 'Mot de passe copié') }, icone('copie', 15), 'Copier'),
      membre ? h('button', { class: 'btn flat', type: 'button', onclick: () => editer(null, { type: 'acces', motDePasse: sortie.textContent }) }, icone('plus', 15), 'Nouvel accès avec') : null),
    h('div', { class: 'reglages mt12' },
      h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: 'Longueur' }), h('small', { text: '20 caractères suffisent largement ; certains sites en limitent le nombre.' })), lib),
      longueur,
      bascule('majuscules', 'Majuscules'), bascule('minuscules', 'Minuscules'), bascule('chiffres', 'Chiffres'), bascule('symboles', 'Symboles', '! # $ % & * + - = ? @ ^ _ ~'),
      bascule('ambigus', 'Caractères ambigus', 'Autoriser 0 O 1 l I : à éviter si tu dois le recopier à la main.')));
}

function pageCodes() {
  const avec = [...elements.entries()].filter(([, e]) => e.totp).sort(([, a], [, b]) => String(a.nom).localeCompare(String(b.nom), 'fr'));
  const rangs = avec.map(([id, e]) => {
    let p = null;
    try { p = C.lireTotp(e.totp); } catch { /* secret illisible : affiché comme tel */ }
    const code = h('b', { class: 'code mono', text: p ? '··· ···' : 'illisible' });
    const barre = h('i');
    let courant = '';
    const maj = async () => {
      if (!p) return;
      courant = await C.codeTotp(p);
      code.textContent = courant.length === 6 ? `${courant.slice(0, 3)} ${courant.slice(3)}` : courant;
      const reste = (p.periode || 30) - Math.floor(Date.now() / 1000) % (p.periode || 30);
      barre.style.width = `${(reste / (p.periode || 30)) * 100}%`;
      barre.dataset.bas = String(reste <= 5);
    };
    return { maj, noeud: h('div', { class: 'el code-ligne' },
      h('button', { class: 'el-corps', type: 'button', 'data-donnee': '', onclick: () => detail(id) }, logo(e),
        h('span', { class: 'el-nom' }, h('b', { class: 'tronque', text: e.nom }), h('small', { class: 'tronque', text: e.identifiant || C.domaineDe(e.url || '') || '—' }))),
      h('div', { class: 'code-bloc' }, code, h('div', { class: 'bar fine' }, barre)),
      h('button', { class: 'ghost el-copie', type: 'button', 'aria-label': `Copier le code de ${e.nom}`, onclick: () => courant && copier(courant, 'Code copié', 30) }, icone('copie', 15))) };
  });
  const tout = () => rangs.forEach(r => r.maj());
  tout();
  minuterieCodes = setInterval(tout, 1000);
  return h('div', { class: 'page' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Codes A2F' }), h('p', { class: 'lede', text: 'Calculés dans ce navigateur à partir des secrets de ton coffre. Ajoute un secret A2F dans un accès pour le voir ici.' }))),
    h('div', { class: 'elements' }, rangs.length ? rangs.map(r => r.noeud) : h('div', { class: 'vide', text: 'Aucun accès n’a encore de secret A2F.' })));
}

function pageImport() {
  const err = h('p', { class: 'erreur', role: 'alert' });
  const apercu = h('div', {});
  const entree = h('input', { type: 'file', accept: '.csv,.codvault,.json,text/csv,application/json', class: 'field', 'aria-label': 'Fichier à importer' });
  entree.addEventListener('change', sur(async () => {
    err.textContent = ''; apercu.replaceChildren();
    const f = entree.files?.[0];
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) throw new Error('Fichier trop gros (20 Mo au plus).');
    const texte = await f.text();
    let liste;
    if (/^\s*\{/.test(texte)) {
      const mdp = champ('Mot de passe de l’export', { type: 'password', autocomplete: 'off' });
      const ok = await dialogue({ titre: 'Export de CODVAULT', texte: 'Ce fichier est chiffré : tape le mot de passe choisi à l’export.', contenu: [mdp.noeud], boutons: [{ texte: 'Annuler', classe: 'flat', valeur: false }, { texte: 'Ouvrir', classe: 'solid', valeur: true }] });
      if (!ok) return;
      liste = await C.importerChiffre(texte, mdp.input.value);
    } else liste = C.depuisCsv(texte);
    const existants = new Set([...elements.values()].map(e => `${norm(e.nom)}|${norm(e.identifiant)}|${e.motDePasse || ''}`));
    const neufs = liste.filter(e => !existants.has(`${norm(e.nom)}|${norm(e.identifiant)}|${e.motDePasse || ''}`));
    const go = h('button', { class: 'btn solid', type: 'button', disabled: !neufs.length || !membre, onclick: sur(async () => {
      go.disabled = true;
      for (let i = 0; i < neufs.length; i += 200) {
        const lot = await Promise.all(neufs.slice(i, i + 200).map(e => C.chiffrerNouveau(cles, { ...e, modifie: Date.now() })));
        await api.post('/api/elements/lot', { elements: lot });
      }
      await chargerElements();
      toast(`${pluriel(neufs.length, 'élément importé')}.`);
      entree.value = ''; apercu.replaceChildren();
      majCompteurs();
    }) }, icone('importer', 15), `Importer ${pluriel(neufs.length, 'élément')}`);
    apercu.replaceChildren(h('p', { class: 'hint', text: `${pluriel(liste.length, 'élément lu')} · ${pluriel(liste.length - neufs.length, 'déjà présent')} · ${neufs.length} à importer. Chacun est chiffré ici avant l’envoi.` }), go,
      h('p', { class: 'hint', text: 'Pense à supprimer le fichier d’export en clair de ton disque une fois l’import fait.' }));
  }));
  // Un export ne prend que ses propres éléments : ceux qu'on lui partage restent chez leur propriétaire.
  const miens = () => [...elements].filter(([id]) => lignes.get(id)?.via === 'propre').map(([, e]) => e);
  const exportChiffre = sur(async () => {
    const m1 = champ('Mot de passe de l’export', { type: 'password', autocomplete: 'new-password' }, 'Il ouvrira ce fichier à l’import. Différent de ton mot de passe maître, de préférence.');
    const m2 = champ('Le même, une seconde fois', { type: 'password', autocomplete: 'new-password' });
    const e2 = h('p', { class: 'erreur', role: 'alert' });
    await dialogue({ titre: 'Export chiffré', contenu: [m1.noeud, m2.noeud, e2], boutons: [{ texte: 'Annuler', classe: 'flat', valeur: null }, { texte: 'Exporter', classe: 'solid', agir: async () => {
      if (m1.input.value !== m2.input.value) { e2.textContent = 'Les deux saisies diffèrent.'; return false; }
      if (C.force(m1.input.value).niveau === 'faible') { e2.textContent = 'Trop faible.'; return false; }
      fichier(`codvault-${new Date().toISOString().slice(0, 10)}.codvault`, await C.exporterChiffre(miens(), m1.input.value), 'application/json');
      return true;
    } }] });
  });
  const exportClair = sur(async () => {
    const m = champ('Mot de passe maître', { type: 'password', autocomplete: 'current-password' });
    const e2 = h('p', { class: 'erreur', role: 'alert' });
    await dialogue({ titre: 'Export en clair', texte: 'Tous tes mots de passe, lisibles par quiconque ouvre le fichier (ceux qu’on te partage n’y sont pas). Seulement pour passer à un autre gestionnaire ; supprime le fichier aussitôt après.', contenu: [m.noeud, e2],
      boutons: [{ texte: 'Annuler', classe: 'flat', valeur: null }, { texte: 'Exporter en clair', classe: 'danger solid', agir: async () => {
        try { await C.deverrouiller(m.input.value, coffre, moi.id); } catch (x) { e2.textContent = x.message; return false; }
        fichier(`codvault-${new Date().toISOString().slice(0, 10)}-EN-CLAIR.csv`, C.versCsv(miens()), 'text/csv');
        return true;
      } }] });
  });
  return h('div', { class: 'page etroite' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Importer, exporter' }), h('p', { class: 'lede', text: 'Depuis Bitwarden, Chrome, Edge, Firefox, Safari (CSV) ou un export de CODVAULT. Le fichier est lu et chiffré dans ce navigateur.' }))),
    h('h2', { class: 'sect', text: 'Importer' }), entree, err, apercu,
    h('h2', { class: 'sect', text: 'Exporter' }),
    h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: 'Export chiffré (.codvault)' }), h('small', { text: 'Sauvegarde à garder hors ligne ; s’importe ici avec son mot de passe.' })), h('button', { class: 'btn', type: 'button', onclick: exportChiffre }, icone('telecharge', 15), 'Exporter')),
    h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: 'Export en clair (CSV)' }), h('small', { text: 'Pour changer de gestionnaire. Demande ton mot de passe maître.' })), h('button', { class: 'btn danger', type: 'button', onclick: exportClair }, icone('alerte', 15), 'Exporter en clair')));
}

function pageCles() {
  const choix = (valeur, options, surChange, libelle) => {
    const s = h('select', { class: 'field court', 'aria-label': libelle }, options.map(([v, t]) => h('option', { value: v, text: t, selected: Number(v) === Number(valeur) })));
    s.addEventListener('change', sur(async () => { await surChange(Number(s.value)); toast('Enregistré.'); }));
    return s;
  };
  const changer = sur(async () => {
    const a = champ('Mot de passe maître actuel', { type: 'password', autocomplete: 'current-password' });
    const m1 = champ('Nouveau mot de passe maître', { type: 'password', autocomplete: 'new-password' });
    const m2 = champ('Le même, une seconde fois', { type: 'password', autocomplete: 'new-password' });
    const e2 = h('p', { class: 'erreur', role: 'alert' });
    await dialogue({ titre: 'Changer de mot de passe maître', texte: 'Ton coffre reste le même : seule son enveloppe change. Tes autres appareils devront utiliser le nouveau.', contenu: [a.noeud, m1.noeud, m2.noeud, jaugeMaitre(m1.input), e2],
      boutons: [{ texte: 'Annuler', classe: 'flat', valeur: null }, { texte: 'Changer', classe: 'solid', agir: async () => {
        try {
          if (m1.input.value !== m2.input.value) throw new Error('Les deux saisies diffèrent.');
          if (C.force(m1.input.value).niveau === 'faible') throw new Error('Nouveau mot de passe trop faible.');
          const ch = await C.changerMaitre({ ancien: a.input.value }, m1.input.value, coffre, moi.id);
          coffre = { ...coffre, ...(await api.put('/api/coffre/maitre', { kdf: ch.kdf, cle: ch.cle })) };
          cles = ch.session;
          toast('Mot de passe maître changé.');
          return true;
        } catch (x) { e2.textContent = x.message; return false; }
      } }] });
  });
  const refaireRecup = sur(async () => {
    const a = champ('Mot de passe maître', { type: 'password', autocomplete: 'current-password' });
    const e2 = h('p', { class: 'erreur', role: 'alert' });
    let neuve = null;
    await dialogue({ titre: 'Nouvelle clé de récupération', texte: 'L’ancienne cessera d’ouvrir ton coffre.', contenu: [a.noeud, e2], boutons: [{ texte: 'Annuler', classe: 'flat', valeur: null }, { texte: 'Créer', classe: 'solid', agir: async () => {
      try { neuve = await C.nouvelleRecuperation(a.input.value, coffre, moi.id); return true; } catch (x) { e2.textContent = x.message; return false; }
    } }] });
    if (!neuve) return;
    await api.put('/api/coffre/recuperation', { recuperation: neuve.bloc });
    const k = h('div', { class: 'recup mono', text: neuve.recuperation });
    await dialogue({ titre: 'Ta nouvelle clé de récupération', texte: 'Montrée une seule fois. Garde-la hors de ce navigateur.', contenu: [k,
      h('div', { class: 'actions' }, h('button', { class: 'btn sm', type: 'button', onclick: () => copier(neuve.recuperation, 'Clé copiée', 120) }, icone('copie', 14), 'Copier'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => fichier(`codvault-recuperation-${moi.identifiant}.txt`, `CODVAULT — clé de récupération du compte ${moi.identifiant}\n\n${neuve.recuperation}\n`, 'text/plain') }, icone('telecharge', 14), 'Télécharger'))],
    boutons: [{ texte: 'Je l’ai mise de côté', classe: 'solid', valeur: true }] });
    neuve = null;
  });
  return h('div', { class: 'page etroite' },
    h('div', { class: 'headrow' }, h('div', {}, h('h1', { class: 'title', text: 'Coffre et clés' }), h('p', { class: 'lede', text: 'Le mot de passe maître et la clé de récupération ouvrent ton coffre, ici seulement. Le serveur ne peut ni les lire ni les retrouver.' }))),
    h('h2', { class: 'sect', text: 'Ton empreinte' }),
    h('p', { class: 'empreinte mono', text: coffre.empreinte }),
    h('p', { class: 'hint', text: 'Celle de ta clé publique. Quelqu’un qui veut te partager un élément sensible peut la comparer, de vive voix, avec celle que CODVAULT lui montre.' }),
    h('h2', { class: 'sect', text: 'Verrouillage' }),
    h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: 'Verrouiller après' }), h('small', { text: 'Sans activité, le coffre se referme : il faut retaper le mot de passe maître.' })),
      choix(prefs.verrou, [[1, '1 min'], [5, '5 min'], [10, '10 min'], [15, '15 min'], [30, '30 min'], [60, '1 h']], async v => { prefs.verrou = v; await sauverPrefs(); reveil(); }, 'Délai de verrouillage')),
    h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: 'Effacer le presse-papiers après' }), h('small', { text: 'Un mot de passe copié n’y reste pas.' })),
      choix(prefs.presse, [[15, '15 s'], [30, '30 s'], [60, '1 min'], [120, '2 min']], async v => { prefs.presse = v; await sauverPrefs(); }, 'Délai du presse-papiers')),
    h('h2', { class: 'sect', text: 'Mot de passe maître et récupération' }),
    h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: 'Mot de passe maître' }), h('small', { text: `Argon2id (${coffre.kdf.m / 1024} Mio, ${coffre.kdf.t} passes, ${coffre.kdf.p} voies) dans ce navigateur, puis AES-256-GCM.` })),
      h('button', { class: 'btn', type: 'button', onclick: changer }, icone('crayon', 15), 'Changer')),
    h('div', { class: 'reglage-ligne' }, h('div', {}, h('strong', { text: 'Clé de récupération' }), h('small', { text: 'En refaire une si tu crains que l’ancienne ait été vue. Demande de confirmer ton identité.' })),
      h('button', { class: 'btn', type: 'button', onclick: refaireRecup }, icone('bouee', 15), 'Refaire')));
}

coffre = await api.get('/api/coffre');
document.addEventListener('keydown', e => {
  if (e.key === '/' && cles && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && !document.querySelector('.voile')) {
    e.preventDefault();
    if (pageCourante !== 'coffre') aller('coffre').then(() => document.querySelector('.recherche input')?.focus());
    else document.querySelector('.recherche input')?.focus();
  }
});
if (coffre.etat === 'nouveau') creation(); else deverrouillage();
