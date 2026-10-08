// Prépare l'extension : copie le chiffrement de l'interface web (le même
// fichier, octet pour octet, que les essais comparent), dessine les icônes,
// et avec --zip l'emballe pour la signature (Firefox) ou le dépôt (Chrome).
//
//   node outils/extension.mjs [--zip]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { ecrirePng } from '../src/image.js';

const RACINE = path.resolve(import.meta.dirname, '..');
const EXT = path.join(RACINE, 'extension');

export const COPIES = [
  ['web/crypto.js', 'extension/lib/crypto.js'],
  ['web/vendor/PROVENANCE', 'extension/lib/vendor/PROVENANCE'],
  ...fs.readdirSync(path.join(RACINE, 'web/vendor/noble-hashes')).map(f => [`web/vendor/noble-hashes/${f}`, `extension/lib/vendor/noble-hashes/${f}`]),
];

// L'icône de web/icone.svg, rendue sans bibliothèque : distances signées, 4×4 échantillons par pixel.
const rect = (x, y, cx, cy, l, h, r) => {
  const qx = Math.abs(x - cx) - (l / 2 - r), qy = Math.abs(y - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
function icone(cote) {
  const px = new Uint8Array(cote * cote * 4);
  const N = 4;
  for (let j = 0; j < cote; j++) for (let i = 0; i < cote; i++) {
    let fond = 0, trait = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const x = ((i + (a + 0.5) / N) / cote) * 32, y = ((j + (b + 0.5) / N) / cote) * 32;
      if (rect(x, y, 16, 16, 32, 32, 8) > 0) continue;
      fond++;
      if (Math.abs(rect(x, y, 16, 16, 18, 16, 3)) <= 1 || Math.abs(Math.hypot(x - 16, y - 16) - 3.4) <= 1) trait++;
    }
    const k = (j * cote + i) * 4, t = trait / fond || 0;
    px[k] = Math.round(0x1B + (255 - 0x1B) * t);
    px[k + 1] = Math.round(0x2A + (255 - 0x2A) * t);
    px[k + 2] = 255;
    px[k + 3] = Math.round((fond / (N * N)) * 255);
  }
  return ecrirePng({ l: cote, h: cote, px });
}

// Archive ZIP sans compression externe : chaque fichier en « deflate », dates fixes (archive reproductible).
function zip(fichiers) {
  const locaux = [], centraux = [];
  let decalage = 0;
  for (const [nom, octets] of fichiers) {
    const n = Buffer.from(nom), comp = zlib.deflateRawSync(octets, { level: 9 }), crc = zlib.crc32(octets);
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0); l.writeUInt16LE(20, 4); l.writeUInt16LE(0x0800, 6); l.writeUInt16LE(8, 8);
    l.writeUInt16LE(0, 10); l.writeUInt16LE(0x21, 12); l.writeUInt32LE(crc, 14); l.writeUInt32LE(comp.length, 18); l.writeUInt32LE(octets.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(octets.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(decalage, 42);
    locaux.push(l, n, comp); centraux.push(c, n);
    decalage += 30 + n.length + comp.length;
  }
  const central = Buffer.concat(centraux);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(fichiers.length, 8); fin.writeUInt16LE(fichiers.length, 10); fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, central, fin]);
}
const lister = dossier => fs.readdirSync(dossier, { withFileTypes: true }).flatMap(e => e.isDirectory() ? lister(path.join(dossier, e.name)) : [path.join(dossier, e.name)]);

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  for (const [de, vers] of COPIES) {
    fs.mkdirSync(path.dirname(path.join(RACINE, vers)), { recursive: true });
    fs.copyFileSync(path.join(RACINE, de), path.join(RACINE, vers));
  }
  fs.mkdirSync(path.join(EXT, 'icones'), { recursive: true });
  for (const c of [16, 32, 48, 128]) fs.writeFileSync(path.join(EXT, 'icones', `${c}.png`), icone(c));
  console.log(`extension/ prête (${COPIES.length} fichiers copiés, 4 icônes).`);
  if (process.argv.includes('--zip')) {
    const { version } = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
    const fichiers = lister(EXT).sort().map(f => [path.relative(EXT, f).split(path.sep).join('/'), fs.readFileSync(f)]);
    const sortie = path.join(RACINE, `codvault-extension-${version}.zip`);
    fs.writeFileSync(sortie, zip(fichiers));
    console.log(`${path.basename(sortie)} : ${fichiers.length} fichiers.`);
  }
}
