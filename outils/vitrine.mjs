// Un SÉSAME de démonstration, sans logos (aucune requête sortante) : la porte
// du socle à ouvrir, puis le coffre à créer dans le navigateur.
//   node outils/vitrine.mjs 8198
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { demarrer } from '../src/main.js';

const port = Number(process.argv[2] || 8198);
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'sesame-vitrine-'));
const jeton = 'jeton-installation-de-la-vitrine-sesame';
await demarrer({
  DATA_DIR: path.join(dossier, 'data'), PORT: String(port), HOTE: '127.0.0.1', SOCLE_JETON_INSTALLATION: jeton, SESAME_LOGOS: 'non',
  ...(process.env.SOCLE_THEME ? { SOCLE_THEME: process.env.SOCLE_THEME } : {}),
}, { log: { info() {}, warn() {}, error() {} } });
console.log(`SÉSAME de démonstration sur http://localhost:${port} — jeton d’installation : ${jeton}`);
