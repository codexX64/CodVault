// Exercice de rotation de bout en bout (REQ-CFG-005) : SÉSAME lancé comme en
// production, clé maîtresse lue dans un fichier (_FILE), un compte avec TOTP,
// clé d'accès et codes de secours ; puis SOCLE_CLE tournée comme le dit le
// README, et tout ce qui existait revérifié. Dure un peu plus de trente
// secondes (un pas TOTP).
//   node outils/exercice-rotation.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const RACINE = path.resolve(import.meta.dirname, '..');
const { Client, connexion } = await import(`${RACINE}/socle/essai/client.js`);
const { Authentificateur } = await import(`${RACINE}/socle/essai/authentificateur.js`);
const totp = await import(`${RACINE}/socle/src/totp.js`);

const D = fs.mkdtempSync(path.join(os.tmpdir(), 'exercice-')), S = path.join(D, 'secrets');
fs.mkdirSync(S, { mode: 0o700 });
const PORT = 18000 + crypto.randomInt(1000), JETON = crypto.randomBytes(24).toString('base64url'), MDP = 'phrase de passe de l’exercice de rotation';
const cle = () => crypto.randomBytes(32).toString('base64');
const poser = (f, v) => fs.writeFileSync(path.join(S, f), v, { mode: 0o600 });
const lire = f => fs.readFileSync(path.join(S, f), 'utf8');
const rapport = [];
let proc, sortie = '';
const note = (ok, quoi) => { rapport.push(`${ok ? 'OK ' : 'ÉCHEC'} ${quoi}`); if (!ok) { console.log(rapport.join('\n')); console.log(sortie.slice(-2000)); process.exit(1); } };

poser('socle_cle', cle()); poser('socle_cle_ancienne', '');
async function demarrer() {
  sortie = '';
  proc = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/main.js'], { cwd: RACINE, env: {
    PATH: process.env.PATH, PORT: String(PORT), HOTE: '127.0.0.1', DATA_DIR: path.join(D, 'data'),
    SOCLE_CLE_FILE: path.join(S, 'socle_cle'), SOCLE_CLE_ANCIENNE_FILE: path.join(S, 'socle_cle_ancienne'),
    SOCLE_JETON_INSTALLATION: JETON, SESAME_LOGOS: 'non',
  } });
  proc.stdout.on('data', d => { sortie += d; }); proc.stderr.on('data', d => { sortie += d; });
  const fin = new Promise(r => proc.on('exit', c => r({ code: c })));
  for (let i = 0; i < 100; i++) {
    const r = await Promise.race([fetch(`http://127.0.0.1:${PORT}/api/health`).then(x => x.status, () => 0), fin]);
    if (r === 200) return { code: null };
    if (typeof r === 'object') return r;
    await new Promise(r => setTimeout(r, 200));
  }
  return { code: 'délai' };
}
const arreter = () => new Promise(r => { proc.on('exit', r); proc.kill('SIGTERM'); });

note((await demarrer()).code === null, 'démarrage sous la SOCLE_CLE initiale');
const a = new Client(PORT), auth = new Authentificateur();
note((await a.post('/api/compte/installation', { jeton: JETON, identifiant: 'ana', motDePasse: MDP })).status === 200, 'installation du premier compte');
const secret = (await a.post('/api/compte/totp')).json.secret;
note((await a.post('/api/compte/totp/confirmer', { code: totp.code(secret, totp.pasCourant(Date.now())) })).status === 200, 'TOTP inscrit');
const o = await a.post('/api/compte/cles/options');
note((await a.post('/api/compte/cles', { reponse: auth.creer(o.json, a.origine), nom: 'Exercice' })).json?.niveau === 'complet', 'clé d’accès inscrite');
const codes = (await a.post('/api/compte/secours')).json.codes;
await arreter();

poser('socle_cle_ancienne', lire('socle_cle')); poser('socle_cle', cle());
note((await demarrer()).code === null, 'redémarrage avec la clé neuve et l’ancienne posée');
note(/\[coffre\] Clé tournée : 1 secret\(s\) TOTP rescellé\(s\), 10 code\(s\) de secours/.test(sortie), 'SOCLE_CLE : ' + (sortie.match(/\[coffre\] Clé tournée : [^.]*\./)?.[0] || 'aucune trace'));
let c = new Client(PORT);
note((await connexion(c, 'ana', MDP)).json?.etape === 'second', 'mot de passe accepté');
await new Promise(r => setTimeout(r, 31_000));
note((await c.post('/api/compte/connexion/totp', { code: totp.code(secret, totp.pasCourant(Date.now())) })).json?.niveau === 'complet', 'TOTP inscrit avant la rotation accepté');
c = new Client(PORT); await connexion(c, 'ana', MDP);
note((await c.post('/api/compte/connexion/secours', { code: codes[4] })).status === 200, 'code de secours d’avant la rotation accepté');
await arreter();

poser('socle_cle_ancienne', '');
note((await demarrer()).code === null, 'redémarrage, ancienne clé retirée');
c = new Client(PORT);
const oc = await c.post('/api/compte/connexion/cle/options');
note((await c.post('/api/compte/connexion/cle', { reponse: auth.signer(oc.json, c.origine) })).json?.niveau === 'complet', 'connexion par clé d’accès');
await arreter();

poser('socle_cle', cle());
const r = await demarrer();
note(r.code !== null && /n’est pas la clé qui a écrit cette base/.test(sortie), 'clé inconnue : démarrage refusé');
fs.rmSync(D, { recursive: true, force: true });
console.log(`Exercice de rotation, ${new Date().toISOString()}\n${rapport.join('\n')}`);
