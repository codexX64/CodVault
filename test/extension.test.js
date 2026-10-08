// L'extension, hors navigateur : son cœur (liaison, ouverture, session gardée,
// lecture du coffre, choix des éléments pour un site) contre un vrai serveur,
// avec un faux stockage d'extension. Le remplissage dans une vraie page est
// vérifié par outils/parcours-extension.mjs, dans Chromium.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '../socle/essai/client.js';
import { adminComplet } from '../socle/essai/inscription.js';
import { demarrer } from '../src/main.js';
import * as C from '../web/crypto.js';
import { COPIES } from '../outils/extension.mjs';

const RACINE = path.resolve(import.meta.dirname, '..');
const zone = () => {
  const m = new Map();
  return {
    m,
    async get(cles) { return Object.fromEntries([].concat(cles).filter(k => m.has(k)).map(k => [k, structuredClone(m.get(k))])); },
    async set(o) { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
    async remove(cles) { for (const k of [].concat(cles)) m.delete(k); },
  };
};
const alarmes = new Map();
globalThis.chrome = {
  storage: { local: zone(), session: zone() },
  alarms: { async create(n, o) { alarmes.set(n, o); }, async clear(n) { alarmes.delete(n); } },
};
const X = await import('../extension/coeur.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codvault-ext-'));
const INSTALL = 'jeton-d-installation-pour-les-essais-ext';
const MAITRE = 'phrase maîtresse de l’extension';
let serveur, admin, code;

before(async () => {
  process.umask(0o077);
  serveur = await demarrer({ DATA_DIR: tmp, PORT: '0', HOTE: '127.0.0.1', SOCLE_JETON_INSTALLATION: INSTALL, CODVAULT_LOGOS: 'non' }, { log: { info() {}, warn() {}, error() {} } });
  admin = new Client(serveur.port);
  await adminComplet(admin, { jeton: INSTALL });
  const { compte } = (await admin.get('/api/coffre')).json;
  const n = await C.creerCoffre(MAITRE, compte);
  assert.equal((await admin.post('/api/coffre', n.publique)).status, 200);
  for (const e of [
    { type: 'acces', nom: 'Banque', url: 'https://banque.exemple.org/connexion', identifiant: 'ana', motDePasse: 'mdp-banque', totp: 'JBSWY3DPEHPK3PXP' },
    { type: 'acces', nom: 'Exemple', url: 'exemple.org', identifiant: 'ana@exemple.org', motDePasse: 'mdp-exemple' },
    { type: 'acces', nom: 'Ailleurs', url: 'https://autre.org', identifiant: 'x', motDePasse: 'y' },
    { type: 'note', nom: 'Note exemple.org', url: 'https://exemple.org', notes: 'secret' },
  ]) assert.equal((await admin.post('/api/elements', await C.chiffrerNouveau(n.session, e))).status, 200);
  code = (await admin.post('/api/appareils', { nom: 'Essai' })).json.code;
});
after(async () => { await serveur?.arreter(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('code de liaison : HTTPS (ou localhost) seulement, rien d’autre que l’origine', () => {
  const { origine, jeton } = X.lireCode(code);
  assert.equal(origine, `http://localhost:${serveur.port}`);
  assert.match(jeton, /^cvd_/);
  const avec = o => `CV1.${Buffer.from(o).toString('base64url')}.${jeton}`;
  assert.equal(X.lireCode(avec('https://coffre.exemple.org')).origine, 'https://coffre.exemple.org');
  for (const o of ['http://coffre.exemple.org', 'https://coffre.exemple.org/chemin', 'https://u:p@coffre.exemple.org', 'javascript:alert(1)', 'https://x.org/?a=1'])
    assert.throws(() => X.lireCode(avec(o)), undefined, o);
  for (const t of ['', 'CV1.abc', code + 'x', code.replace('cvd_', 'cvx_')]) assert.throws(() => X.lireCode(t), undefined, t);
});

test('ouvrir, garder la session le temps choisi, la perdre à l’échéance, ne rien garder à « chaque fois »', async () => {
  const { origine, jeton } = X.lireCode(code);
  await X.essayer(origine, jeton);
  await X.lier(origine, jeton);
  const l = await X.liaison();
  assert.equal(l.delai, X.DELAI_DEFAUT);
  await assert.rejects(X.ouvrirAvec(l, 'pas le bon'), /incorrect/);
  assert.equal(chrome.storage.session.m.size, 0, 'rien gardé après un échec');
  const s = await X.ouvrirAvec(l, MAITRE);
  assert.ok(s.cleCoffre);
  const garde = chrome.storage.session.m;
  assert.match(garde.get('cle'), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(garde.get('echeance') > Date.now() && garde.get('echeance') <= Date.now() + l.delai * 60e3);
  assert.ok(alarmes.has('verrou'));
  assert.equal(chrome.storage.local.m.has('cle'), false, 'la clé ne touche jamais le disque');
  assert.ok(await X.reprendre(l), 'reprise sans mot de passe avant l’échéance');
  garde.set('echeance', Date.now() - 1);
  assert.equal(await X.reprendre(l), null, 'échéance passée : verrouillé');
  assert.equal(garde.size, 0);
  await X.choisirDelai(0);
  const l0 = await X.liaison();
  assert.equal(l0.delai, 0);
  await X.ouvrirAvec(l0, MAITRE);
  assert.equal(garde.size, 0, '« à chaque ouverture » : rien gardé');
  assert.equal(await X.reprendre(l0), null);
  await X.choisirDelai(X.DELAI_DEFAUT);
});

test('éléments pour le site : domaine exact ou parent, jamais un domaine qui l’imite, jamais une note, jamais en HTTP', async () => {
  const l = await X.liaison();
  const s = await X.ouvrirAvec(l, MAITRE);
  const { elements, illisibles } = await X.elements(l, s);
  assert.equal(illisibles, 0);
  assert.equal(elements.length, 4);
  const noms = url => X.pourLeSite(elements, X.hoteDe(url)).map(e => e.nom).sort();
  assert.deepEqual(noms('https://banque.exemple.org/login'), ['Banque', 'Exemple']);
  assert.deepEqual(noms('https://www.exemple.org/'), ['Exemple']);
  assert.deepEqual(noms('https://compte.exemple.org/'), ['Exemple']);
  for (const url of ['https://exemple.org.evil.com/', 'https://notexemple.org/', 'https://exemple.orge/', 'http://exemple.org/', 'file:///exemple.org', 'chrome://settings', 'javascript:1'])
    assert.deepEqual(noms(url), [], url);
  assert.match(await X.code(elements.find(e => e.nom === 'Banque')), /^\d{6}$/);
});

test('appareil retiré : l’extension le dit, et ne garde rien', async () => {
  const l = await X.liaison();
  const { appareils } = (await admin.get('/api/appareils')).json;
  for (const a of appareils) assert.equal((await admin.del(`/api/appareils/${a.id}`)).status, 200);
  await assert.rejects(X.ouvrirAvec(l, MAITRE), e => e.delie === true);
  await X.delier();
  assert.equal(await X.liaison(), null);
  assert.equal(chrome.storage.session.m.size, 0);
});

test('manifeste : permissions au plus juste, aucune page lue sans clic, aucune ressource exposée aux sites', () => {
  const m = JSON.parse(fs.readFileSync(path.join(RACINE, 'extension/manifest.json'), 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.equal(m.version, JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8')).version);
  assert.deepEqual(m.permissions.sort(), ['activeTab', 'alarms', 'clipboardWrite', 'idle', 'offscreen', 'scripting', 'storage']);
  for (const absent of ['host_permissions', 'content_scripts', 'web_accessible_resources', 'externally_connectable', 'key', 'update_url'])
    assert.equal(m[absent], undefined, absent);
  assert.deepEqual(m.optional_host_permissions.sort(), ['http://127.0.0.1/*', 'http://localhost/*', 'https://*/*']);
  const csp = m.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self';/);
  assert.match(csp, /default-src 'none'/);
  assert.doesNotMatch(csp, /unsafe|wasm/);
  // Aucun code distant, aucun innerHTML, aucune évaluation dans l'extension.
  for (const f of ['coeur.js', 'fond.js', 'popup.js', 'presse.js', 'popup.html', 'presse.html']) {
    const t = fs.readFileSync(path.join(RACINE, 'extension', f), 'utf8');
    assert.doesNotMatch(t, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|https?:\/\/(?!localhost)/, f);
  }
});

test('l’extension chiffre avec exactement le code de l’interface web', () => {
  for (const [de, vers] of COPIES) assert.ok(fs.readFileSync(path.join(RACINE, de)).equals(fs.readFileSync(path.join(RACINE, vers))), `${vers} diffère de ${de} : node outils/extension.mjs`);
});
