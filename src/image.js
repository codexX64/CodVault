// Un logo n'est jamais resservi tel qu'un site l'a envoyé : il est décodé ici
// (PNG, ou ICO qui contient un PNG ou un BMP), ramené à 64 px au plus, puis
// réencodé en PNG par ce fichier. Les octets servis sont les nôtres : ni
// métadonnées (EXIF, texte, profil de couleur), ni charge cachée, ni format
// inattendu. Les dimensions sont lues et bornées avant tout décodage, et la
// décompression est bornée à la taille annoncée : une petite image qui se dit
// immense ou une bombe de compression s'arrêtent là.
import zlib from 'node:zlib';

const COTE_MAX = 512;
export const COTE_SORTIE = 64;
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CANAUX = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const PROFONDEURS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
const coteAdmis = n => Number.isInteger(n) && n >= 1 && n <= COTE_MAX;

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Une image { l, h, px } (RGBA, 8 bits) depuis un PNG non entrelacé, ou null. */
export function lirePng(o) {
  if (o.length < 45 || !o.subarray(0, 8).equals(SIGNATURE_PNG)) return null;
  let pos = 8, en = null, palette = null, transp = null;
  const idat = [];
  while (pos + 12 <= o.length) {
    const n = o.readUInt32BE(pos), type = o.toString('latin1', pos + 4, pos + 8);
    if (n > o.length - pos - 12) return null;
    const d = o.subarray(pos + 8, pos + 8 + n);
    if (type === 'IHDR') {
      if (n !== 13) return null;
      en = { l: d.readUInt32BE(0), h: d.readUInt32BE(4), prof: d[8], couleur: d[9], autres: d[10] | d[11] | d[12] };
    } else if (type === 'PLTE') palette = d;
    else if (type === 'tRNS') transp = d;
    else if (type === 'IDAT') idat.push(d);
    else if (type === 'IEND') break;
    pos += 12 + n;
  }
  // Compression, filtrage et entrelacement autres que ceux de base : refusés.
  if (!en || en.autres || !coteAdmis(en.l) || !coteAdmis(en.h) || !PROFONDEURS[en.couleur]?.includes(en.prof)) return null;
  if (en.couleur === 3 && !palette) return null;
  const bits = CANAUX[en.couleur] * en.prof, parPixel = Math.max(1, bits >> 3), ligne = Math.ceil(en.l * bits / 8);
  const attendu = en.h * (ligne + 1);
  let brut;
  try { brut = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: attendu }); } catch { return null; }
  if (brut.length < attendu) return null;

  const lignes = new Uint8Array(en.h * ligne);
  for (let y = 0; y < en.h; y++) {
    const filtre = brut[y * (ligne + 1)], src = y * (ligne + 1) + 1, dst = y * ligne;
    for (let i = 0; i < ligne; i++) {
      const x = brut[src + i], a = i >= parPixel ? lignes[dst + i - parPixel] : 0;
      const b = y ? lignes[dst - ligne + i] : 0, c = y && i >= parPixel ? lignes[dst - ligne + i - parPixel] : 0;
      const v = filtre === 0 ? 0 : filtre === 1 ? a : filtre === 2 ? b : filtre === 3 ? (a + b) >> 1 : filtre === 4 ? paeth(a, b, c) : -1;
      if (v < 0) return null;
      lignes[dst + i] = (x + v) & 255;
    }
  }

  // Un échantillon à sa profondeur d'origine.
  const echantillon = (y, k) => {
    const o2 = y * ligne;
    if (en.prof === 16) return (lignes[o2 + 2 * k] << 8) | lignes[o2 + 2 * k + 1];
    if (en.prof === 8) return lignes[o2 + k];
    const parOctet = 8 / en.prof, octet = lignes[o2 + Math.floor(k / parOctet)];
    return (octet >> (8 - en.prof * (1 + k % parOctet))) & ((1 << en.prof) - 1);
  };
  const vers8 = v => (en.prof === 16 ? v >> 8 : en.prof === 8 ? v : Math.round(v * 255 / ((1 << en.prof) - 1)));
  const cle = transp && (en.couleur === 0 ? [transp.readUInt16BE(0)] : en.couleur === 2 && transp.length >= 6 ? [transp.readUInt16BE(0), transp.readUInt16BE(2), transp.readUInt16BE(4)] : null);
  const px = new Uint8Array(en.l * en.h * 4);
  for (let y = 0; y < en.h; y++) {
    for (let x = 0; x < en.l; x++) {
      const k = x * CANAUX[en.couleur], o4 = (y * en.l + x) * 4;
      if (en.couleur === 3) {
        const i = echantillon(y, k);
        if (3 * i + 2 >= palette.length) return null;
        px.set([palette[3 * i], palette[3 * i + 1], palette[3 * i + 2], transp && i < transp.length ? transp[i] : 255], o4);
      } else if (en.couleur === 0 || en.couleur === 4) {
        const g = echantillon(y, k);
        const a = en.couleur === 4 ? vers8(echantillon(y, k + 1)) : cle && g === cle[0] ? 0 : 255;
        px.set([vers8(g), vers8(g), vers8(g), a], o4);
      } else {
        const r = echantillon(y, k), v = echantillon(y, k + 1), b = echantillon(y, k + 2);
        const a = en.couleur === 6 ? vers8(echantillon(y, k + 3)) : cle && r === cle[0] && v === cle[1] && b === cle[2] ? 0 : 255;
        px.set([vers8(r), vers8(v), vers8(b), a], o4);
      }
    }
  }
  return { l: en.l, h: en.h, px };
}

/** Une image depuis le BMP sans en-tête de fichier d'une icône (1, 4, 8, 24 ou 32 bits, non compressé), ou null. */
function lireBmpIcone(o) {
  if (o.length < 40 || o.readUInt32LE(0) !== 40) return null;
  const l = o.readInt32LE(4), h = o.readInt32LE(8) / 2, bpp = o.readUInt16LE(14), compression = o.readUInt32LE(16);
  if (!coteAdmis(l) || !coteAdmis(h) || compression !== 0 || ![1, 4, 8, 24, 32].includes(bpp)) return null;
  const couleurs = bpp <= 8 ? (o.readUInt32LE(32) || 1 << bpp) : 0;
  if (couleurs > 1 << bpp) return null;
  const debut = 40 + couleurs * 4, pas = Math.floor((bpp * l + 31) / 32) * 4, pasMasque = Math.floor((l + 31) / 32) * 4;
  const masque = debut + pas * h;
  if (o.length < masque + (bpp === 32 ? 0 : pasMasque * h)) return null;
  const px = new Uint8Array(l * h * 4);
  let alphaVu = false;
  for (let y = 0; y < h; y++) {
    const ligne = debut + (h - 1 - y) * pas;            // de bas en haut
    for (let x = 0; x < l; x++) {
      const o4 = (y * l + x) * 4;
      if (bpp >= 24) {
        const p = ligne + x * (bpp >> 3);
        px.set([o[p + 2], o[p + 1], o[p], bpp === 32 ? o[p + 3] : 255], o4);
        if (bpp === 32 && o[p + 3]) alphaVu = true;
      } else {
        const bit = x * bpp, i = (o[ligne + (bit >> 3)] >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        if (i >= couleurs) return null;
        const c = 40 + i * 4;
        px.set([o[c + 2], o[c + 1], o[c], 255], o4);
      }
    }
  }
  // Sans canal alpha utile, c'est le masque ET qui dit la transparence (1 = transparent).
  if (!alphaVu && o.length >= masque + pasMasque * h) {
    for (let y = 0; y < h; y++) {
      const ligne = masque + (h - 1 - y) * pasMasque;
      for (let x = 0; x < l; x++) px[(y * l + x) * 4 + 3] = (o[ligne + (x >> 3)] >> (7 - (x & 7))) & 1 ? 0 : 255;
    }
  }
  return { l, h, px };
}

/** L'image la plus utile d'un fichier ICO (la plus grande jusqu'à 512 px), ou null. */
function lireIco(o) {
  if (o.length < 22 || o.readUInt16LE(0) !== 0 || o.readUInt16LE(2) !== 1) return null;
  const n = o.readUInt16LE(4);
  if (!n || n > 64 || o.length < 6 + 16 * n) return null;
  const entrees = [];
  for (let i = 0; i < n; i++) {
    const e = 6 + 16 * i, taille = o.readUInt32LE(e + 8), debut = o.readUInt32LE(e + 12);
    if (debut + taille > o.length || taille < 40) continue;
    entrees.push({ cote: o[e] || 256, bpp: o.readUInt16LE(e + 6), donnees: o.subarray(debut, debut + taille) });
  }
  entrees.sort((a, b) => b.cote - a.cote || b.bpp - a.bpp);
  for (const e of entrees) {
    const img = e.donnees.subarray(0, 8).equals(SIGNATURE_PNG) ? lirePng(e.donnees) : lireBmpIcone(e.donnees);
    if (img) return img;
  }
  return null;
}

/** Réduction par moyenne de surface, en alpha prémultiplié (pas de liseré sombre). */
function reduire({ l, h, px }) {
  if (Math.max(l, h) <= COTE_SORTIE) return { l, h, px };
  const k = COTE_SORTIE / Math.max(l, h), nl = Math.max(1, Math.round(l * k)), nh = Math.max(1, Math.round(h * k));
  const out = new Uint8Array(nl * nh * 4);
  for (let oy = 0; oy < nh; oy++) {
    const y0 = Math.floor(oy * h / nh), y1 = Math.max(y0 + 1, Math.floor((oy + 1) * h / nh));
    for (let ox = 0; ox < nl; ox++) {
      const x0 = Math.floor(ox * l / nl), x1 = Math.max(x0 + 1, Math.floor((ox + 1) * l / nl));
      let r = 0, v = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * l + x) * 4, al = px[i + 3];
        r += px[i] * al; v += px[i + 1] * al; b += px[i + 2] * al; a += al; n++;
      }
      out.set(a ? [Math.round(r / a), Math.round(v / a), Math.round(b / a), Math.round(a / n)] : [0, 0, 0, 0], (oy * nl + ox) * 4);
    }
  }
  return { l: nl, h: nh, px: out };
}

function morceau(type, donnees) {
  const t = Buffer.from(type, 'latin1'), n = Buffer.alloc(4), crc = Buffer.alloc(4);
  n.writeUInt32BE(donnees.length);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, donnees])));
  return Buffer.concat([n, t, donnees, crc]);
}

/** Un PNG RGBA 8 bits minimal (IHDR, IDAT, IEND), écrit ici. */
export function ecrirePng({ l, h, px }) {
  const en = Buffer.alloc(13);
  en.writeUInt32BE(l, 0); en.writeUInt32BE(h, 4); en[8] = 8; en[9] = 6;
  const brut = Buffer.alloc(h * (l * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, px.byteOffset + y * l * 4, l * 4).copy(brut, y * (l * 4 + 1) + 1);
  return Buffer.concat([SIGNATURE_PNG, morceau('IHDR', en), morceau('IDAT', zlib.deflateSync(brut, { level: 9 })), morceau('IEND', Buffer.alloc(0))]);
}

/** Les octets reçus d'un site, réencodés en PNG d'au plus 64 px ; null s'ils ne sont pas une icône lisible et visible. */
export function normaliser(octets) {
  const img = octets.subarray(0, 8).equals(SIGNATURE_PNG) ? lirePng(octets) : lireIco(octets);
  if (!img) return null;
  const petit = reduire(img);
  for (let i = 3; i < petit.px.length; i += 4) if (petit.px[i]) return ecrirePng(petit);
  return null;
}
