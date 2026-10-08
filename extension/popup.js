// La fenêtre de l'extension : relier, ouvrir le coffre, choisir un élément,
// remplir ou copier. Les éléments déchiffrés ne vivent qu'ici, et disparaissent
// avec la fenêtre. Rien n'est injecté comme balisage : tout passe par h().
import {
  navigateur, lireCode, motifHote, liaison, lier, delier, choisirDelai, essayer, ouvrirAvec, reprendre, verrouiller,
  elements as lireElements, hoteDe, convient, pourLeSite, remplirOnglet, totp, DELAIS, PRESSE_SECONDES, C,
} from './coeur.js';

const app = document.getElementById('app');
const h = (tag, attrs = {}, ...enfants) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const e of enfants.flat()) if (e != null) n.append(e);
  return n;
};
let minuterie = null;
function note(texte, err = false) {
  document.querySelector('.note')?.remove();
  const n = h('div', { class: 'note' + (err ? ' err' : ''), role: err ? 'alert' : 'status', text: texte });
  document.body.append(n);
  setTimeout(() => n.remove(), 2600);
}
const tete = (sous, ...droite) => h('header', { class: 'tete' },
  h('div', { class: 'marque' }, h('img', { src: 'icones/32.png', alt: '' }), h('b', { text: 'CODVAULT' }), sous ? h('small', { text: sous }) : null), ...droite);
const ecran = (...enfants) => { clearInterval(minuterie); app.replaceChildren(...enfants.filter(e => e != null)); };

// ---- relier ----
function ecranLiaison(message = '') {
  const champ = h('textarea', { id: 'code', spellcheck: 'false', autocomplete: 'off', placeholder: 'CV1.…' });
  const erreur = h('p', { class: 'erreur', role: 'alert', text: message });
  const bouton = h('button', { class: 'plein', type: 'submit', text: 'Relier' });
  const form = h('form', { class: 'corps' },
    h('h1', { text: 'Relier cette extension' }),
    h('p', { class: 'aide', text: 'Dans CODVAULT, page Extension : « Relier une extension ». Colle ici le code affiché.' }),
    h('label', { for: 'code', text: 'Code de liaison' }, champ), erreur, bouton);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    let lu;
    try { lu = lireCode(champ.value); } catch (e) { erreur.textContent = e.message; return; }
    // La permission sur ce seul serveur, demandée dans le geste de l'utilisateur.
    const accorde = await navigateur.permissions.request({ origins: [motifHote(lu.origine)] });
    if (!accorde) { erreur.textContent = 'Permission refusée : l’extension ne peut pas joindre ton serveur.'; return; }
    bouton.disabled = true;
    try {
      await essayer(lu.origine, lu.jeton);
      await lier(lu.origine, lu.jeton);
      champ.value = '';
      demarrer();
    } catch (e) { erreur.textContent = e.message; bouton.disabled = false; }
  });
  ecran(tete(null), form);
  champ.focus();
}

// ---- ouvrir ----
function ecranVerrou(l, message = '') {
  const champ = h('input', { id: 'maitre', type: 'password', autocomplete: 'current-password', required: true });
  const erreur = h('p', { class: 'erreur', role: 'alert', text: message });
  const bouton = h('button', { class: 'plein', type: 'submit', text: 'Ouvrir' });
  const form = h('form', { class: 'corps' },
    h('h1', { text: 'Coffre verrouillé' }),
    h('label', { for: 'maitre', text: 'Mot de passe maître' }, champ), erreur, bouton);
  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    erreur.textContent = '';
    bouton.disabled = true; bouton.textContent = 'Ouverture…';
    try {
      const s = await ouvrirAvec(l, champ.value);
      champ.value = '';
      await ecranCoffre(l, s);
    } catch (e) {
      if (e.delie) return ecranLiaison(e.message);
      erreur.textContent = e.message; bouton.disabled = false; bouton.textContent = 'Ouvrir';
      champ.select();
    }
  });
  ecran(tete(new URL(l.serveur).host), form, pied(l));
  champ.focus();
}

function pied(l) {
  const choix = h('select', { 'aria-label': 'Verrouiller' }, DELAIS.map(([v, t]) => h('option', { value: String(v), text: t, selected: v === l.delai })));
  choix.addEventListener('change', async () => { l.delai = Number(choix.value); await choisirDelai(l.delai); note('Enregistré.'); });
  const oublier = h('button', { class: 'discret', type: 'button', text: 'Délier' });
  oublier.addEventListener('click', async () => { await delier(); ecranLiaison(); });
  return h('footer', { class: 'pied' }, h('span', { text: 'Garder ouvert' }), choix, oublier);
}

// ---- le coffre ouvert ----
async function ecranCoffre(l, s) {
  const [onglet] = await navigateur.tabs.query({ active: true, currentWindow: true });
  const hote = onglet ? hoteDe(onglet.url) : null;
  const { elements, illisibles } = await lireElements(l, s);
  const tri = (a, b) => String(a.nom).localeCompare(String(b.nom), 'fr');
  const acces = elements.filter(e => e.type !== 'note').sort(tri);
  const pourSite = pourLeSite(acces, hote);
  const codesSite = [], codesListe = [];

  const copier = async (texte, quoi) => {
    try { await navigator.clipboard.writeText(texte); } catch { return note('Copie refusée.', true); }
    try {
      await navigateur.runtime.sendMessage({ quoi: 'copie' });
      note(`${quoi} copié — effacé dans ${PRESSE_SECONDES} s.`);
    } catch { note(`${quoi} copié, mais l’effacement automatique n’a pas pu être programmé : vide le presse-papiers toi-même.`, true); }
  };
  const remplir = async e => {
    try {
      const fait = await remplirOnglet(onglet, e);
      note(`Rempli : ${fait.join(', ')}.`);
      setTimeout(() => window.close(), 500);
    } catch (x) { note(x.message, true); }
  };
  const ligne = (e, codes) => {
    const p = totp(e);
    const code = p ? h('button', { type: 'button', class: 'code', 'aria-label': `Copier le code A2F de ${e.nom}`, text: '··· ···' }) : null;
    if (p) {
      let courant = '';
      codes.push(async () => {
        courant = await C.codeTotp(p);
        code.textContent = courant.length === 6 ? `${courant.slice(0, 3)} ${courant.slice(3)}` : courant;
        code.title = `${(p.periode || 30) - Math.floor(Date.now() / 1000) % (p.periode || 30)} s`;
      });
      code.addEventListener('click', () => courant && copier(courant, 'Code A2F'));
    }
    const ici = convient(e, hote);
    return h('div', { class: 'el' },
      h('div', { class: 'txt' }, h('b', { text: e.nom || '(sans nom)' }), h('small', { text: e.identifiant || C.domaineDe(e.url || '') || '—' })),
      h('div', { class: 'actions' },
        ici ? h('button', { class: 'plein', type: 'button', text: 'Remplir', 'aria-label': `Remplir ${e.nom}`, onclick: () => remplir(e) }) : null,
        e.identifiant ? h('button', { type: 'button', text: 'Id', title: 'Copier l’identifiant', 'aria-label': `Copier l’identifiant de ${e.nom}`, onclick: () => copier(e.identifiant, 'Identifiant') }) : null,
        e.motDePasse ? h('button', { type: 'button', text: 'Mdp', title: 'Copier le mot de passe', 'aria-label': `Copier le mot de passe de ${e.nom}`, onclick: () => copier(e.motDePasse, 'Mot de passe') }) : null,
        code));
  };

  const recherche = h('input', { type: 'search', placeholder: 'Rechercher', 'aria-label': 'Rechercher dans le coffre', autocomplete: 'off' });
  const tous = h('div', { class: 'liste' });
  const norm = t => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtrer = () => {
    const q = norm(recherche.value);
    const l2 = q ? acces.filter(e => norm(`${e.nom} ${e.identifiant} ${e.url}`).includes(q)) : acces;
    codesListe.length = 0;
    tous.replaceChildren(...(l2.length ? l2.slice(0, 200).map(e => ligne(e, codesListe)) : [h('p', { class: 'vide', text: q ? 'Rien ne correspond.' : 'Coffre vide.' })]));
    codesListe.forEach(f => f());
  };
  recherche.addEventListener('input', filtrer);

  const fermer = h('button', { class: 'discret', type: 'button', text: 'Verrouiller', 'aria-label': 'Verrouiller le coffre' });
  fermer.addEventListener('click', async () => { await verrouiller(); ecranVerrou(l); });
  ecran(tete(hote || new URL(l.serveur).host, fermer),
    hote ? h('div', { class: 'section', text: 'Pour ce site' }) : null,
    hote ? h('div', { class: 'liste' }, pourSite.length ? pourSite.map(e => ligne(e, codesSite)) : h('p', { class: 'vide', text: `Rien pour ${hote}.` })) : null,
    h('div', { class: 'recherche' }, recherche),
    h('div', { class: 'section', text: 'Tout le coffre' }), tous,
    illisibles ? h('p', { class: 'erreur', role: 'alert', text: `${illisibles} élément(s) illisible(s) : bloc altéré ou partage retiré.` }) : null,
    pied(l));
  filtrer();
  const tic = () => [...codesSite, ...codesListe].forEach(f => f());
  tic();
  minuterie = setInterval(tic, 1000);
  (pourSite.length ? app.querySelector('.el button') : recherche)?.focus();
}

async function demarrer() {
  try {
    const l = await liaison();
    if (!l) return ecranLiaison();
    if (!(await navigateur.permissions.contains({ origins: [motifHote(l.serveur)] }))) return ecranLiaison('La permission sur ton serveur a été retirée : relie à nouveau.');
    const s = await reprendre(l).catch(e => { if (e.delie) throw e; return null; });
    return s ? ecranCoffre(l, s) : ecranVerrou(l);
  } catch (e) {
    if (e.delie) { await delier(); return ecranLiaison(e.message); }
    ecran(tete(null), h('div', { class: 'corps' }, h('p', { class: 'erreur', role: 'alert', text: e.message })));
  }
}
demarrer();
