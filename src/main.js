// Démarrage de SÉSAME : configuration validée, base, socle commun (comptes,
// sessions, journal, administration par le Hub), logos, et serveur HTTP de
// l'interface et de l'API. Rien d'autre ne tourne : aucun appel sortant hors
// des logos, aucune IA, aucun jeton de service.
import http from 'node:http';
import path from 'node:path';
import { lireConfigSesame, VERSION } from './config.js';
import { ouvrirBase } from './base.js';
import { Logos } from './logos.js';
import { creerApi } from './api.js';
import {
  Debit, ErreurHttp, demarrerSocle, entetesSecurite, envelopper, nonceCsp, politiqueContenu,
  repondreErreur, repondreJson, servirFichier,
} from '../socle/src/index.js';

const RACINE = path.resolve(import.meta.dirname, '..');
const CONSOLE = { info: (...a) => console.log(...a), warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) };
const CONTACT_SECURITE = 'https://github.com/CodexX64/sesame/security/advisories/new';

export async function demarrer(env = process.env, { log = CONSOLE, logos: optionsLogos = {} } = {}) {
  const cfg = lireConfigSesame(env);
  const db = ouvrirBase(cfg.donnees);
  const socle = await demarrerSocle({ service: { id: 'sesame', nom: 'SÉSAME', contactSecurite: CONTACT_SECURITE }, db, dossier: cfg.donnees, env, log });
  const logos = new Logos({ db, actif: cfg.logos === 'oui', log, ...optionsLogos });
  const api = creerApi({ socle, db, logos, cfg });

  const debit = new Debit({ max: 900 });
  const serveur = http.createServer(envelopper(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://sesame');
      const ctx = socle.portail.contexte(req, res);
      if (!debit.prendre(ctx.ip)) throw new ErreurHttp(429, 'Trop de requêtes.');
      ctx.url = url;
      const nonce = nonceCsp();
      // Aucune origine extérieure : ni police, ni image, ni script venus d'ailleurs.
      entetesSecurite(res, { secure: ctx.securise, hote: req.headers.host, csp: politiqueContenu({ nonce, secure: ctx.securise }) });
      if (await socle.portail.traiter(req, res, url, ctx)) return;
      if (await api.traiter(ctx)) return;
      if (!['GET', 'HEAD'].includes(req.method)) return repondreJson(res, 405, { error: 'Méthode non admise.' });
      if (url.pathname.startsWith('/socle/') && servirFichier(req, res, path.join(RACINE, 'socle', 'web'), url.pathname.slice(6), { nonce, cache: 'public, max-age=3600' })) return;
      const fichier = url.pathname === '/' ? '/index.html' : url.pathname;
      if (servirFichier(req, res, path.join(RACINE, 'web'), fichier, { nonce, gamme: socle.cfg.gamme })) return;
      repondreJson(res, 404, { error: 'Introuvable.' });
    } catch (e) { repondreErreur(res, e, { journal: log }); }
  }));
  serveur.headersTimeout = 20_000;
  serveur.requestTimeout = 120_000;
  serveur.keepAliveTimeout = 5_000;
  await new Promise(r => serveur.listen(cfg.port, cfg.hote, r));
  log.info?.(`SÉSAME ${VERSION} à l’écoute sur ${cfg.hote}:${serveur.address().port}`);

  return {
    serveur, db, socle, logos, api, port: serveur.address().port,
    async arreter() {
      socle.arreter();
      await new Promise(r => serveur.close(r));
      db.close();
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  process.umask(0o077);
  const r = await demarrer().catch(e => { console.error(e.message); process.exit(1); });
  const fin = async sig => { console.log(`${sig} reçu, arrêt propre`); await r.arreter(); process.exit(0); };
  process.on('SIGINT', fin);
  process.on('SIGTERM', fin);
}
