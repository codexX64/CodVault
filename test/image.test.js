// Le réencodage des logos : ce qui entre est décodé, ce qui sort est un PNG
// écrit par CODVAULT, sans rien de l'original que ses pixels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { normaliser, lirePng, ecrirePng, COTE_SORTIE } from '../src/image.js';

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const morceau = (type, d) => {
  const t = Buffer.from(type, 'latin1'), n = Buffer.alloc(4), c = Buffer.alloc(4);
  n.writeUInt32BE(d.length); c.writeUInt32BE(zlib.crc32(Buffer.concat([t, d])));
  return Buffer.concat([n, t, d, c]);
};
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };

/** Un PNG écrit selon la spécification, indépendamment de src/image.js : lignes brutes, filtre choisi par ligne. */
function png({ l, h, couleur, prof, lignes, filtres = [0], extra = [] }) {
  const en = Buffer.alloc(13);
  en.writeUInt32BE(l, 0); en.writeUInt32BE(h, 4); en[8] = prof; en[9] = couleur;
  const bpp = Math.max(1, ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[couleur] * prof) >> 3);
  const sortie = [];
  lignes.forEach((ligne, y) => {
    const f = filtres[y % filtres.length], prec = lignes[y - 1];
    const out = ligne.map((x, i) => {
      const a = i >= bpp ? ligne[i - bpp] : 0, b = prec ? prec[i] : 0, c = prec && i >= bpp ? prec[i - bpp] : 0;
      return (x - [0, a, b, (a + b) >> 1, paeth(a, b, c)][f] + 256) & 255;
    });
    sortie.push(f, ...out);
  });
  return Buffer.concat([SIG, morceau('IHDR', en), ...extra, morceau('IDAT', zlib.deflateSync(Buffer.from(sortie))), morceau('IEND', Buffer.alloc(0))]);
}
const types = o => { const t = []; for (let p = 8; p < o.length; p += 12 + o.readUInt32BE(p)) t.push(o.toString('latin1', p + 4, p + 8)); return t; };
const pixel = (img, x, y) => [...img.px.subarray((y * img.l + x) * 4, (y * img.l + x) * 4 + 4)];

test('PNG : chaque type de couleur et chaque filtre décodés à l’identique', () => {
  // RGBA 8 bits, 4 × 3, filtres Sub, Up, Average, Paeth : un dégradé qui fait travailler chaque prédicteur.
  const rgba = Array.from({ length: 3 }, (_, y) => Array.from({ length: 16 }, (_, i) => (i * 37 + y * 91) & 255));
  for (const f of [0, 1, 2, 3, 4]) {
    const img = lirePng(png({ l: 4, h: 3, couleur: 6, prof: 8, lignes: rgba, filtres: [f] }));
    assert.deepEqual([...img.px], rgba.flat(), `filtre ${f}`);
  }
  // Palette 8 bits avec transparence par entrée.
  const pal = lirePng(png({ l: 2, h: 1, couleur: 3, prof: 8, lignes: [[0, 1]], extra: [morceau('PLTE', Buffer.from([255, 0, 0, 0, 0, 255])), morceau('tRNS', Buffer.from([128]))] }));
  assert.deepEqual([...pal.px], [255, 0, 0, 128, 0, 0, 255, 255]);
  // Gris 1 bit : 0b10100000 → blanc, noir, blanc.
  assert.deepEqual([...lirePng(png({ l: 3, h: 1, couleur: 0, prof: 1, lignes: [[0b10100000]] })).px], [255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  // RVB 16 bits : l'octet de poids fort est gardé.
  assert.deepEqual([...lirePng(png({ l: 1, h: 1, couleur: 2, prof: 16, lignes: [[0x12, 0x34, 0xab, 0xcd, 0xff, 0x00]] })).px], [0x12, 0xab, 0xff, 255]);
  // Ce que CODVAULT écrit, il le relit à l'identique.
  assert.deepEqual([...lirePng(ecrirePng({ l: 4, h: 3, px: Uint8Array.from(rgba.flat()) })).px], rgba.flat());
});

test('réencodage : métadonnées retirées, taille ramenée à 64 px, rien de l’original que ses pixels', () => {
  const l = 128, lignes = Array.from({ length: l }, () => Array.from({ length: l * 4 }, (_, i) => [200, 30, 60, 255][i % 4]));
  const exif = morceau('eXIf', Buffer.from('MM\0*GPS 48.8566 2.3522 appareil-de-quelqu-un'));
  const texte = morceau('tEXt', Buffer.from('Author\0quelqu-un'));
  const source = png({ l, h: l, couleur: 6, prof: 8, lignes, filtres: [1, 4], extra: [exif, texte] });
  const sortie = normaliser(source);
  assert.deepEqual(types(sortie), ['IHDR', 'IDAT', 'IEND']);
  assert.ok(!sortie.includes(Buffer.from('GPS')) && !sortie.includes(Buffer.from('Author')));
  const img = lirePng(sortie);
  assert.equal(img.l, COTE_SORTIE);
  assert.equal(img.h, COTE_SORTIE);
  assert.deepEqual(pixel(img, 31, 31), [200, 30, 60, 255]);
  // Une icône déjà petite garde sa taille ; une icône entièrement transparente ne sert à rien.
  assert.equal(lirePng(normaliser(png({ l: 16, h: 16, couleur: 6, prof: 8, lignes: Array(16).fill(Array(64).fill(255)) }))).l, 16);
  assert.equal(normaliser(png({ l: 2, h: 2, couleur: 6, prof: 8, lignes: Array(2).fill(Array(8).fill(0)) })), null);
});

test('ICO : BMP 32 bits, BMP à palette avec masque, PNG embarqué', () => {
  const ico = images => {
    const tete = Buffer.alloc(6 + 16 * images.length);
    tete.writeUInt16LE(1, 2); tete.writeUInt16LE(images.length, 4);
    let debut = tete.length;
    images.forEach(({ cote, bpp, donnees }, i) => {
      tete[6 + 16 * i] = cote; tete[7 + 16 * i] = cote; tete.writeUInt16LE(bpp, 12 + 16 * i);
      tete.writeUInt32LE(donnees.length, 14 + 16 * i); tete.writeUInt32LE(debut, 18 + 16 * i);
      debut += donnees.length;
    });
    return Buffer.concat([tete, ...images.map(x => x.donnees)]);
  };
  const dib = (cote, bpp, couleurs = 0) => { const d = Buffer.alloc(40); d.writeUInt32LE(40, 0); d.writeInt32LE(cote, 4); d.writeInt32LE(cote * 2, 8); d.writeUInt16LE(1, 12); d.writeUInt16LE(bpp, 14); d.writeUInt32LE(couleurs, 32); return d; };
  // 2 × 2, 32 bits BGRA, de bas en haut : la ligne du haut est la seconde écrite.
  const bas = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), haut = Buffer.from([0, 0, 255, 255, 0, 0, 0, 0]);
  const b32 = Buffer.concat([dib(2, 32), bas, haut, Buffer.alloc(8)]);
  const a = lirePng(normaliser(ico([{ cote: 2, bpp: 32, donnees: b32 }])));
  assert.deepEqual([pixel(a, 0, 0), pixel(a, 1, 0)[3], pixel(a, 0, 1), pixel(a, 1, 1)], [[255, 0, 0, 255], 0, [0, 0, 255, 255], [0, 255, 0, 255]]);
  // 4 bits à palette, masque ET : le pixel (1, 0) est transparent.
  const palette = Buffer.from([0, 0, 0, 0, 0, 200, 0, 0]);                       // 0 : noir, 1 : vert
  const lignes4 = Buffer.from([0x11, 0, 0, 0, 0x11, 0, 0, 0]);                       // deux lignes « 1 1 », pas de 4 octets
  const masque = Buffer.from([0, 0, 0, 0, 0b01000000, 0, 0, 0]);                    // ligne du haut (écrite en second) : x = 1
  const b4 = Buffer.concat([dib(2, 4, 2), palette, lignes4, masque]);
  const b = lirePng(normaliser(ico([{ cote: 2, bpp: 4, donnees: b4 }])));
  assert.deepEqual([pixel(b, 0, 0), pixel(b, 1, 0)[3], pixel(b, 1, 1)], [[0, 200, 0, 255], 0, [0, 200, 0, 255]]);
  // Un PNG dans l'ICO, préféré à la petite image BMP parce que plus grand.
  const grand = png({ l: 48, h: 48, couleur: 2, prof: 8, lignes: Array(48).fill(Array(144).fill(90)) });
  assert.equal(lirePng(normaliser(ico([{ cote: 2, bpp: 32, donnees: b32 }, { cote: 48, bpp: 32, donnees: grand }]))).l, 48);
});

test('refusés : formats non décodés, dimensions géantes, bombe de compression, données tronquées', () => {
  for (const autre of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<!doctype html><script>x</script>', '\xff\xd8\xff\xe0JFIF', 'GIF89a', 'RIFF\0\0\0\0WEBPVP8 '])
    assert.equal(normaliser(Buffer.from(autre, 'latin1')), null, autre.slice(0, 12));
  // 100 000 × 100 000 annoncés : refusé à la lecture de l'en-tête, avant toute décompression.
  const geant = png({ l: 1, h: 1, couleur: 6, prof: 8, lignes: [[1, 2, 3, 4]] });
  geant.writeUInt32BE(100_000, 16); geant.writeUInt32BE(100_000, 20);
  const t0 = performance.now();
  assert.equal(normaliser(geant), null);
  assert.ok(performance.now() - t0 < 50);
  // 8 × 8 annoncés, 64 Mio de zéros compressés : la décompression s'arrête à la taille annoncée.
  const en = Buffer.alloc(13); en.writeUInt32BE(8, 0); en.writeUInt32BE(8, 4); en[8] = 8; en[9] = 6;
  const bombe = Buffer.concat([SIG, morceau('IHDR', en), morceau('IDAT', zlib.deflateSync(Buffer.alloc(64 * 1024 * 1024))), morceau('IEND', Buffer.alloc(0))]);
  assert.ok(bombe.length < 100_000);
  assert.equal(normaliser(bombe), null);
  // Entrelacé (Adam7), tronqué, filtre inconnu : refusés.
  const entrelace = png({ l: 1, h: 1, couleur: 6, prof: 8, lignes: [[1, 2, 3, 4]] }); entrelace[28] = 1;
  assert.equal(normaliser(entrelace), null);
  const correct = png({ l: 4, h: 4, couleur: 6, prof: 8, lignes: Array(4).fill(Array(16).fill(255)) });
  assert.equal(normaliser(correct.subarray(0, correct.length - 30)), null);
  const filtreInconnu = Buffer.concat([SIG, morceau('IHDR', Buffer.from(correct.subarray(16, 29))), morceau('IDAT', zlib.deflateSync(Buffer.from([9, ...Array(16).fill(1), 0, ...Array(16).fill(1), 0, ...Array(16).fill(1), 0, ...Array(16).fill(1)]))), morceau('IEND', Buffer.alloc(0))]);
  assert.equal(normaliser(filtreInconnu), null);
});
