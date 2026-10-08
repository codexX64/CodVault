// Document hors écran (Chrome) : le seul endroit d'où l'arrière-plan peut
// écrire dans le presse-papiers. Il y remplace le mot de passe copié par une espace.
const navigateur = globalThis.browser ?? globalThis.chrome;
navigateur.runtime.onMessage.addListener((m, envoyeur, repondre) => {
  if (envoyeur.id !== navigateur.runtime.id || m?.quoi !== 'vider-presse') return;
  const t = document.getElementById('t');
  t.value = ' ';
  t.select();
  document.execCommand('copy');
  t.value = '';
  repondre(true);
});
