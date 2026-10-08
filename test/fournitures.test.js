// Ce que SÉSAME sert sans l'avoir écrit : chaque fichier doit être exactement
// celui dont PROVENANCE garde l'empreinte, licence à côté.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

const dossier = new URL('../web/vendor/', import.meta.url);

test('fichiers tiers servis : empreinte conforme à PROVENANCE, licence présente', () => {
  const provenance = fs.readFileSync(new URL('PROVENANCE', dossier), 'utf8');
  const blocs = provenance.split(/\n(?=\S)/).filter(b => b.trim());
  const servis = fs.readdirSync(dossier, { recursive: true }).filter(f => f.endsWith('.js'));
  assert.ok(servis.length > 0);
  assert.equal(blocs.length, servis.length, 'un bloc de PROVENANCE par fichier servi, ni plus ni moins');
  for (const fichier of servis) {
    const bloc = blocs.find(b => b.startsWith(fichier + '\n'));
    assert.ok(bloc, `${fichier} absent de PROVENANCE`);
    const attendu = /fichier\s*:\s*sha256 ([0-9a-f]{64})/.exec(bloc)?.[1];
    const reel = crypto.createHash('sha256').update(fs.readFileSync(new URL(fichier, dossier))).digest('hex');
    assert.equal(reel, attendu, fichier);
    const licence = /voir ([\w./-]+)\)/.exec(bloc)?.[1];
    assert.ok(licence && fs.existsSync(new URL(licence, dossier)), `licence de ${fichier}`);
  }
});

test('SBOM : alignée sur PROVENANCE, le Dockerfile, le socle embarqué et la version du service', () => {
  const lire = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
  const sbom = JSON.parse(lire('sbom.cdx.json'));
  const parNom = Object.fromEntries(sbom.components.map(c => [c.name, c]));
  const prov = lire('web/vendor/PROVENANCE');
  const integrite = Buffer.from(/paquet\s*:\s*sha512-(\S+)/.exec(prov)[1], 'base64').toString('hex');
  assert.equal(parNom['@noble/hashes'].hashes[0].content, integrite);
  assert.ok(prov.includes(`@noble/hashes@${parNom['@noble/hashes'].version}`));
  const [, etiquette, empreinte] = /NODE_IMAGE=node:([\w.-]+)@sha256:([0-9a-f]{64})/.exec(lire('Dockerfile'));
  assert.deepEqual([parNom.node.version, parNom.node.hashes[0].content], [etiquette, empreinte]);
  assert.equal(parNom.socle.version, lire('socle/VERSION').trim());
  assert.equal(sbom.metadata.component.version, JSON.parse(lire('package.json')).version);
});
