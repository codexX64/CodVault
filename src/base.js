// Base de CODVAULT. Elle ne contient que du chiffré : les coffres (clé du coffre
// enveloppée par le mot de passe maître et par la clé de récupération, clé
// privée chiffrée, clé publique), les éléments (chacun chiffré par sa propre
// clé, enveloppée pour son propriétaire), les partages (la clé de l'élément
// enveloppée pour le destinataire), le cache des logos, commun à tous, et les
// appareils reliés (l'empreinte de leur jeton, jamais le jeton).
// Une copie de cette base ne rend aucun mot de passe sans les mots de passe maîtres.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function ouvrirBase(dossier) {
  fs.mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const fichier = path.join(dossier, 'codvault.db');
  fs.closeSync(fs.openSync(fichier, 'a', 0o600));
  for (const f of [fichier, fichier + '-wal', fichier + '-shm']) if (fs.existsSync(f)) fs.chmodSync(f, 0o600);
  const db = new DatabaseSync(fichier);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL; PRAGMA secure_delete = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS coffres(
      compte TEXT PRIMARY KEY, kdf TEXT NOT NULL, cle TEXT NOT NULL, recuperation TEXT NOT NULL,
      cle_publique TEXT NOT NULL, cle_privee TEXT NOT NULL, empreinte TEXT NOT NULL,
      preferences TEXT, version INTEGER NOT NULL DEFAULT 1, cree INTEGER NOT NULL, modifie INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS elements(
      id TEXT PRIMARY KEY, proprietaire TEXT NOT NULL, chiffre TEXT NOT NULL, cle TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, cree INTEGER NOT NULL, modifie INTEGER NOT NULL, modifie_par TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS elements_proprietaire ON elements(proprietaire);
    CREATE TABLE IF NOT EXISTS partages(
      element TEXT NOT NULL REFERENCES elements(id) ON DELETE CASCADE, destinataire TEXT NOT NULL,
      cle TEXT NOT NULL, droits TEXT NOT NULL, cree INTEGER NOT NULL, PRIMARY KEY(element, destinataire));
    CREATE INDEX IF NOT EXISTS partages_destinataire ON partages(destinataire);
    CREATE TABLE IF NOT EXISTS logos(
      domaine TEXT PRIMARY KEY, type TEXT, octets BLOB, recupere INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS appareils(
      id TEXT PRIMARY KEY, compte TEXT NOT NULL, nom TEXT NOT NULL, empreinte TEXT NOT NULL UNIQUE,
      cree INTEGER NOT NULL, vu INTEGER NOT NULL, expire INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS appareils_compte ON appareils(compte);
  `);
  return db;
}

/** Tout ce qui appartient à un compte qui s'en va : son coffre, ses éléments (et leurs partages), ce qu'on lui avait partagé, ses appareils. */
export function effacerCompte(db, compte) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM appareils WHERE compte = ?').run(compte);
    db.prepare('DELETE FROM partages WHERE destinataire = ?').run(compte);
    db.prepare('DELETE FROM elements WHERE proprietaire = ?').run(compte);
    db.prepare('DELETE FROM coffres WHERE compte = ?').run(compte);
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
