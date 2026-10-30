// Prépare l'extension : copie le chiffrement de l'interface web (le même
// fichier, octet pour octet, que les essais comparent), dessine les icônes
// (le logo),
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

// L'icône : le logo de CODVAULT (même tracé que web/app.js et web/icone.svg),
// clair sur un carré arrondi sombre, rendue sans bibliothèque. Le contour est
// aplati en segments (arcs compris), rempli par la règle non nulle, 4×4
// échantillons par pixel.
const LOGO = { vb: [-1.91, -1.91, 259.83, 259.83], d: 'M38.07 122.61A59.28 59.28 0 0 1 102.73 121.47L199.19 25.01L244 69.82L230.99 82.83L204.97 56.81L194.86 66.93L209.31 81.38L194.86 95.84L180.4 81.38L168.84 92.95L190.52 114.63L174.62 130.53L152.94 108.84L121.52 140.26A59.28 59.28 0 1 1 22.17 138.51L46.3 162.64A26.57 26.57 0 1 0 62.2 146.74Z' };
const FOND = [0x16, 0x1A, 0x1F], ENCRE = [0xE4, 0xE7, 0xEB];
function aplatir(d) {
  const jetons = d.match(/[MLAZ]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi);
  const contours = []; let c = null, x = 0, y = 0, k = 0, cmd = '';
  const n = () => Number(jetons[k++]);
  while (k < jetons.length) {
    if (/[MLAZ]/i.test(jetons[k])) cmd = jetons[k++].toUpperCase();
    if (cmd === 'Z') { c = null; continue; }
    if (cmd === 'M') { x = n(); y = n(); c = [[x, y]]; contours.push(c); cmd = 'L'; continue; }
    if (cmd === 'L') { x = n(); y = n(); c.push([x, y]); continue; }
    if (cmd !== 'A') throw new Error(`commande de tracé non prise en charge : ${cmd}`);
    // Arc : extrémités → centre (SVG 1.1, annexe F.6.5), puis 48 segments.
    let rx = Math.abs(n()), ry = Math.abs(n()); const phi = n() * Math.PI / 180, grand = n(), sens = n(), x2 = n(), y2 = n();
    const co = Math.cos(phi), si = Math.sin(phi), dx = (x - x2) / 2, dy = (y - y2) / 2;
    const x1p = co * dx + si * dy, y1p = -si * dx + co * dy;
    const l = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
    if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const f = (grand === sens ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
    const cxp = f * rx * y1p / ry, cyp = -f * ry * x1p / rx;
    const cx = co * cxp - si * cyp + (x + x2) / 2, cy = si * cxp + co * cyp + (y + y2) / 2;
    const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    const t1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    let dt = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    if (!sens && dt > 0) dt -= 2 * Math.PI; else if (sens && dt < 0) dt += 2 * Math.PI;
    for (let i = 1; i <= 48; i++) {
      const t = t1 + dt * i / 48;
      c.push([cx + rx * Math.cos(t) * co - ry * Math.sin(t) * si, cy + rx * Math.cos(t) * si + ry * Math.sin(t) * co]);
    }
    x = x2; y = y2;
  }
  return contours;
}
const CONTOURS = aplatir(LOGO.d);
// Règle non nulle : somme des enroulements du point autour de chaque contour.
function dedans(px, py) {
  let w = 0;
  for (const c of CONTOURS) for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xa, ya] = c[j], [xb, yb] = c[i];
    if (ya <= py) { if (yb > py && (xb - xa) * (py - ya) - (px - xa) * (yb - ya) > 0) w++; }
    else if (yb <= py && (xb - xa) * (py - ya) - (px - xa) * (yb - ya) < 0) w--;
  }
  return w !== 0;
}
const carre = (x, y, cote, r) => {
  const q = Math.abs(x - cote / 2) - (cote / 2 - r), q2 = Math.abs(y - cote / 2) - (cote / 2 - r);
  return Math.hypot(Math.max(q, 0), Math.max(q2, 0)) + Math.min(Math.max(q, q2), 0) - r <= 0;
};
function icone(cote) {
  const px = new Uint8Array(cote * cote * 4);
  const N = 4, [vx, vy, vl, vh] = LOGO.vb;
  // Le logo occupe 70 % du carré, centré.
  const marge = 32 * 0.15, echelle = (32 * 0.7) / Math.max(vl, vh);
  for (let j = 0; j < cote; j++) for (let i = 0; i < cote; i++) {
    let fond = 0, trait = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      const x = ((i + (a + 0.5) / N) / cote) * 32, y = ((j + (b + 0.5) / N) / cote) * 32;
      if (!carre(x, y, 32, 8)) continue;
      fond++;
      if (dedans(vx + (x - marge) / echelle, vy + (y - marge) / echelle)) trait++;
    }
    const k = (j * cote + i) * 4, t = trait / fond || 0;
    for (let c = 0; c < 3; c++) px[k + c] = Math.round(FOND[c] + (ENCRE[c] - FOND[c]) * t);
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
