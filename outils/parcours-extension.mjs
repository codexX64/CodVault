// L'extension dans un vrai Chromium : liaison par code, ouverture au mot de
// passe maître, remplissage sur un site HTTPS, et tout ce qu'elle doit refuser
// (champ caché, cadre intégré d'un autre site, page qui a changé d'adresse,
// HTTP). Un serveur CODVAULT et un faux site tournent ici même.
//   xvfb-run node outils/parcours-extension.mjs [dossier-des-captures]
//
// La copie chargée de l'extension reçoit d'avance la permission sur le
// serveur d'essai et sur site.test : Chromium ne laisse pas un automate
// répondre à sa demande de permission. Tout le reste est le code livré.
// La fenêtre de l'extension s'ouvre par chrome.action.openPopup() et se pilote
// par le protocole de débogage (Playwright ne la voit pas comme une page) :
// chaque clic y est envoyé comme un geste de l'utilisateur.
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '../socle/essai/client.js';
import { adminComplet } from '../socle/essai/inscription.js';
import { demarrer } from '../src/main.js';
import * as C from '../web/crypto.js';

const RACINE = path.resolve(import.meta.dirname, '..');
const sortie = process.argv[2] || '/tmp/captures-extension';
fs.mkdirSync(sortie, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codvault-pext-'));
const MAITRE = 'phrase maîtresse du parcours de l’extension';
const silence = { info() {}, warn() {}, error() {} };

// ---- CODVAULT, un compte, un coffre, des éléments, un code de liaison ----
const serveur = await demarrer({ DATA_DIR: path.join(tmp, 'data'), PORT: '0', HOTE: '127.0.0.1', SOCLE_JETON_INSTALLATION: 'jeton-installation-parcours-ext', CODVAULT_LOGOS: 'non' }, { log: silence });
const admin = new Client(serveur.port);
await adminComplet(admin, { jeton: 'jeton-installation-parcours-ext' });
const { compte } = (await admin.get('/api/coffre')).json;
const n = await C.creerCoffre(MAITRE, compte);
await admin.post('/api/coffre', n.publique);
for (const e of [
  { type: 'acces', nom: 'Site d’essai', url: 'https://site.test', identifiant: 'ana@site.test', motDePasse: 'Mdp-du-site-9!', totp: 'JBSWY3DPEHPK3PXP' },
  { type: 'acces', nom: 'Autre site', url: 'https://autre.test', identifiant: 'ana', motDePasse: 'ne-doit-jamais-sortir' },
]) await admin.post('/api/elements', await C.chiffrerNouveau(n.session, e));
const code = (await admin.post('/api/appareils', { nom: 'Chromium' })).json.code;

// ---- le faux site, en HTTPS (certificat d'essai) ----
execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1', '-subj', '/CN=site.test',
  '-addext', 'subjectAltName=DNS:site.test,DNS:evil.test', '-keyout', path.join(tmp, 'k.pem'), '-out', path.join(tmp, 'c.pem')], { stdio: 'ignore' });
const PAGES = {
  '/connexion': `<!doctype html><meta charset=utf-8><title>Connexion</title>
    <form id=f><input id=u name=username autocomplete=username><input id=leurre type=password style="opacity:0;position:absolute;left:-999px">
    <input id=p type=password name=password autocomplete=current-password><button>Entrer</button></form>
    <iframe src="https://evil.test:PORT/cadre" width=400 height=200></iframe>`,
  '/cadre': `<!doctype html><meta charset=utf-8><input id=u2 name=username><input id=p2 type=password>`,
  '/code': `<!doctype html><meta charset=utf-8><title>Code</title><input id=otp autocomplete=one-time-code>`,
  '/favicon.ico': '',
};
const site = https.createServer({ key: fs.readFileSync(path.join(tmp, 'k.pem')), cert: fs.readFileSync(path.join(tmp, 'c.pem')) }, (req, res) => {
  const p = PAGES[new URL(req.url, 'https://x').pathname];
  res.writeHead(p !== undefined ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
  res.end((p || '').replaceAll('PORT', String(site.address().port)));
});
await new Promise(r => site.listen(0, '127.0.0.1', r));
const SITE = `https://site.test:${site.address().port}`;

// ---- la copie chargée de l'extension ----
const ext = path.join(tmp, 'extension');
fs.cpSync(path.join(RACINE, 'extension'), ext, { recursive: true });
const m = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
m.host_permissions = ['http://localhost/*', 'https://site.test/*'];
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(m));

const PORT_DEBOGAGE = 9300 + Math.floor(Math.random() * 600);
const contexte = await chromium.launchPersistentContext(path.join(tmp, 'profil'), {
  headless: false, viewport: { width: 1100, height: 760 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--remote-debugging-port=${PORT_DEBOGAGE}`, '--host-resolver-rules=MAP site.test 127.0.0.1, MAP evil.test 127.0.0.1', '--ignore-certificate-errors', '--no-proxy-server'],
});
const erreurs = [];
const surveiller = p => { p.on('pageerror', e => erreurs.push(`${p.url()} : ${e}`)); p.on('console', c => { if (c.type() === 'error') erreurs.push(`${p.url()} : ${c.text()}`); }); };
const fond = contexte.serviceWorkers()[0] ?? await contexte.waitForEvent('serviceworker');
const id = new URL(fond.url()).host;
const resultats = [];
const etape = (nom, ok, detail = '') => { resultats.push({ nom, ok, detail }); console.log(`${ok ? 'OK ' : 'ÉCHEC'}  ${nom}${detail ? ' — ' + detail : ''}`); };

// La fenêtre de l'extension, pilotée par le protocole de débogage.
class Fenetre {
  constructor(ws) { this.ws = ws; this.n = 0; this.attentes = new Map(); ws.onmessage = ev => { const m = JSON.parse(ev.data); this.attentes.get(m.id)?.(m); this.attentes.delete(m.id); }; }
  envoyer(method, params = {}) { const id = ++this.n; return new Promise(r => { this.attentes.set(id, r); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expr) {
    const r = await this.envoyer('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'erreur dans la fenêtre');
    return r.result?.result?.value;
  }
  async attendre(cond, delai = 15000) {
    const fin = Date.now() + delai;
    while (Date.now() < fin) { if (await this.eval(`!!(${cond})`).catch(() => false)) return; await new Promise(r => setTimeout(r, 150)); }
    throw new Error(`attente dépassée : ${cond}`);
  }
  texte(sel) { return this.eval(`document.querySelector(${JSON.stringify(sel)})?.textContent ?? ''`); }
  clic(sel) { return this.eval(`document.querySelector(${JSON.stringify(sel)}).click()`); }
  remplir(sel, v) { return this.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`); }
  async capture(fichier) {
    const r = await this.envoyer('Page.captureScreenshot', { format: 'png' });
    if (r.result?.data) fs.writeFileSync(fichier, Buffer.from(r.result.data, 'base64'));
  }
  async erreurs() { return this.eval('window.__erreurs || []'); }
  fermer() { this.ws.close(); }
}
let pageSite = null;
async function fenetre() {
  const ouvertes = async () => (await (await fetch(`http://127.0.0.1:${PORT_DEBOGAGE}/json/list`)).json()).filter(t => t.url.startsWith(`chrome-extension://${id}/popup.html`));
  for (let i = 0; i < 40 && (await ouvertes()).length; i++) await new Promise(r => setTimeout(r, 150));
  for (let essai = 0; ; essai++) {
    await pageSite?.bringToFront();
    try { await fond.evaluate(() => chrome.action.openPopup()); break; } catch (e) { if (essai >= 5) throw e; await new Promise(r => setTimeout(r, 400)); }
  }
  let cible;
  for (let i = 0; i < 40 && !cible; i++) {
    cible = (await (await fetch(`http://127.0.0.1:${PORT_DEBOGAGE}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith(`chrome-extension://${id}/popup.html`));
    if (!cible) await new Promise(r => setTimeout(r, 150));
  }
  if (!cible) throw new Error('fenêtre de l’extension introuvable');
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((r, e) => { ws.onopen = r; ws.onerror = e; });
  const f = new Fenetre(ws);
  await f.envoyer('Runtime.enable');
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.method === 'Runtime.exceptionThrown') erreurs.push(`fenêtre : ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') erreurs.push(`fenêtre : ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
  });
  await f.attendre("document.readyState === 'complete' && document.querySelector('#app').children.length");
  return f;
}

try {
  const page = pageSite = await contexte.newPage();
  surveiller(page);
  await page.goto(`${SITE}/connexion`);
  await page.bringToFront();

  // 1. Liaison.
  let pop = await fenetre();
  await pop.attendre("document.querySelector('#code')");
  await pop.capture(`${sortie}/1-liaison.png`);
  await pop.remplir('#code', 'CV1.pas-un-code.cvd_x');
  await pop.clic('button[type=submit]');
  await pop.attendre("document.querySelector('.erreur').textContent");
  etape('code invalide refusé', (await pop.texte('.erreur')).includes('code de liaison'));
  await pop.remplir('#code', code);
  await pop.clic('button[type=submit]');
  await pop.attendre("document.querySelector('#maitre')");
  etape('liaison acceptée', true);
  const stockage = await fond.evaluate(() => chrome.storage.local.get(null));
  etape('rien que l’adresse et le jeton sur disque', JSON.stringify(Object.keys(stockage).sort()) === '["jeton","serveur"]', Object.keys(stockage).join(','));

  // 2. Ouverture.
  await pop.remplir('#maitre', 'mauvais mot de passe');
  await pop.clic('button[type=submit]');
  await pop.attendre("document.querySelector('.erreur')?.textContent.includes('incorrect')", 20000);
  etape('mauvais mot de passe maître refusé', true);
  await pop.capture(`${sortie}/2-verrou.png`);
  await pop.remplir('#maitre', MAITRE);
  await pop.clic('button[type=submit]');
  await pop.attendre("document.querySelector('.el')", 20000);
  await pop.capture(`${sortie}/3-coffre.png`);
  const texteFenetre = await pop.eval('document.body.innerText');
  etape('aucun « null » ni « undefined » affiché', !/\b(null|undefined|NaN)\b/.test(texteFenetre));
  const pourCeSite = await pop.eval("[...document.querySelectorAll('.liste')[0].querySelectorAll('.el b')].map(b => b.textContent)");
  etape('seul l’élément du site est proposé pour lui', JSON.stringify(pourCeSite) === '["Site d’essai"]', pourCeSite.join(','));
  const remplirAutre = await pop.eval("[...document.querySelectorAll('.el')].filter(e => e.textContent.includes('Autre site') && e.querySelector('button.plein')).length");
  etape('aucun « Remplir » pour l’élément d’un autre site', remplirAutre === 0);
  const memoire = await fond.evaluate(() => chrome.storage.session.get(null));
  etape('clé du coffre en mémoire de session seulement', !!memoire.cle && !('cle' in stockage));

  // 3. Remplissage.
  await pop.clic('.liste .el button.plein');
  await page.waitForFunction(() => document.querySelector('#p').value.length > 0, null, { timeout: 5000 });
  const champs = await page.evaluate(() => ({ u: document.querySelector('#u').value, p: document.querySelector('#p').value, leurre: document.querySelector('#leurre').value }));
  etape('identifiant et mot de passe remplis', champs.u === 'ana@site.test' && champs.p === 'Mdp-du-site-9!', JSON.stringify({ u: champs.u, p: champs.p.length }));
  etape('champ mot de passe caché laissé vide', champs.leurre === '');
  const cadre = page.frames().find(f => f.url().includes('evil.test'));
  const dansCadre = await cadre.evaluate(() => document.querySelector('#u2').value + document.querySelector('#p2').value);
  etape('cadre intégré d’un autre site laissé vide', dansCadre === '');
  await page.screenshot({ path: `${sortie}/4-rempli.png` });

  // 3 bis. Un mot de passe copié quitte le presse-papiers 30 secondes plus tard.
  await contexte.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: SITE });
  pop.fermer();
  pop = await fenetre();
  await pop.attendre("document.querySelector('.liste .el')", 20000);
  await pop.clic('.liste .el button[title="Copier le mot de passe"]');
  await pop.attendre("document.querySelector('.note')?.textContent.includes('copié')", 5000);
  const noteCopie = await pop.texte('.note');
  await pop.eval('window.close()').catch(() => {});
  pop.fermer();
  await page.bringToFront();
  const copie = await page.evaluate(() => navigator.clipboard.readText());
  etape('mot de passe copié, effacement annoncé', copie === 'Mdp-du-site-9!' && noteCopie.includes('effacé dans 30 s'), noteCopie);
  await page.waitForTimeout(36_000);
  const ensuite = await page.evaluate(() => navigator.clipboard.readText());
  etape('presse-papiers vidé après 30 s', ensuite.trim() === '', JSON.stringify(ensuite));

  // 4. La page change d'adresse entre l'ouverture de la fenêtre et le clic : rien n'est posé.
  await page.goto(`${SITE}/connexion`);
  pop = await fenetre();
  await pop.attendre("document.querySelector('.liste .el button.plein')", 20000);
  etape('session reprise sans retaper le mot de passe', true);
  await page.goto(`https://evil.test:${site.address().port}/connexion`);
  await pop.clic('.liste .el button.plein');
  await pop.attendre("document.querySelector('.note.err')", 5000);
  const ailleurs = await page.evaluate(() => document.querySelector('#p').value);
  etape('page passée sur un autre site : refusé', ailleurs === '', await pop.texte('.note'));
  pop.fermer();

  // 5. Code A2F sur une page de code.
  await page.goto(`${SITE}/code`);
  pop = await fenetre();
  await pop.attendre("document.querySelector('.liste .el button.plein')", 20000);
  await pop.clic('.liste .el button.plein');
  await page.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#otp').value), null, { timeout: 5000 });
  etape('code A2F rempli sur la page de code', true);

  // 6. Verrouiller.
  pop = await fenetre();
  await pop.attendre("document.querySelector('.el')", 20000);
  await pop.clic('header button');
  await pop.attendre("document.querySelector('#maitre')");
  const apres = await fond.evaluate(() => chrome.storage.session.get(null));
  etape('verrouiller efface la clé gardée', Object.keys(apres).length === 0);
  // La fenêtre se ferme pendant l'évaluation : la réponse ne revient jamais, c'est attendu.
  await pop.eval('window.close()').catch(() => {});
  pop.fermer();

  // 7. Appareil retiré côté serveur : l'extension revient à la liaison.
  const { appareils } = (await admin.get('/api/appareils')).json;
  for (const a of appareils) await admin.del(`/api/appareils/${a.id}`);
  pop = await fenetre();
  await pop.remplir('#maitre', MAITRE);
  await pop.clic('button[type=submit]');
  await pop.attendre("document.querySelector('#code')", 20000);
  etape('appareil retiré : retour à la liaison', (await pop.texte('.erreur')).includes('plus relié'));
  await pop.capture(`${sortie}/5-retire.png`);
} catch (e) {
  etape('parcours', false, e.message.split('\n')[0]);
} finally {
  etape('aucune erreur de console', erreurs.length === 0, erreurs.join(' | '));
  await contexte.close();
  site.close();
  await serveur.arreter();
  fs.rmSync(tmp, { recursive: true, force: true });
}
const echecs = resultats.filter(r => !r.ok).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} OK`);
process.exit(echecs ? 1 : 0);
