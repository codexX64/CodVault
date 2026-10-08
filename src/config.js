// Configuration de SÉSAME, lue et validée une fois au démarrage. Les variables
// SOCLE_* (comptes, relais, clé maîtresse, jeton d'administration du Hub) sont
// lues par le socle. Une valeur invalide arrête le processus avec la liste
// complète des erreurs.
import { lireConfig } from '../socle/src/index.js';

export const VERSION = '1.0.0';

export function lireConfigSesame(env = process.env) {
  return lireConfig({
    port: { env: 'PORT', type: 'entier', min: 0, max: 65535, defaut: 8175 },
    hote: { env: 'HOTE', type: 'chaine', defaut: '0.0.0.0' },
    donnees: { env: 'DATA_DIR', type: 'chaine', defaut: '/data' },
    // Les logos des sites : récupérés par le serveur, une fois, puis gardés.
    // « non » coupe toute requête sortante : les initiales seules restent.
    logos: { env: 'SESAME_LOGOS', type: 'choix', parmi: ['oui', 'non'], defaut: 'oui' },
    // Plafonds par compte.
    maxElements: { env: 'SESAME_MAX_ELEMENTS', type: 'entier', min: 10, max: 100000, defaut: 5000 },
    maxMio: { env: 'SESAME_MAX_MIO', type: 'entier', min: 1, max: 4096, defaut: 64 },
  }, env);
}
