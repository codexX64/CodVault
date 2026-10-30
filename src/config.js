// Configuration de CODVAULT, lue et validée une fois au démarrage. Les variables
// SOCLE_* (comptes, relais, clé maîtresse, jeton d'administration du Hub) sont
// lues par le socle. Une valeur invalide arrête le processus avec la liste
// complète des erreurs.
import { lireConfig } from '../socle/src/index.js';

export const VERSION = '2.0.3';

export const SPEC_CODVAULT = {
  port: { env: 'PORT', type: 'entier', min: 0, max: 65535, defaut: 8175 },
  hote: { env: 'HOTE', type: 'chaine', defaut: '0.0.0.0' },
  donnees: { env: 'DATA_DIR', type: 'chaine', defaut: '/data' },
  // Les logos des sites : récupérés par le serveur, une fois, puis gardés.
  // « non » coupe toute requête sortante : les initiales seules restent.
  logos: { env: 'CODVAULT_LOGOS', type: 'choix', parmi: ['oui', 'non'], defaut: 'oui' },
  // Plafonds par compte.
  maxElements: { env: 'CODVAULT_MAX_ELEMENTS', type: 'entier', min: 10, max: 100000, defaut: 5000 },
  maxMio: { env: 'CODVAULT_MAX_MIO', type: 'entier', min: 1, max: 4096, defaut: 64 },
};

// Ce que l'assistant de configuration demande (première installation, puis
// seulement les réglages nouveaux d'une mise à jour). depuis : la version qui
// a ajouté le réglage.
export const REGLAGES_CODVAULT = [
  { env: 'CODVAULT_LOGOS', groupe: 'Coffre', libelle: 'Logos des sites', depuis: '2.1.0', noms: { oui: 'Récupérés par le serveur', non: 'Jamais (initiales seules)' },
    aide: 'Le serveur va chercher une fois l’icône de chaque site, puis la garde. « Jamais » coupe toute requête sortante.' },
  { env: 'CODVAULT_MAX_ELEMENTS', groupe: 'Coffre', libelle: 'Éléments par compte au plus', depuis: '2.1.0', avance: true },
  { env: 'CODVAULT_MAX_MIO', groupe: 'Coffre', libelle: 'Taille d’un coffre au plus (Mio)', depuis: '2.1.0', avance: true },
];

export function lireConfigCodvault(env = process.env) {
  return lireConfig(SPEC_CODVAULT, env);
}
