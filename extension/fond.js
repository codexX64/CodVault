// Arrière-plan de l'extension : il ne garde rien lui-même. Il referme la
// session à son échéance ou quand l'écran se verrouille, vide le
// presse-papiers après une copie, et remplit sur le raccourci clavier quand
// un seul élément convient au site ouvert (sinon il ouvre la fenêtre).
import { navigateur, liaison, reprendre, elements, pourLeSite, hoteDe, remplirOnglet, verrouiller, PRESSE_SECONDES } from './coeur.js';

navigateur.alarms.onAlarm.addListener(async a => {
  if (a.name === 'verrou') await verrouiller();
  if (a.name === 'presse') await viderPresse();
});
navigateur.idle.onStateChanged.addListener(etat => { if (etat === 'locked') verrouiller(); });

navigateur.runtime.onMessage.addListener((m, envoyeur, repondre) => {
  if (envoyeur.id !== navigateur.runtime.id || envoyeur.tab || m?.quoi !== 'copie') return;
  navigateur.alarms.create('presse', { delayInMinutes: PRESSE_SECONDES / 60 });
  repondre(true);
});

async function viderPresse() {
  if (!navigateur.offscreen) return navigator.clipboard.writeText('');
  if (!(await navigateur.offscreen.hasDocument())) {
    await navigateur.offscreen.createDocument({ url: 'presse.html', reasons: ['CLIPBOARD'], justification: 'Effacer un mot de passe copié.' });
  }
  try { await navigateur.runtime.sendMessage({ quoi: 'vider-presse' }); } finally { await navigateur.offscreen.closeDocument(); }
}

navigateur.commands.onCommand.addListener(async (commande, ongletDonne) => {
  if (commande !== 'remplir') return;
  const onglet = ongletDonne ?? (await navigateur.tabs.query({ active: true, currentWindow: true }))[0];
  // Sans fenêtre de navigateur au premier plan, la fenêtre de l'extension ne peut pas s'ouvrir : le raccourci ne fait alors rien.
  const ouvrir = () => navigateur.action.openPopup?.().catch(() => {});
  try {
    const l = await liaison();
    const s = l && await reprendre(l);
    if (!s || !onglet) return ouvrir();
    const candidats = pourLeSite((await elements(l, s)).elements, hoteDe(onglet.url));
    if (candidats.length !== 1) return ouvrir();
    await remplirOnglet(onglet, candidats[0]);
  } catch { ouvrir(); }
});
