// Parcours réel de SÉSAME dans Chromium (clé d'accès virtuelle) : installation
// par la porte du socle, création du coffre, ajouts, détail, générateur, codes,
// import, réglages, verrouillage — et contrôle de mise en page à chaque largeur.
//   node outils/vitrine.mjs 8198 &  node outils/parcours-navigateur.mjs http://localhost:8198 JETON DOSSIER
import { chromium } from 'playwright';
import fs from 'node:fs';
import { chevauchements, LARGEURS } from '../socle/essai/mise-en-page.mjs';

const [base, jeton, sortie = '/tmp/captures-sesame'] = process.argv.slice(2);
fs.mkdirSync(sortie, { recursive: true });
// sesame.test : un nom qui n'est pas localhost, pour voir SÉSAME servi en HTTP hors contexte sûr.
const navigateur = await chromium.launch({ args: ['--host-resolver-rules=MAP sesame.test 127.0.0.1'] });
const contexte = await navigateur.newContext({ viewport: { width: 1280, height: 860 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await contexte.newPage();
const erreurs = [];
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource.*(404|401)/.test(m.text())) erreurs.push(m.text()); });
page.on('pageerror', e => erreurs.push(String(e)));
page.on('response', r => { if (r.status() === 400 || r.status() >= 500) erreurs.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
const cdp = await contexte.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });

const rapport = [];
async function controle(nom) {
  for (const w of LARGEURS) {
    await page.setViewportSize({ width: w, height: w < 500 ? 780 : 900 });
    await page.waitForTimeout(220);
    rapport.push({ ecran: nom, largeur: w, defauts: await page.evaluate(chevauchements) });
    if ([360, 768, 1280].includes(w)) await page.screenshot({ path: `${sortie}/${nom}-${w}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.waitForTimeout(150);
}
const aller = async (titre, entete) => {
  await page.getByRole('button', { name: titre, exact: true }).first().click();
  await page.getByRole('heading', { name: entete, exact: true }).first().waitFor();
  await page.waitForTimeout(300);
};
const dialogue = () => page.getByRole('dialog').last();
const MAITRE = 'une phrase maîtresse pour la vitrine';

await page.goto(base);
await page.getByText('Premier compte').waitFor();
await page.getByLabel('Jeton d’installation').fill(jeton);
await page.getByLabel('Identifiant').fill('ana');
await page.getByLabel('Mot de passe').fill('phrase de passe pour le sesame de la vitrine');
await page.getByRole('button', { name: 'Créer le compte' }).click();
await page.getByRole('button', { name: /Créer la clé maintenant/ }).click();
await page.getByText('J’ai rangé ces codes en lieu sûr.').click();
await page.getByRole('button', { name: 'Terminer' }).click();

// Le coffre se crée dans le navigateur.
await page.getByRole('heading', { name: 'Ton coffre' }).waitFor();
await controle('creation');
await page.getByLabel('Mot de passe maître').fill(MAITRE);
await page.getByLabel('Le même, une seconde fois').fill(MAITRE);
await page.getByRole('button', { name: 'Créer mon coffre' }).click();
await page.getByRole('heading', { name: 'Ta clé de récupération' }).waitFor();
await controle('recuperation');
const cle = (await page.locator('.recup').textContent()).trim();
await page.getByLabel('Recopie ses quatre derniers caractères').fill(cle.slice(-4));
await page.getByRole('button', { name: 'Je l’ai mise de côté' }).click();
await page.getByRole('heading', { name: 'Mon coffre', exact: true }).waitFor();
await controle('coffre-vide');

// Des accès, une note, un secret A2F.
const ajouter = async ({ nom, site, ident, mdp, totp, espace }) => {
  await page.getByRole('button', { name: 'Accès', exact: true }).click();
  const d = dialogue();
  await d.getByLabel('Nom', { exact: true }).fill(nom);
  await d.getByLabel('Site', { exact: true }).fill(site);
  await d.getByLabel('Identifiant ou adresse', { exact: true }).fill(ident);
  if (mdp) await d.getByLabel('Mot de passe', { exact: true }).fill(mdp); else await d.getByRole('button', { name: 'Générer' }).click();
  if (totp) await d.getByLabel(/^Secret A2F/).fill(totp);
  if (espace) await d.getByLabel('Espace', { exact: true }).fill(espace);
  await d.getByRole('button', { name: 'Enregistrer' }).click();
  await page.waitForTimeout(300);
};
await ajouter({ nom: 'GitHub', site: 'github.com', ident: 'codex', totp: 'JBSWY3DPEHPK3PXP', espace: 'Travail' });
await page.waitForTimeout(200);
await controle('ajout-fait');
await ajouter({ nom: 'Fournisseur d’accès à Internet — espace client et factures', site: 'https://espace-client.fournisseur-exemple.fr/connexion', ident: 'adresse.tres.longue.pour.tester@exemple.org', mdp: 'azerty123', espace: 'Personnel' });
await ajouter({ nom: 'Forum', site: 'forum.exemple.org', ident: 'codex', mdp: 'azerty123' });
await page.getByRole('button', { name: 'Note', exact: true }).click();
await dialogue().getByLabel('Nom', { exact: true }).fill('Code du portail');
await dialogue().getByLabel('Contenu').fill('Portail : 4711\nBoîte aux lettres : 3');
await controle('note-edition');
await dialogue().getByRole('button', { name: 'Enregistrer' }).click();
await page.waitForTimeout(300);
await controle('coffre');
await page.getByRole('tab', { name: /À renforcer/ }).click();
await page.waitForTimeout(200);
await controle('coffre-faibles');
await page.getByRole('tab', { name: /^Tout/ }).click();
await page.locator('.el-corps').first().click();
await dialogue().waitFor();
await controle('detail');
await dialogue().getByRole('button', { name: 'Partager' }).click().catch(() => {});
await page.waitForTimeout(300);
await controle('partage');
await dialogue().getByRole('button', { name: /^(Fermer)$/ }).last().click();
await page.waitForTimeout(200);
await aller('Générateur', 'Générateur');
await controle('generateur');
await aller('Codes A2F', 'Codes A2F');
await controle('codes');
await aller('Importer, exporter', 'Importer, exporter');
await page.locator('input[type=file]').setInputFiles({ name: 'chrome.csv', mimeType: 'text/csv', buffer: Buffer.from('name,url,username,password\nNetflix,https://www.netflix.com,codex,Un-mot-de-passe-solide-42\nGitHub,https://github.com,codex,azerty123\n') });
await page.getByRole('button', { name: /^Importer 2 éléments$/ }).waitFor();
await controle('import');
await page.getByRole('button', { name: /^Importer 2 éléments$/ }).click();
await page.waitForTimeout(500);
await aller('Coffre et clés', 'Coffre et clés');
await controle('cles');
await aller('Sécurité du compte', 'Sécurité');
await controle('securite');
await aller('Comptes', 'Comptes');
await controle('comptes');
// Verrouillage, puis déverrouillage.
await page.getByRole('button', { name: 'Verrouiller le coffre' }).click();
await page.getByRole('heading', { name: 'Coffre verrouillé' }).waitFor();
await controle('verrouille');
await page.getByLabel('Mot de passe maître').fill(MAITRE);
await page.getByRole('button', { name: 'Déverrouiller' }).click();
await page.getByRole('heading', { name: 'Comptes', exact: true }).waitFor();
await aller('Tout le coffre', 'Mon coffre');
await page.waitForTimeout(400);
const n = await page.locator('.el').count();
// En HTTP sous un vrai nom, aucun coffre ne s'ouvre : SÉSAME doit le dire au lieu d'échouer en silence.
const http = await navigateur.newPage();
await http.goto(base.replace('localhost', 'sesame.test'));
const horsContexte = await http.getByRole('heading', { name: 'HTTPS demandé' }).waitFor({ timeout: 10_000 }).then(() => true, () => false);

const defauts = rapport.filter(r => r.defauts.length);
fs.writeFileSync(`${sortie}/rapport.json`, JSON.stringify({ rapport, erreurs, elementsApresDeverrouillage: n, horsContexte }, null, 2));
console.log(`écrans×largeurs contrôlés : ${rapport.length}, avec défauts : ${defauts.length}, erreurs console : ${erreurs.length}, éléments après déverrouillage : ${n}, HTTP hors contexte sûr signalé : ${horsContexte ? 'oui' : 'NON'}`);
if (defauts.length) console.log(JSON.stringify(defauts.slice(0, 8).map(d => ({ ecran: d.ecran, largeur: d.largeur, defauts: d.defauts.slice(0, 3) })), null, 1));
if (erreurs.length) console.log(erreurs.slice(0, 10).join('\n'));
await navigateur.close();
