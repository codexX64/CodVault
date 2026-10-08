// CODVAULT de bout en bout, par HTTP, avec le chiffrement du navigateur
// (web/crypto.js, sur le WebCrypto de Node) : ce que le serveur reçoit, ce
// qu'il refuse, ce qu'il ne peut pas lire.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '../socle/essai/client.js';
import { adminComplet, membreInvite } from '../socle/essai/inscription.js';
import { demarrer } from '../src/main.js';
import { adresseInterdite, iconesDeLaPage, Logos } from '../src/logos.js';
import { ecrirePng, lirePng } from '../src/image.js';
import { ouvrirBase } from '../src/base.js';
import * as C from '../web/crypto.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'codvault-'));
const INSTALL = 'jeton-d-installation-pour-les-essais';
const silence = { info() {}, warn() {}, error() {} };
const MAITRE = 'une phrase maîtresse pour les essais';
let codvault, port, admin, membre, lecteur, ids = {};

// Une vraie icône de 96 px, que le serveur doit réencoder à 64.
const PNG = ecrirePng({ l: 96, h: 96, px: Uint8Array.from({ length: 96 * 96 * 4 }, (_, i) => [20, 120, 220, 255][i % 4]) });
// Un faux Internet pour les logos : la résolution et la requête sont remplacées.
const reseau = {
  'exemple.org': [{ address: '93.184.216.34', family: 4 }],
  'interne.org': [{ address: '10.0.0.5', family: 4 }],
  'rebond.org': [{ address: '93.184.216.35', family: 4 }],
};
const reponses = {
  'exemple.org/': { status: 200, type: 'text/html', corps: Buffer.from('<link rel="icon" href="/i.png" sizes="64x64"><link rel="icon" href="/x.svg">') },
  'exemple.org/i.png': { status: 200, type: 'image/png', corps: PNG },
  'rebond.org/': { status: 302, location: 'https://interne.org/' },
};
let requetes = [];
function fausseRequete(o, rappel) {
  const { EventEmitter } = globalThis.__ee;
  const req = new EventEmitter();
  req.end = () => {
    requetes.push(`${o.host}${o.path}`);
    const r = reponses[`${o.host}${o.path}`] || { status: 404, corps: Buffer.alloc(0) };
    const res = new EventEmitter();
    res.statusCode = r.status; res.headers = { 'content-type': r.type || '', ...(r.location ? { location: r.location } : {}) };
    res.resume = () => {};
    rappel(res);
    queueMicrotask(() => { if (r.corps?.length) res.emit('data', r.corps); res.emit('end'); });
  };
  req.destroy = e => req.emit('error', e);
  return req;
}

before(async () => {
  globalThis.__ee = await import('node:events');
  process.umask(0o077);
  codvault = await demarrer({ DATA_DIR: path.join(tmp, 'data'), PORT: '0', HOTE: '127.0.0.1', SOCLE_JETON_INSTALLATION: INSTALL },
    { log: silence, logos: { resoudre: async hote => reseau[hote] || [], requete: fausseRequete } });
  port = codvault.port;
  admin = new Client(port);
  await adminComplet(admin, { jeton: INSTALL });
  membre = (await membreInvite(admin, () => new Client(port), { identifiant: 'leo', role: 'membre' })).client;
  lecteur = (await membreInvite(admin, () => new Client(port), { identifiant: 'lea', role: 'lecture' })).client;
  for (const [nom, c] of Object.entries({ admin, membre, lecteur })) ids[nom] = (await c.get('/api/coffre')).json.compte;
});
after(async () => { await codvault?.arreter(); fs.rmSync(tmp, { recursive: true, force: true }); });

const ok = r => { assert.ok(r.status < 300, `${r.status} ${JSON.stringify(r.json)}`); return r.json; };
const sessions = {};
async function coffreDe(nom, client) {
  const c = (await client.get('/api/coffre')).json;
  if (c.etat === 'nouveau') {
    const n = await C.creerCoffre(MAITRE + nom, c.compte);
    ok(await client.post('/api/coffre', n.publique));
    sessions[nom] = { s: n.session, recuperation: n.recuperation };
  }
  return sessions[nom];
}

test('coffre : rien ne s’ouvre sans le mot de passe maître, ni ailleurs qu’à sa place', async () => {
  const n = await C.creerCoffre('correct horse battery staple', 'c1');
  assert.doesNotMatch(JSON.stringify(n.publique), /correct horse/);
  const s = await C.deverrouiller('correct horse battery staple', n.publique, 'c1');
  await assert.rejects(C.deverrouiller('correct horse battery stapl', n.publique, 'c1'), /incorrect/);
  await assert.rejects(C.deverrouiller('correct horse battery staple', n.publique, 'c2'), /incorrect/, 'l’enveloppe est liée au compte');
  assert.deepEqual([n.publique.kdf.algo, n.publique.kdf.m, n.publique.kdf.t, n.publique.kdf.p], ['argon2id', 65536, 3, 4]);
  for (const bas of [{ m: 1024 }, { t: 1 }, { algo: 'pbkdf2' }]) {
    await assert.rejects(C.deverrouiller('x', { ...n.publique, kdf: { ...n.publique.kdf, ...bas } }, 'c1'), /refusés/, 'un serveur ne peut pas abaisser la dérivation');
  }
  const el = await C.chiffrerNouveau(s, { type: 'acces', nom: 'GitHub', motDePasse: 'Tr0ub4dour&3' });
  assert.doesNotMatch(el.chiffre + el.cle, /GitHub|Tr0ub4dour/);
  assert.equal((await C.dechiffrerElement(s, { ...el, via: 'propre' })).motDePasse, 'Tr0ub4dour&3');
  const autre = await C.chiffrerNouveau(s, { nom: 'autre' });
  await assert.rejects(C.dechiffrerElement(s, { ...autre, chiffre: el.chiffre, via: 'propre' }), /refusé/, 'un bloc déplacé d’un élément à l’autre est détecté');
  // Récupération : la clé imprimée rouvre le coffre et pose un nouveau mot de passe maître.
  // Recopiée à la main : minuscules, et O, I, B lus 0, 1, 8.
  const recopiee = n.recuperation.toLowerCase().replace(/o/g, '0').replace(/i/g, '1').replace(/b/g, '8');
  const ch = await C.changerMaitre({ recuperation: recopiee }, 'nouveau maître bien long', n.publique, 'c1');
  const s2 = await C.deverrouiller('nouveau maître bien long', { ...n.publique, ...ch }, 'c1');
  assert.equal((await C.dechiffrerElement(s2, { ...el, via: 'propre' })).nom, 'GitHub');
  await assert.rejects(C.changerMaitre({ recuperation: 'AAAA-'.repeat(13) }, 'x', n.publique, 'c1'), /incorrecte|incomplète/);
});

test('Argon2id servi au navigateur : identique à celui de Node, aux paramètres de production', async () => {
  const { argon2id } = await import('../web/vendor/noble-hashes/argon2.js');
  const mdp = Buffer.from('mot de passe maître é ü \u{1F511}'), sel = crypto.randomBytes(16);
  const { m, t, p } = C.KDF_DEFAUT;
  const natif = crypto.argon2Sync('argon2id', { message: mdp, nonce: sel, memory: m, passes: t, parallelism: p, tagLength: 32 });
  assert.ok(Buffer.from(argon2id(mdp, sel, { m, t, p, dkLen: 32 })).equals(natif));
});

test('générateur, force, A2F (RFC 6238), CSV', async () => {
  const p = C.generer({ longueur: 32 });
  assert.equal(p.length, 32);
  for (const r of [/[A-Z]/, /[a-z]/, /\d/, /[^A-Za-z0-9]/]) assert.match(p, r, 'chaque jeu choisi est présent');
  assert.doesNotMatch(C.generer({ longueur: 200, symboles: false }), /[0O1lI]/, 'pas de caractères ambigus par défaut');
  assert.throws(() => C.generer({ majuscules: false, minuscules: false, chiffres: false, symboles: false }), /au moins un/);
  assert.equal(C.force('azerty123').niveau, 'faible');
  assert.equal(C.force(C.generer({ longueur: 20 })).niveau, 'robuste');
  // Vecteurs de la RFC 6238 (SHA-1, 8 chiffres).
  const s = { secret: C.base32(new TextEncoder().encode('12345678901234567890')), algo: 'SHA1', chiffres: 8, periode: 30 };
  assert.equal(await C.codeTotp(s, 59_000), '94287082');
  assert.equal(await C.codeTotp(s, 1111111109_000), '07081804');
  assert.equal(await C.codeTotp(s, 20000000000_000), '65353130');
  const o = C.lireTotp('otpauth://totp/GitHub:moi?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&digits=6');
  assert.deepEqual([o.secret, o.chiffres, o.emetteur], ['JBSWY3DPEHPK3PXP', 6, 'GitHub']);
  assert.throws(() => C.lireTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP'), /temporels/);
  const l = C.depuisCsv('folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,1,login,GitHub,,,0,https://github.com,moi,"p,a""ss",JBSWY3DPEHPK3PXP\n,,note,Code portail,"ligne 1\nligne 2",,0,,,,\n');
  assert.deepEqual(l.map(e => [e.type, e.nom, e.motDePasse, e.favori]), [['acces', 'GitHub', 'p,a"ss', true], ['note', 'Code portail', '', false]]);
  assert.equal(l[1].notes, 'ligne 1\nligne 2');
  assert.deepEqual(C.depuisCsv(C.versCsv(l)).map(e => e.motDePasse), ['p,a"ss', ''], 'export puis import : rien ne se perd');
  assert.throws(() => C.depuisCsv('a,b\n1,2'), /Colonnes non reconnues/);
  // Une formule de tableur dans un champ descriptif est neutralisée ; le mot de passe reste exact.
  const piege = C.lireCsv(C.versCsv([{ type: 'acces', nom: '=HYPERLINK("https://exemple.org")', identifiant: '@moi', notes: '+1', motDePasse: '=secret' }]))[1];
  assert.deepEqual([piege[1], piege[3], piege[4], piege[6]], ['\'=HYPERLINK("https://exemple.org")', '\'@moi', '=secret', '\'+1']);
  assert.equal(C.depuisCsv('name,url,password\nX,www.exemple.org/connexion,p\n')[0].nom, 'X');
  assert.equal(C.depuisCsv('url,password\nhttps://www.exemple.org/connexion,p\n')[0].nom, 'exemple.org', 'sans nom : le domaine');
});

test('export chiffré : illisible sans son mot de passe', async () => {
  const f = await C.exporterChiffre([{ nom: 'Banque', motDePasse: 'secret-bancaire' }], 'mot de passe d’export');
  assert.doesNotMatch(f, /Banque|secret-bancaire/);
  assert.equal((await C.importerChiffre(f, 'mot de passe d’export'))[0].nom, 'Banque');
  await assert.rejects(C.importerChiffre(f, 'autre'), /incorrect/);
  // Un export fabriqué : seuls les champs connus passent, en texte, bornés.
  const fabrique = await C.exporterChiffre([{ nom: { html: '<img>' }, motDePasse: 'x'.repeat(5000), role: 'admin', type: 'script' }, 'pas un objet', null], 'mot de passe d’export');
  const [e, ...reste] = await C.importerChiffre(fabrique, 'mot de passe d’export');
  assert.deepEqual([reste.length, e.type, typeof e.nom, e.motDePasse.length, 'role' in e], [0, 'acces', 'string', 1000, false]);
  await assert.rejects(C.importerChiffre(await C.exporterChiffre({ pas: 'une liste' }, 'mot de passe d’export'), 'mot de passe d’export'), /illisible/);
});

test('API : le coffre se crée une fois, la dérivation ne descend pas, rien ne sort sans session', async () => {
  const anonyme = new Client(port);
  assert.equal((await anonyme.get('/api/coffre')).status, 401);
  assert.equal((await anonyme.get('/api/health')).status, 200);
  const c = (await admin.get('/api/coffre')).json;
  assert.equal(c.etat, 'nouveau');
  const n = await C.creerCoffre(MAITRE, c.compte);
  for (const bas of [{ m: 16384 }, { t: 1 }, { p: 0 }, { algo: 'pbkdf2' }]) {
    assert.equal((await admin.post('/api/coffre', { ...n.publique, kdf: { ...n.publique.kdf, ...bas } })).status, 400, `sous le plancher d’Argon2id : ${JSON.stringify(bas)}`);
  }
  ok(await admin.post('/api/coffre', n.publique));
  sessions.admin = { s: n.session, recuperation: n.recuperation };
  assert.equal((await admin.post('/api/coffre', n.publique)).status, 409);
  const lu = (await admin.get('/api/coffre')).json;
  assert.equal(lu.etat, 'pret');
  assert.equal(lu.recuperation, undefined, 'l’enveloppe de récupération ne sort que sous renfort');
  // Le serveur ne garde que du chiffré : ni le mot de passe maître, ni la clé de récupération.
  // Les écritures récentes sont dans le journal WAL : les deux fichiers sont lus, et comparés en octets UTF-8.
  const base = Buffer.concat(['codvault.db', 'codvault.db-wal'].map(f => fs.readFileSync(path.join(tmp, 'data', f))));
  for (const clair of [MAITRE, n.recuperation, n.recuperation.replace(/-/g, '')]) assert.ok(!base.includes(Buffer.from(clair)), clair.slice(0, 12));
  assert.ok(Buffer.concat([base, Buffer.from(MAITRE)]).includes(Buffer.from(MAITRE)), 'la recherche elle-même trouve un clair présent');
});

test('API : éléments — propriétaire seul, versions, plafonds ; le serveur ne lit rien', async () => {
  const { s } = await coffreDe('admin', admin);
  const el = await C.chiffrerNouveau(s, { type: 'acces', nom: 'Banque', identifiant: 'ana', motDePasse: 'mot-de-passe-de-la-banque', url: 'https://banque.exemple.org' });
  const v1 = ok(await admin.post('/api/elements', el));
  assert.equal(v1.version, 1);
  assert.equal((await admin.post('/api/elements', el)).status, 409, 'un identifiant ne se réutilise pas');
  assert.equal((await admin.post('/api/elements', { ...el, id: C.nouvelId(), chiffre: 'en clair' })).status, 400, 'du clair est refusé : seul un bloc chiffré passe');
  // Le lecteur n'écrit rien ; le membre ne voit pas l'élément d'un autre.
  await coffreDe('lecteur', lecteur); await coffreDe('membre', membre);
  assert.equal((await lecteur.post('/api/elements', await C.chiffrerNouveau(sessions.lecteur.s, { nom: 'x' }))).status, 403);
  assert.ok(!(await membre.get('/api/elements')).json.elements.some(e => e.id === el.id));
  assert.equal((await membre.put(`/api/elements/${el.id}`, { version: 1, chiffre: el.chiffre })).status, 404);
  assert.equal((await membre.del(`/api/elements/${el.id}`)).status, 404);
  // Deux appareils : le second est prévenu, rien n'est écrasé.
  const ligne = (await admin.get('/api/elements')).json.elements.find(e => e.id === el.id);
  const ch = await C.rechiffrer(s, ligne, { ...(await C.dechiffrerElement(s, ligne)), motDePasse: 'nouveau-mot-de-passe-banque' });
  ok(await admin.put(`/api/elements/${el.id}`, { version: 1, chiffre: ch }));
  assert.equal((await admin.put(`/api/elements/${el.id}`, { version: 1, chiffre: ch })).status, 409);
  const relu = (await admin.get('/api/elements')).json.elements.find(e => e.id === el.id);
  assert.equal((await C.dechiffrerElement(s, relu)).motDePasse, 'nouveau-mot-de-passe-banque');
  const base = fs.readFileSync(path.join(tmp, 'data', 'codvault.db')).toString('latin1') + fs.readFileSync(path.join(tmp, 'data', 'codvault.db-wal')).toString('latin1');
  assert.ok(!/mot-de-passe-de-la-banque|nouveau-mot-de-passe-banque|banque\.exemple/.test(base), 'aucune trace en clair, ni en base ni dans son journal d’écriture');
  // Un lot d'import : tout ou rien.
  const lot = await Promise.all([1, 2, 3].map(i => C.chiffrerNouveau(s, { nom: `import ${i}`, motDePasse: `p${i}` })));
  assert.equal(ok(await admin.post('/api/elements/lot', { elements: lot })).ajoutes, 3);
  assert.equal((await admin.post('/api/elements/lot', { elements: [await C.chiffrerNouveau(s, { nom: 'neuf' }), lot[0]] })).status, 409);
  assert.equal((await admin.get('/api/elements')).json.elements.length, 4, 'le lot refusé n’a rien laissé');
});

test('partage : chiffré pour le destinataire, droits tenus par le serveur, retrait', async () => {
  const a = await coffreDe('admin', admin), m = await coffreDe('membre', membre);
  const dests = ok(await admin.get('/api/destinataires')).destinataires;
  const leo = dests.find(d => d.identifiant === 'leo');
  assert.equal(await C.empreinte(leo.clePublique), leo.empreinte, 'l’empreinte affichée est celle de la clé reçue');
  assert.equal((await lecteur.get('/api/destinataires')).status, 403);
  const el = await C.chiffrerNouveau(a.s, { type: 'acces', nom: 'Wi-Fi invités', motDePasse: 'wifi-partage-2026' });
  ok(await admin.post('/api/elements', el));
  const ligne = (await admin.get('/api/elements')).json.elements.find(e => e.id === el.id);
  ok(await admin.put(`/api/elements/${el.id}/partages`, { destinataire: leo.id, droits: 'lecture', cle: await C.envelopperPour(a.s, ligne, leo) }));
  const chezLeo = (await membre.get('/api/elements')).json.elements.find(e => e.id === el.id);
  assert.deepEqual([chezLeo.via, chezLeo.droits, chezLeo.proprietaire], ['partage', 'lecture', 'ana']);
  assert.equal((await C.dechiffrerElement(m.s, chezLeo)).motDePasse, 'wifi-partage-2026');
  await assert.rejects(C.dechiffrerElement(a.s, { ...chezLeo }), /refusé|illisible|Partage/, 'la clé partagée n’ouvre que pour son destinataire');
  // Lecture seule : pas de modification ; écriture : oui ; jamais de suppression ni de repartage.
  const modif = await C.rechiffrer(m.s, chezLeo, { nom: 'Wi-Fi invités', motDePasse: 'change-par-leo' });
  assert.equal((await membre.put(`/api/elements/${el.id}`, { version: chezLeo.version, chiffre: modif })).status, 403);
  ok(await admin.put(`/api/elements/${el.id}/partages`, { destinataire: leo.id, droits: 'ecriture', cle: await C.envelopperPour(a.s, ligne, leo) }));
  ok(await membre.put(`/api/elements/${el.id}`, { version: chezLeo.version, chiffre: modif }));
  assert.equal((await C.dechiffrerElement(a.s, (await admin.get('/api/elements')).json.elements.find(e => e.id === el.id))).motDePasse, 'change-par-leo', 'le propriétaire lit la modification');
  assert.equal((await membre.del(`/api/elements/${el.id}`)).status, 404);
  const cleFactice = `e1.${'A'.repeat(122)}.v1.${'A'.repeat(16)}.${'A'.repeat(64)}`;
  assert.equal((await membre.put(`/api/elements/${el.id}/partages`, { destinataire: ids.lecteur, droits: 'lecture', cle: cleFactice })).status, 404, 'seul le propriétaire partage');
  // Le destinataire peut quitter ; le propriétaire peut retirer.
  ok(await membre.del(`/api/elements/${el.id}/partages/${ids.membre}`));
  assert.ok(!(await membre.get('/api/elements')).json.elements.some(e => e.id === el.id));
  assert.equal((await admin.put(`/api/elements/${el.id}/partages`, { destinataire: ids.admin, droits: 'lecture', cle: await C.envelopperPour(a.s, ligne, { id: ids.admin, clePublique: a.s.clePublique }) })).status, 400);
});

test('maître changé, récupération ; préférences chiffrées', async () => {
  const m = await coffreDe('membre', membre);
  const c = (await membre.get('/api/coffre')).json;
  // Le mot de passe maître changé : l'ancien ne vaut plus rien, les éléments restent lisibles.
  const ch = await C.changerMaitre({ ancien: MAITRE + 'membre' }, 'le nouveau maître de leo', c, c.compte);
  ok(await membre.put('/api/coffre/maitre', { kdf: ch.kdf, cle: ch.cle }));
  const c2 = (await membre.get('/api/coffre')).json;
  await assert.rejects(C.deverrouiller(MAITRE + 'membre', c2, c2.compte), /incorrect/);
  const s2 = await C.deverrouiller('le nouveau maître de leo', c2, c2.compte);
  // La clé de récupération, imprimée à la création, rouvre toujours le coffre.
  const { recuperation: bloc } = ok(await membre.get('/api/coffre/recuperation'));
  const ch2 = await C.changerMaitre({ recuperation: m.recuperation }, 'troisième maître de leo', { ...c2, recuperation: bloc }, c2.compte);
  ok(await membre.put('/api/coffre/maitre', { kdf: ch2.kdf, cle: ch2.cle }));
  // Une nouvelle clé de récupération : l'ancienne cesse de valoir.
  const neuve = await C.nouvelleRecuperation('troisième maître de leo', { ...c2, ...ch2 }, c2.compte);
  ok(await membre.put('/api/coffre/recuperation', { recuperation: neuve.bloc }));
  const bloc2 = ok(await membre.get('/api/coffre/recuperation')).recuperation;
  await assert.rejects(C.changerMaitre({ recuperation: m.recuperation }, 'x', { ...c2, recuperation: bloc2 }, c2.compte), /incorrecte/);
  // Les préférences (favoris, verrouillage) : chiffrées comme le reste.
  const p = await C.chiffrerPreferences(s2, { favoris: ['x'], verrou: 5 });
  ok(await membre.put('/api/coffre/preferences', { preferences: p }));
  assert.deepEqual(await C.dechiffrerPreferences(s2, (await membre.get('/api/coffre')).json.preferences), { favoris: ['x'], verrou: 5 });
  assert.equal((await membre.put('/api/coffre/preferences', { preferences: '{"favoris":["x"]}' })).status, 400, 'des préférences en clair sont refusées');
  sessions.membre.s = s2;
});

test('dérivation : un coffre aux paramètres d’hier se renforce au déverrouillage, jamais l’inverse', async () => {
  const max = (await membreInvite(admin, () => new Client(port), { identifiant: 'max', role: 'membre' })).client;
  const c = (await max.get('/api/coffre')).json;
  const n = await C.creerCoffre(MAITRE + 'max', c.compte, { kdf: C.KDF_PLANCHER });
  ok(await max.post('/api/coffre', n.publique));
  const lu = (await max.get('/api/coffre')).json;
  const s = await C.deverrouiller(MAITRE + 'max', lu, lu.compte);
  assert.ok(s.renfort, 'enveloppe sous la cible : réenveloppée au déverrouillage');
  assert.deepEqual([s.renfort.kdf.m, s.renfort.kdf.t, s.renfort.kdf.p], [65536, 3, 4]);
  assert.equal((await new Client(port).put('/api/coffre/kdf', { version: lu.version, ...s.renfort })).status, 401);
  assert.equal((await max.put('/api/coffre/kdf', { version: lu.version, kdf: lu.kdf, cle: lu.cle })).status, 400, 'paramètres identiques');
  assert.equal((await max.put('/api/coffre/kdf', { version: lu.version + 1, ...s.renfort })).status, 409, 'version périmée');
  ok(await max.put('/api/coffre/kdf', { version: lu.version, ...s.renfort }));
  const apres = (await max.get('/api/coffre')).json;
  assert.equal(apres.kdf.m, 65536);
  assert.equal((await max.put('/api/coffre/kdf', { version: apres.version, kdf: { ...lu.kdf }, cle: lu.cle })).status, 400, 'jamais redescendre');
  const s2 = await C.deverrouiller(MAITRE + 'max', apres, apres.compte);
  assert.equal(s2.renfort, undefined);
  assert.equal(s2.clePublique, s.clePublique, 'même coffre, même identité');
});

test('logos : du site lui-même, jamais d’une adresse interne, jamais de SVG', async () => {
  await coffreDe('admin', admin);
  requetes = [];
  const l = await codvault.logos.obtenir('exemple.org');
  assert.equal(l.type, 'image/png');
  assert.ok(!requetes.some(x => x.endsWith('.svg')), 'le SVG déclaré est écarté');
  requetes = [];
  assert.equal((await codvault.logos.obtenir('exemple.org')).type, 'image/png');
  assert.deepEqual(requetes, [], 'en cache : aucune nouvelle requête');
  assert.equal(await codvault.logos.obtenir('interne.org'), null);
  assert.ok(!requetes.some(x => x.startsWith('interne.org')), 'une adresse privée n’est jamais contactée');
  assert.equal(await codvault.logos.obtenir('rebond.org'), null);
  assert.ok(!requetes.some(x => x.startsWith('interne.org')), 'ni par une redirection');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1', '64:ff9b::a00:1', '2001:db8::1', 'ff02::1']) assert.equal(adresseInterdite(ip), true, ip);
  for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(adresseInterdite(ip), false, ip);
  assert.deepEqual(iconesDeLaPage('<link rel="apple-touch-icon" href="/a.png"><link rel="icon" href="data:image/png;base64,AA"><link rel="shortcut icon" href="https://cdn.exemple.org/f.ico">', 'https://exemple.org/'), ['https://cdn.exemple.org/f.ico', 'https://exemple.org/a.png']);
  // Route : session exigée, domaine contrôlé.
  assert.equal((await new Client(port).get('/api/logos/exemple.org')).status, 401);
  const servi = await admin.get('/api/logos/exemple.org');
  assert.equal(servi.status, 200);
  assert.equal(servi.entetes['content-type'], 'image/png');
  assert.equal(servi.entetes['content-disposition'], 'attachment');
  assert.equal(servi.entetes['x-content-type-options'], 'nosniff');
  assert.match(servi.entetes['content-security-policy'], /sandbox/);
  assert.equal(lirePng(l.octets).l, 64, 'servi réencodé, jamais tel que reçu');
  assert.ok(!l.octets.equals(PNG));
  assert.equal((await admin.get('/api/logos/127.0.0.1')).status, 404);
  // Coupés : aucune requête sortante.
  const coupe = new Logos({ db: ouvrirBase(path.join(tmp, 'coupe')), actif: false, resoudre: async () => { throw new Error('ne doit pas résoudre'); } });
  assert.equal(await coupe.obtenir('ailleurs.org'), null);
});

test('balayage : chaque route fermée sans session, chaque écriture fermée au mauvais rôle, l’inconnu introuvable, rien en trop', async () => {
  const { s } = await coffreDe('admin', admin);
  const el = await C.chiffrerNouveau(s, { nom: 'balayage' });
  ok(await admin.post('/api/elements', el));
  const anonyme = new Client(port);
  await anonyme.etat();
  const routes = [
    ['get', '/api/version'], ['get', '/api/coffre'], ['post', '/api/coffre', {}], ['put', '/api/coffre/maitre', {}], ['put', '/api/coffre/kdf', {}],
    ['get', '/api/coffre/recuperation'], ['put', '/api/coffre/recuperation', {}], ['put', '/api/coffre/preferences', {}],
    ['get', '/api/elements'], ['post', '/api/elements', {}], ['post', '/api/elements/lot', {}], ['put', `/api/elements/${el.id}`, {}],
    ['del', `/api/elements/${el.id}`], ['get', '/api/destinataires'], ['put', `/api/elements/${el.id}/partages`, {}],
    ['del', `/api/elements/${el.id}/partages/${ids.membre}`], ['get', '/api/logos/exemple.org'],
  ];
  for (const [m, chemin, corps] of routes) assert.equal((await anonyme[m](chemin, corps)).status, 401, `${m} ${chemin} sans session`);
  // Le lecteur lit son coffre, n'écrit aucun élément et ne partage rien.
  await coffreDe('lecteur', lecteur);
  const ecritures = [['post', '/api/elements', el], ['post', '/api/elements/lot', { elements: [el] }], ['put', `/api/elements/${el.id}`, { version: 1, chiffre: el.chiffre }],
    ['del', `/api/elements/${el.id}`], ['get', '/api/destinataires'], ['put', `/api/elements/${el.id}/partages`, { destinataire: ids.membre, droits: 'lecture', cle: 'x' }]];
  for (const [m, chemin, corps] of ecritures) assert.equal((await lecteur[m](chemin, corps)).status, 403, `${m} ${chemin} en lecture seule`);
  // Un autre membre ne voit, ne modifie, ne supprime ni ne partage l'élément d'un autre : introuvable pour lui.
  await coffreDe('membre', membre);
  for (const [m, chemin, corps] of [['put', `/api/elements/${el.id}`, { version: 1, chiffre: el.chiffre }], ['del', `/api/elements/${el.id}`], ['put', `/api/elements/${el.id}/partages`, { destinataire: ids.lecteur, droits: 'lecture', cle: 'e1.' + 'A'.repeat(88) + '.v1.' + 'A'.repeat(16) + '.' + 'A'.repeat(64) }]])
    assert.equal((await membre[m](chemin, corps)).status, 404, `${m} ${chemin} par un autre membre`);
  assert.ok(!(await membre.get('/api/elements')).json.elements.some(x => x.id === el.id));
  // Routes inconnues, anciennes ou de débogage : 404 ; méthode non prévue : 405.
  for (const chemin of ['/api/debug', '/api/seed', '/api/v1/elements', '/graphql', '/api/elements/x/y/z']) assert.equal((await admin.get(chemin)).status, 404, chemin);
  assert.equal((await admin.req('PATCH', '/api/coffre', {})).status, 405);
  // Un champ en trop n'atterrit nulle part : refusé, pas ignoré.
  const intrus = await C.chiffrerNouveau(s, { nom: 'intrus' });
  assert.equal((await admin.post('/api/elements', { ...intrus, proprietaire: ids.membre })).status, 400);
  assert.equal((await admin.put(`/api/elements/${el.id}`, { version: 1, chiffre: el.chiffre, version_forcee: 9 })).status, 400);
  // Un corps au-delà de la limite de sa route : 413, avant toute lecture du schéma.
  assert.equal((await admin.post('/api/elements', { id: intrus.id, chiffre: `v1.${'A'.repeat(16)}.${'B'.repeat(200_000)}`, cle: intrus.cle })).status, 413);
  ok(await admin.del(`/api/elements/${el.id}`));
});

test('plafonds par coffre : nombre d’éléments et octets, à l’ajout comme à la modification', async () => {
  const autre = await demarrer({ DATA_DIR: path.join(tmp, 'plafonds'), PORT: '0', HOTE: '127.0.0.1', SOCLE_JETON_INSTALLATION: INSTALL, CODVAULT_MAX_ELEMENTS: '10', CODVAULT_MAX_MIO: '1' }, { log: silence });
  try {
    const a = new Client(autre.port);
    await adminComplet(a, { jeton: INSTALL });
    // Le serveur ne lit que la forme des blocs : des blocs factices suffisent ici.
    const bloc = n => `v1.${'A'.repeat(16)}.${'B'.repeat(n)}`;
    ok(await a.post('/api/coffre', { kdf: { algo: 'argon2id', m: 65536, t: 3, p: 4, sel: 'C'.repeat(22) }, cle: bloc(64), recuperation: bloc(64),
      clePublique: 'D'.repeat(120), clePrivee: bloc(200), empreinte: 'AAAA AAAA AAAA AAAA AAAA AAAA' }));
    const el = (i, n = 100) => ({ id: String(i).padStart(22, 'x'), chiffre: bloc(n), cle: bloc(64) });
    assert.equal((await a.post('/api/elements/lot', { elements: Array.from({ length: 11 }, (_, i) => el(i)) })).status, 409, '11 éléments pour 10 au plus');
    assert.equal((await a.get('/api/elements')).json.elements.length, 0, 'tout ou rien');
    for (let i = 0; i < 7; i++) ok(await a.post('/api/elements', el(i, 140_000)));
    const plein = await a.post('/api/elements', el(7, 140_000));
    assert.equal(plein.status, 409);
    assert.match(plein.json.error, /1 Mio/);
    ok(await a.post('/api/elements', el(8, 1000)));
    assert.equal((await a.put(`/api/elements/${el(8).id}`, { version: 1, chiffre: bloc(140_000) })).status, 409, 'grossir un élément au-delà du plafond');
    ok(await a.put(`/api/elements/${el(8).id}`, { version: 1, chiffre: bloc(500) }), 'rapetisser reste possible');
  } finally { await autre.arreter(); }
});

test('configuration : une valeur invalide arrête le démarrage, toutes les erreurs dites d’un coup', async () => {
  const env = { DATA_DIR: path.join(tmp, 'mauvaise'), PORT: '0', HOTE: '127.0.0.1', CODVAULT_LOGOS: 'peut-être', CODVAULT_MAX_MIO: '0' };
  await assert.rejects(demarrer(env, { log: silence }), e => /CODVAULT_LOGOS/.test(e.message) && /CODVAULT_MAX_MIO/.test(e.message));
});

test('un compte effacé part avec son coffre, ses éléments et leurs partages', async () => {
  const c = new Client(port);
  const { client: zoe } = await membreInvite(admin, () => c, { identifiant: 'zoe', role: 'membre' });
  const compte = (await zoe.get('/api/coffre')).json.compte;
  const n = await C.creerCoffre(MAITRE, compte);
  ok(await zoe.post('/api/coffre', n.publique));
  ok(await zoe.post('/api/elements', await C.chiffrerNouveau(n.session, { nom: 'à moi' })));
  codvault.socle.comptes.apresSuppression.forEach(f => f(compte));
  assert.equal(codvault.db.prepare('SELECT count(*) n FROM elements WHERE proprietaire = ?').get(compte).n, 0);
  assert.equal(codvault.db.prepare('SELECT count(*) n FROM coffres WHERE compte = ?').get(compte).n, 0);
});
