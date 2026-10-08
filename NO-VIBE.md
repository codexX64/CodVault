# Code quality record — SÉSAME

Method: Project Baseline Requirements & Security Manual, Part III (chapters 37-49)
Reviewed: 2026-10-08   ·   Owner: Codex64

## Behaviour freeze
SÉSAME est neuf : il reprend l'idée d'une maquette (un fichier HTML sans
serveur ni chiffrement réel), pas son code. Le passage Part III s'est fait en
deux volets. Le premier (bannières, un nom local, trois littéraux écrits en
échappements) a précédé le premier commit ; il ne change aucune instruction,
et la suite complète est passée juste après. Le second est dans l'historique,
après le commit fb3036c, qui sert de référence : 18 essais de SÉSAME et 63 du
socle, tous au vert (`git worktree add <dossier> fb3036c`, puis `npm test`),
plus le parcours Chromium (112 écrans × largeurs, 0 défaut, 0 erreur de
console). Le passage n'a touché ni une route, ni un schéma de corps, ni le
format d'un bloc chiffré, ni ce que l'interface et les essais importent de
`web/crypto.js` : diff de l'API publique vide. Les essais sont passés de 18 à
20 pour couvrir des cas que la relecture a trouvés sans essai.

Changements de comportement voulus, chacun étant le correctif :

| Avant | Après | Raison |
|---|---|---|
| mot de passe maître étiré par PBKDF2-SHA256 | Argon2id 64 Mio, 3 passes, 4 voies, plancher imposé par le serveur, renforcement au déverrouillage | REQ-CRYPT-001, REQ-CRYPT-002 |
| icône d'un site resservie telle que reçue, après contrôle de ses premiers octets | décodée, ramenée à 64 px, réencodée en PNG, servie en pièce jointe | SEC-FILE-001, SEC-FILE-004, SEC-FILE-007 |
| aucun plafond d'octets par coffre | 64 Mio par coffre, partages en écriture compris | SEC-FILE-002, REQ-WEB-008 |
| clé de récupération montrée avant que le coffre soit enregistré | enregistré d'abord, montrée ensuite | défaut : une clé mise de côté pouvait ne valoir pour aucun coffre |
| exports avec les éléments partagés par d'autres, champs CSV bruts | ses propres éléments seulement, formules de tableur neutralisées | injection de formule d'un compte à l'autre |
| export `.sesame` importé sans contrôle de forme | champs connus seulement, en texte, bornés | REQ-DATA-007 |
| en HTTP sous un vrai nom, échec silencieux | « HTTPS demandé », rien d'autre ne démarre | REQ-WEB-001 |
| déconnexion non confirmée : rechargement comme si de rien n'était | annoncée, coffre gardé verrouillé | défaut : session peut-être encore ouverte |
| presse-papiers non vidé quand l'onglet a perdu le focus | vidé au retour du focus | défaut : un mot de passe restait copié |
| notice et manifeste : « le serveur ignore à quel compte appartient un domaine de logo » | le serveur le voit à la demande et ne l'écrit nulle part | SEC-PRIV-003 : l'ancienne phrase était fausse |
| textes du manifeste repris de VIGIE | textes de SÉSAME | défaut de copie |

## Layer status
| Chapter | Subject | Status | What changed |
|---|---|---|---|
| 39 | Comment layer | DONE | 29 bannières de section retirées (API 4, interface 15, chiffrement 8, essais 2), 3 réécrites en phrase parce qu'elles disaient une intention ; un commentaire obscur réécrit (« au plus deux positions par caractère distinct ») ; chaque `catch` vide dit pourquoi |
| 40 | Naming and vocabulary | DONE | vocabulaire du dépôt : français, métier (coffre, élément, enveloppe, partage, renfort, dérivation) ; `res` → `dechiffres` ; restent `res` pour une réponse HTTP (idiome de Node) et `tmp` pour le dossier temporaire des essais |
| 41 | Formatting, layout and whitespace | DONE | style des autres services : 2 espaces, apostrophes simples, points-virgules ; une marque d'ordre d'octets, une plage de diacritiques et un emoji d'essai écrits en échappements plutôt qu'en caractères invisibles ou décoratifs |
| 42 | Gratuitous abstraction | DONE | ni interface à une implémentation, ni fabrique, ni suffixe Manager/Service ; `routeur` retiré de l'objet rendu par l'API (aucun lecteur) ; 14 exports de `web/crypto.js` sans lecteur rendus internes ; le nom d'un compte lu directement au lieu de construire son profil public |
| 43 | Defensive noise | DONE | 36 `catch` relus un à un (tableau ci-dessous) ; un `catch` global qui rendait « ? » retiré ; deux replis muets rendus explicites (déconnexion, presse-papiers) ; aucun message vague |
| 44 | Control flow and idiom | DONE | retours anticipés dans les routes ; décodeur d'image en étapes nommées (lire, défiltrer, convertir, réduire, écrire) ; `async`/`await` partout, aucune chaîne de `then` dans le service |
| 45 | Types, signatures and data shapes | DONE | un contrat par fonction : les routes lèvent `ErreurHttp`, le décodeur rend une image ou `null`, `deverrouiller` rend la session, avec `renfort` seulement si l'enveloppe est à refaire |
| 46 | Dependencies, configuration, fitting the repository | DONE | aucune dépendance npm ; une bibliothèque vendorisée, empreintes et SBOM tenues par les essais ; chaque variable de `.env.example` a un lecteur ; `.gitignore` et `.dockerignore` ramenés aux chemins qui existent ; dossier vide retiré |
| 47 | Tests | DONE | chemins d'erreur et frontières : balayage sans session et par rôle, champ en trop, corps géant, plafonds, plancher et renforcement d'Argon2id, adresses internes, image piégée, export fabriqué, formule de tableur, configuration invalide ; Argon2id aux paramètres de production, croisé avec celui de Node ; la recherche de clair lit maintenant la base et son WAL, en octets UTF-8 (elle ne pouvait pas trouver un « î ») ; cassures volontaires détectées (ci-dessous) |
| 48 | Documentation, furniture and version control | DONE | README vérifié phrase par phrase (sept largeurs de contrôle, pas cinq) ; `SECURITY.md` et ce fichier ; un sujet par commit, messages courts en français, identité unique, UTC |

`catch` restants (code de SÉSAME, hors socle), par raison :

| Raison | Nombre | Où |
|---|---|---|
| annulation de transaction puis relance | 2 | `src/base.js`, `src/api.js` |
| adresse, page ou icône d'un site illisible : on passe à la suivante | 4 | `src/logos.js` |
| décompression refusée (taille annoncée dépassée) | 1 | `src/image.js` |
| gestionnaire d'erreurs unique d'une requête, échec du démarrage | 2 | `src/main.js` |
| déchiffrement ou fichier refusé, traduit en message d'interface | 7 | `web/crypto.js` |
| saisie illisible (adresse, secret A2F, préférences) : valeur par défaut annoncée | 4 | `web/app.js`, `web/crypto.js` |
| erreur d'une action montrée dans son dialogue ou par une notification | 10 | `web/app.js` |
| bloc qui ne s'ouvre pas : compté et signalé | 1 | `web/app.js` |
| presse-papiers refusé ou à vider plus tard, favori orphelin | 3 | `web/app.js` |
| déconnexion non confirmée | 1 | `web/app.js` |
| parcours : bouton absent selon l'élément | 1 | `outils/parcours-navigateur.mjs` |

## Tests
Cassures volontaires (REQ-CODE-005) : chacune posée seule, les essais lancés, le fichier rétabli.

| Cassure | Fichier | Essais qui échouent |
|---|---|---|
| suppression d'un élément sans contrôle du propriétaire | `src/api.js` | « API : éléments », « partage », « balayage » |
| plancher d'Argon2id abaissé dans le navigateur et le serveur | `web/crypto.js`, `src/api.js` | « coffre : rien ne s'ouvre… », « API : le coffre se crée… » (et ceux qui en dépendent) |
| icône resservie sans réencodage | `src/logos.js` | « logos : du site lui-même… » |
| prédicteur Paeth faussé | `src/image.js` | « PNG : chaque type de couleur et chaque filtre… », « réencodage… » |
| masque de transparence des ICO lu à l'envers | `src/image.js` | « ICO : BMP 32 bits, BMP à palette avec masque… » |

## Repository style profile
Node 24, modules ES, aucune dépendance npm. Serveur : `node:http`,
`node:sqlite`, `node:zlib` ; navigateur : WebCrypto, Argon2id de
@noble/hashes, DOM construit par `h()` du socle, jamais de balisage injecté.
Vocabulaire français, identifiants et messages compris. Erreurs :
`ErreurHttp(status, message)` levée au plus près, formatée une seule fois par
`repondreErreur`. Configuration : `lireConfig` sur un schéma, arrêt au
démarrage avec toutes les erreurs. Journalisation : `journal.ecrire` pour ce
qui touche la sécurité, jamais un contenu ni un domaine. Frontières : `src/`
le service, `web/` l'interface et le chiffrement, `socle/` le commun embarqué
(modifié dans son propre dépôt, jamais ici), `test/` les essais, `outils/` la
vitrine, le parcours et l'exercice de rotation. Aides du socle reprises
plutôt que réécrites : `Routeur`, `valider`, `lireCorps`, `Debit`,
`portail.exiger`, `porte`, `dialogue`, `confirmer`, `toast`, `ajouterPictos`,
`pageSecurite`, `pageComptes`, le contrôle de mise en page et l'exercice de
rotation.

## Detection sweep
Commandes de l'annexe B.5 sur `src web/app.js web/crypto.js web/index.html
web/sesame.css test outils deploy Dockerfile .github hub.json` (hors
`web/vendor/`, fichiers tiers servis tels que publiés) :

| Commande | Résultat |
|---|---|
| bruit de commentaires (`Step`, `Initialize`, `Loop through`, `Return the`…) | 0 |
| bannières (`// ----------`) | 0 |
| « simplified implementation », « for demo purposes »… | 0 |
| emoji | 1 : le 🤖 que la vérification d'identité de la CI refuse dans les messages de commit (`.github/workflows/verification.yml`) |
| caractères invisibles et diacritiques isolés | 0 |
| fonctions `process`/`handle`/`manage`/`perform`/`execute`/`do…` | 0 |
| suffixes Manager/Service/Handler/Provider/Factory/Helper/Util/Wrapper/Processor/Engine | 0 |
| fichiers `utils`/`helpers`/`common`/`misc`/`shared` | 0 |
| affectations `data`/`result`/`output`/`temp`/`tmp`/`res`/`ret`/`val`/`obj`/`item` | 3 : `res` paramètre de rappel d'une réponse HTTP (`src/logos.js`), `res` d'une fausse réponse HTTP et `tmp` du dossier temporaire (`test/sesame.test.js`) |
| `catch (e)`, `catch {`, `.catch(` | 36, justifiés ci-dessus |
| « An error occurred », « Something went wrong », « Unexpected error » | 0 |
| essais vides (`assert.ok(true)`, `toBeDefined()`) | 0 |
| `your_api_key`, `xxx`, `changeme`, `<your`, `TODO`, `FIXME`, `placeholder`, `lorem` | 6 : attributs HTML `placeholder` des champs de l'interface |
| imports inutilisés (liaisons importées relues fichier par fichier) | 0 |
| exports sans lecteur | 0 |
| fichiers que rien ne référence | 0 |
| `npx depcheck` | sans objet : aucune dépendance |

## Verification (chapter 49)
- [x] Full suite passes and matches the baseline — 18 essais de SÉSAME et 63 du socle avant le passage ; 20 et 63 aujourd'hui, tous verts, aux paramètres de production d'Argon2id
- [x] Public API diff empty — routes, schémas, formats de bloc et liaisons importées de `web/crypto.js` inchangés par le passage ; contrat épinglé par les essais d'API et le parcours Chromium (112 écrans × largeurs, 0 défaut, 0 erreur)
- [x] Characterisation tests deleted after use — aucun essai temporaire ; l'essai croisé Argon2id / Node reste, volontairement
- [x] Read-aloud test passed — `web/app.js`, `web/crypto.js`, `src/api.js` relus de bout en bout ; ce qui n'avait pas de réponse à « pourquoi est-ce là ? » est corrigé plus haut
- [x] Blind-comparison test passed — mêmes aides, même forme de routes, même vocabulaire que VIGIE et Oracle sur le même socle
- [x] Commit history: one concern per commit, repository style, no attribution trailers
- [x] REQ-CODE-001 to REQ-CODE-006 all PASS
