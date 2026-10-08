# Security compliance — CODVAULT

Standard: Project Baseline Requirements & Security Manual, Edition 2.0 (258 controls)
Audited: 2026-10-08   ·   Owner: Codex64   ·   Status: NON-COMPLIANT

## Summary
| Part | Controls | Pass | Fail | N/A | Unknown |
|---|---|---|---|---|---|
| I — Baseline requirements | 68 | 56 | 11 | 1 | 0 |
| II — Security controls | 190 | 103 | 22 | 65 | 0 |
| Total | 258 | 159 | 33 | 66 | 0 |

Les 33 contrôles en échec attendent tous une action que seul l’exploitant peut faire (HTTPS de publication, relais SMTP, réglages GitHub, liste d’anonymat sur son poste, disques, sauvegardes, hôtes, domaine, crible de l’image) : voir « Human actions required ». Aucun n’attend une modification du code.

## Authentication posture
Deux étages. Le compte, d’abord, tenu par le socle commun : mot de passe (Argon2id 64 Mio, 3 passes, 4 voies, plancher 19 Mio / 2 / 1, rehachage transparent, liste de fuites locale, 12 à 1024 caractères), application TOTP (RFC 6238, secret scellé AES-256-GCM, rejeu refusé), clés d’accès WebAuthn (vérification de l’utilisateur exigée, jusqu’à vingt, nommées, révocables) et dix codes de secours de 100 bits hachés, cumulables. Clé requise pour les administrateurs, qui tiennent deux facteurs dont une clé. Les comptes se créent depuis le Hub (jeton d’administration délégué), jamais par une page ouverte. Sessions serveur (256 bits, empreinte seule en base), renouvelées à chaque changement de niveau, 12 heures au plus, 60 minutes d’inactivité, listées et révocables. Renfort de cinq minutes avec le facteur le plus fort avant tout changement de facteur, de rôle, une suppression, un export, et dans CODVAULT avant de changer de mot de passe maître, de renouveler la clé du coffre, de lire ou refaire la clé de récupération, de relier un appareil. Limiteur persistant par adresse et par compte, preuve de travail après trois échecs.
Le coffre, ensuite, qui ne s’ouvre que dans le navigateur : mot de passe maître étiré par Argon2id (64 Mio, 3 passes, 4 voies, sel de 16 octets ; plancher 19 Mio / 2 / 1 imposé par le serveur), HKDF, puis AES-256-GCM sur une clé de coffre de 256 bits ; une clé de récupération de 256 bits enveloppe la même clé. Une enveloppe plus faible que la cible est réenveloppée au déverrouillage suivant. Le coffre se referme seul après inactivité (10 minutes par défaut) ; ses clés ne vivent qu’en mémoire, non exportables. Après une fuite possible, la clé du coffre se renouvelle : chaque élément rechiffré sous une clé neuve, partages réenveloppés, nouvelle clé de récupération, d’un seul bloc ; les autres sessions et les appareils du compte tombent.
L’extension de navigateur, enfin : reliée par un code montré une fois (jeton de 256 bits, empreinte seule en base, lecture du chiffré seule, 30 jours d’inactivité et 180 jours au plus, retiré avec les sessions du compte), elle ouvre le coffre chez elle avec le mot de passe maître et Argon2id, garde la clé du coffre en mémoire de session le temps choisi (5 minutes par défaut), et ne remplit que sur un clic ou un raccourci, dans le cadre principal d’une page HTTPS dont elle revérifie le site au moment de remplir.

## Control status
| ID | Severity | Status | Evidence | Notes |
|---|---|---|---|---|
| REQ-AUTH-001 | CRITICAL | PASS | `socle/src/comptes.js:24` ; mot de passe, TOTP, clés et codes de secours cumulables : essai `socle/test/parcours.test.js:54` | socle 25b09a6 embarqué tel quel (`sha256sum --check --strict socle/EMPREINTES` → 64 fichiers OK) et vérifié par ses 63 essais |
| REQ-AUTH-002 | CRITICAL | PASS | `socle/src/comptes.js:27` ; `socle/src/index.js:49` ; réglable sans déploiement : `socle/src/portail.js:463` | défaut : mot de passe et TOTP facultatifs, clé requise pour les administrateurs |
| REQ-AUTH-003 | CRITICAL | PASS | `socle/src/webauthn.js:26` ; vingt clés nommées : `socle/src/comptes.js:35` ; renommer et retirer : `socle/src/portail.js:302` | liste avec dates de création et d’usage dans la page Sécurité |
| REQ-AUTH-004 | CRITICAL | PASS | `socle/src/webauthn.js:46` ; origine `socle/src/webauthn.js:47` ; rpIdHash `socle/src/webauthn.js:103` | défi à usage unique lié à la session, UP et UV exigés, signature et compteur vérifiés |
| REQ-AUTH-005 | CRITICAL | PASS | `socle/src/comptes.js:622` ; renfort et fermeture des autres sessions : `socle/src/comptes.js:659` | la notification part à l’adresse vérifiée quand un relais existe (voir REQ-AUTH-014) |
| REQ-AUTH-006 | CRITICAL | PASS | `socle/src/comptes.js:809` ; jeton de 20 minutes, haché, unique : `socle/src/comptes.js:33` | essai `socle/test/parcours.test.js:242` |
| REQ-AUTH-007 | HIGH | PASS | `socle/src/comptes.js:36` ; 100 bits, haché Argon2id, usage unique : `socle/src/comptes.js:443` | alerte « secours.utilise » (courriel si relais, voir REQ-AUTH-014) |
| REQ-AUTH-008 | HIGH | PASS | `socle/src/totp.js:35` ; rejeu refusé (totp_pas) : `socle/src/comptes.js:413` | RFC 6238, 6 chiffres, 30 s, ±1 pas, secret scellé AES-256-GCM |
| REQ-AUTH-009 | CRITICAL | PASS | aucune voie SMS ni code par courriel : `grep -rniE "sms\|twilio" socle/src src web/app.js web/crypto.js` → 0 ligne ; connexions possibles : `socle/src/comptes.js:376`, `socle/src/comptes.js:402`, `socle/src/comptes.js:424`, `socle/src/comptes.js:489` | un mot de passe seul n’ouvre qu’une session d’inscription ; les codes A2F que CODVAULT calcule sont ceux des sites de l’utilisateur, pas un facteur de CODVAULT |
| REQ-AUTH-010 | CRITICAL | PASS | `socle/src/limiteur.js:20` (SQLite, par adresse et par compte, paliers de verrou, preuve de travail) ; appliqué à mot de passe, TOTP, secours, clé, jetons, adresse d’alerte, et aux jetons d’appareil de CODVAULT `src/api.js:342` | essai `socle/test/parcours.test.js:180` ; jetons d’appareil essayés en série : adresse bloquée (429), même avec le bon jeton ensuite, essai `test/codvault.test.js:386` ; trente connexions fausses sur la vitrine : `401 401 401` puis `428` (preuve de travail exigée) jusqu’à la trentième |
| REQ-AUTH-011 | HIGH | PASS | vérification leurre : `socle/src/argon.js:110` ; message unique | essai `socle/test/parcours.test.js:81` |
| REQ-AUTH-012 | HIGH | PASS | `socle/src/comptes.js:941` : l’adresse n’existe que dans le jeton haché tant qu’elle n’est pas vérifiée ; `socle/src/comptes.js:950` | l’adresse ne sert qu’aux alertes : ni identifiant, ni récupération, ni droit ; pas d’inscription libre (invitation seulement) |
| REQ-AUTH-013 | HIGH | PASS | `socle/src/comptes.js:731` | en mode HTTP dégradé la clé est impossible : la règle retombe sur deux facteurs, affiché en permanence (voir REQ-WEB-001) |
| REQ-AUTH-014 | MEDIUM | FAIL | `socle/src/notifications.js:43` ; « ce n’était pas moi » : `socle/src/comptes.js:928` | implémenté et essayé (`socle/test/courriel.test.js:63`) ; ne part que si un relais SMTP est configuré → action H2 |
| REQ-CRYPT-001 | CRITICAL | PASS | comptes : `socle/src/argon.js:61`, 64 Mio, t=3, p=4 : `socle/src/index.js:42` ; mot de passe maître : Argon2id 64 Mio, t=3, p=4 dans le navigateur `web/crypto.js:27`, plancher 19 Mio, t=2, p=1 tenu par le navigateur `web/crypto.js:31` et par le serveur `src/api.js:30` | Argon2id du navigateur : @noble/hashes 2.4.0 servi tel que publié (`web/vendor/PROVENANCE`), identique à `crypto.argon2` de Node aux paramètres de production : essai `test/codvault.test.js:105` ; sel de 16 octets par enveloppe ; aucun SOCLE_ARGON_* ni paramètre abaissé dans les essais (`grep -c ARGON test/*.js` → 0) |
| REQ-CRYPT-002 | HIGH | PASS | comptes : `socle/src/argon.js:72`, écrit dans la même requête `socle/src/argon.js:135` ; coffre : enveloppe sous la cible réenveloppée au déverrouillage `web/crypto.js:189`, envoyée aussitôt `web/app.js:153`, route qui ne fait que monter `src/api.js:123` | paramètres gardés avec chaque enveloppe ; essai `test/codvault.test.js:260` |
| REQ-CRYPT-003 | MEDIUM | N/A | bcrypt absent : `grep -rniE "bcrypt" socle/src src` → 0 ligne ; Argon2id seul |  |
| REQ-CRYPT-004 | HIGH | PASS | mot de passe des comptes : `socle/src/motdepasse.js:12`, `socle/src/motdepasse.js:13`, liste de fuites locale `socle/src/motdepasse.js:18` | le mot de passe maître ne parvient jamais au serveur (connaissance nulle) : sa règle — douze caractères, ni faible ni courant — est tenue dans le navigateur `web/app.js:109` ; un client modifié n’affaiblirait que son propre coffre, Argon2id restant imposé par le serveur |
| REQ-CRYPT-005 | HIGH | PASS | `socle/src/outils.js:16` ; comparaisons `socle/src/outils.js:23` ; navigateur : `web/crypto.js:53`, générateur sans biais de modulo `web/crypto.js:368` ; `grep -rnE "Math.random\|uuidv1" src web/app.js web/crypto.js socle/src socle/web` → 0 ligne | clés de coffre, d’élément et de récupération de 256 bits ; IV de 96 bits par bloc ; identifiants d’élément de 128 bits ; jetons d’appareil de 256 bits `src/appareils.js:40`, gardés hachés `src/appareils.js:20` |
| REQ-CRYPT-006 | MEDIUM | PASS | sessions : `socle/src/comptes.js:276` ; jetons : `socle/src/comptes.js:873` ; secours : `socle/src/comptes.js:443` | essai `socle/test/courriel.test.js:108` |
| REQ-SESS-001 | CRITICAL | PASS | `socle/src/http.js:105` ; __Host- en HTTPS : `socle/src/portail.js:50` | aucune session dans le stockage du navigateur ; la clé du coffre déverrouillé ne vit qu’en mémoire, non exportable, effacée au verrouillage `web/app.js:190` ; extension : jeton d’appareil (lecture du chiffré seule) dans son stockage, clé du coffre ouvert seulement dans la mémoire de session du navigateur, le temps choisi (5 min par défaut, « à chaque ouverture » possible), effacée à l’échéance, au verrouillage de l’écran et à la fermeture du navigateur `extension/coeur.js:66` |
| REQ-SESS-002 | CRITICAL | PASS | `socle/src/comptes.js:269` à la connexion, au renfort et à chaque changement de facteur ou de rôle | pas de jeton de rafraîchissement : sessions serveur |
| REQ-SESS-003 | HIGH | PASS | `socle/src/comptes.js:322` ; révocation : `socle/src/portail.js:310` et incident : `socle/src/portail.js:475` | appareil, adresse IP, première et dernière vue |
| REQ-SESS-004 | HIGH | PASS | `socle/src/comptes.js:333` ; déconnexion serveur : `socle/src/portail.js:267` |  |
| REQ-SESS-005 | HIGH | PASS | `socle/src/comptes.js:338` ; facteur le plus fort : `socle/src/comptes.js:672` | facteurs, adresse d’alerte, rôles, suppression, politique, export ; dans CODVAULT, changer de mot de passe maître `src/api.js:113`, renouveler la clé du coffre `src/api.js:139`, lire `src/api.js:177` ou refaire `src/api.js:183` la clé de récupération, relier un appareil `src/api.js:320` |
| REQ-SESS-006 | MEDIUM | PASS | 12 h absolues, 60 min d’inactivité : `socle/src/index.js:40` | pas de JWT |
| REQ-ANON-001 | CRITICAL | PASS | `git log --format="%an <%ae>%n%cn <%ce>" | sort -u` → une ligne, le pseudonyme du projet sur GitHub | identité posée dans le dépôt avant le premier commit ; orthographe du pseudonyme : voir « Human actions required » |
| REQ-ANON-002 | CRITICAL | PASS | commande « personal infrastructure » de l’annexe B.1 sur l’arbre, hors ce fichier qui la cite (`git grep … -- ':!SECURITY.md'`) → 6 lignes, aucune personnelle : le motif `.local` dans `.gitignore` (`.env.local`), les plages RFC 1918 et réservées que la garde des logos refuse (`src/logos.js:27`, `src/logos.js:28`), deux adresses d’essai de cette garde (`test/codvault.test.js:29` et la liste d’adresses refusées), « §10.1.1 » dans un commentaire de @noble/hashes ; `git log --all -p -- . ':!SECURITY.md' | grep -niE 'homelab|nas|proxmox|synology|unraid|truenas|tailscale|wireguard'` → 5 lignes, toutes le mot « cadenas » (nom d’un pictogramme) | historique complet balayé, lignes ajoutées et métadonnées, avec la liste de session : voir le rapport d’anonymat hors dépôt |
| REQ-ANON-003 | CRITICAL | FAIL | liste et crochet global à poser sur le poste qui commite | action H4 |
| REQ-ANON-004 | CRITICAL | PASS | `git log --format=%B | grep -inE "co-authored-by|generated (by|with)|assistant|as an ai|claude|copilot|cursor|gpt|🤖"` → 0 ligne | contrôlé en CI : `.github/workflows/verification.yml:60` |
| REQ-ANON-005 | HIGH | PASS | `package.json` sans champ auteur ; `LICENSE:3` (Codex64) | le README décrit le projet, jamais une machine ni une personne ; contact : le signalement privé du dépôt |
| REQ-ANON-006 | HIGH | PASS | `git ls-files '*.png' '*.jpg' '*.pdf' '*.mp4'` → 4 fichiers, les icônes de l’extension, dessinées par `outils/extension.mjs:25` et écrites par l’encodeur de CODVAULT (blocs IHDR, IDAT, IEND seulement : `grep -c 'tEXt\|iTXt\|eXIf' extension/icones/*.png` → 0) ; autres binaires : 17 polices WOFF2 (blocs de métadonnées XML et privé de longueur 0) et `socle/data/mots-de-passe-courants.txt.gz` (en-tête gzip sans nom de fichier, date 0) | captures du parcours navigateur jamais commitées |
| REQ-ANON-007 | HIGH | PASS | comptes « ana », « leo », « lea », « max », « zoe », « tom », « rot », sites « site.test », « evil.test », adresses et sites d’exemple, mots de passe fabriqués ; réseau des logos simulé `test/codvault.test.js:28` | l’adresse « publique » des essais de logos est celle d’example.com (IANA) : les plages de documentation sont justement refusées par la garde ; aucun domaine d’essai n’est contacté (résolution et requête remplacées, vitrine en CODVAULT_LOGOS=non) |
| REQ-ANON-008 | MEDIUM | PASS | `git log --format='%aI%n%cI' | grep -v '+00:00$'` → 0 ligne | dépôt créé dans cette session, tous les commits en UTC |
| REQ-ANON-009 | MEDIUM | FAIL | pages d’erreur sans chemin : `socle/src/http.js:159` ; domaine et WHOIS hors dépôt | action H10 |
| REQ-ANON-010 | MEDIUM | PASS | identité stable et unique, dates réelles (TZ=UTC, jamais antidatées) | aucune politique de contribution externe (dépôt personnel) |
| REQ-CFG-001 | CRITICAL | PASS | `git grep -nIiE "(api[_-]?key|secret|token|password|bearer)\s*[=:]\s*[\"'][^\"']{8,}"` → 1 ligne, le vecteur public de la RFC 6238 (`socle/test/crypto.test.js:106`) ; detect-secrets → 13 résultats : alphabets (Base32, Crockford, jeux du générateur, suites de clavier), le même vecteur RFC, trois empreintes de rendu QR et les deux empreintes publiques de la SBOM (paquet npm, image de base) | gitleaks en CI : `.github/workflows/verification.yml:48` |
| REQ-CFG-002 | CRITICAL | PASS | secrets du serveur (SOCLE_CLE, jeton d’administration du Hub) lus côté serveur seulement : `socle/src/config.js:14` ; `grep -n "SOCLE_" web/app.js web/crypto.js` → 0 ligne | les seules clés présentes dans le navigateur sont celles du coffre de la personne, en mémoire, non exportables : c’est le principe de la connaissance nulle |
| REQ-CFG-003 | HIGH | PASS | secrets tirés par le Hub à chaque installation : SOCLE_CLE `hub.json:102`, jeton d’administration des comptes `hub.json:75` ; VM d’essai et production distinctes (règle de l’exploitant) | aucune clé de fournisseur tiers ; le jeton d’administration ne vaut que pour les comptes de CODVAULT (délégation du socle), jamais pour les coffres |
| REQ-CFG-004 | HIGH | PASS | `socle/src/config.js:14` ; ensemble : `socle/src/index.js:90` ; réglages de CODVAULT validés au démarrage `src/config.js:10` | essai `test/codvault.test.js:373` |
| REQ-CFG-005 | HIGH | PASS | inventaire, émetteur et procédure par secret ci-dessous (« Secrets inventory ») ; SOCLE_CLE se tourne sans réinscription : `socle/src/comptes.js:112` ; exercice de bout en bout : `node outils/exercice-rotation.mjs | grep -c "^OK "` → 12 sur 12 (instance lancée comme en production, TOTP, clé d’accès et code de secours toujours valables, clé inconnue refusée) | essai du socle `socle/test/rotation.test.js:14` ; aucune clé n’a été vue pendant le développement : rien à brûler |
| REQ-CI-001 | CRITICAL | FAIL | `.github/workflows/verification.yml:48` | Actions coupées par la facturation, crochet local et protection de poussée à activer : actions H3, H4 |
| REQ-CI-002 | HIGH | FAIL | `.github/workflows/verification.yml:109` | bloquant une fois les Actions rétablies et le contrôle requis : action H3 |
| REQ-CI-003 | HIGH | FAIL | aucune dépendance npm, vérifié en CI `.github/workflows/verification.yml:38` ; bibliothèque vendorisée épinglée par empreinte (`web/vendor/PROVENANCE`) ; SBOM `sbom.cdx.json` tenue alignée par l’essai `test/fournitures.test.js` | contrôles requis sur la branche et veille des avis de @noble/hashes à activer : action H3 |
| REQ-CI-004 | HIGH | FAIL | `.github/workflows/verification.yml:85` | échoue tant que le secret n’existe pas : action H4 |
| REQ-CI-005 | MEDIUM | FAIL | permissions minimales `.github/workflows/verification.yml:15` ; actions épinglées par commit | protection de branche : action H3 |
| REQ-CI-006 | MEDIUM | PASS | essais `test/codvault.test.js:313`, `test/codvault.test.js:176`, `test/codvault.test.js:205`, `test/codvault.test.js:386` et `test/codvault.test.js:470` | chaque route sans session (401), chaque écriture en lecture seule (403), l’élément d’un autre membre introuvable (404), droits de partage tenus par le serveur, jeton d’appareil limité à ses deux routes, renouvellement refusé sur le coffre d’un autre |
| REQ-WEB-001 | CRITICAL | FAIL | HSTS dès que la requête est chiffrée : `socle/src/http.js:88` | CODVAULT ne s’ouvre qu’en contexte sûr et le dit en HTTP `web/app.js:34` ; mise en ligne en HTTPS : action H1 |
| REQ-WEB-002 | HIGH | PASS | `socle/src/http.js:62` ; `curl -sI /` → `default-src 'self'; script-src 'self' 'nonce-…'; style-src 'self'; img-src 'self' data:; … object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'` | aucune origine externe ; parcours Chromium : 154 écrans × largeurs, 0 défaut, 0 erreur console ; extension : `default-src 'none'`, `script-src 'self'`, `frame-ancestors 'none'` (`extension/manifest.json`), vérifié par l’essai `test/extension.test.js` |
| REQ-WEB-003 | HIGH | PASS | `socle/src/http.js:79` ; no-store : `socle/src/http.js:150`, et sur chaque réponse de l’API `src/api.js:388` | `curl -sI /` : ni Server ni X-Powered-By ; Permissions-Policy, COOP, CORP, Referrer-Policy no-referrer |
| REQ-WEB-004 | HIGH | PASS | aucun en-tête CORS émis : `curl -sI -H 'Origin: https://evil.example' /api/coffre` → aucun Access-Control-* | API de même origine ; l’extension joint son serveur par la permission d’hôte accordée pour ce seul serveur, sans CORS, et les routes de l’appareil ne lisent aucun cookie |
| REQ-WEB-005 | HIGH | PASS | CSRF : `socle/src/portail.js:84` ; JSON exigé : `socle/src/http.js:120` ; la seule adresse appelée à partir d’une saisie (le logo d’un site) : HTTPS seulement `src/logos.js:87`, chaque IP résolue contrôlée `src/logos.js:43` puis épinglée `src/logos.js:100`, redirections recontrôlées `src/logos.js:115` | essai `test/codvault.test.js:281` : adresses privées, réservées, NAT64, 6to4, redirection vers l’interne refusées ; aucune redirection pilotée par paramètre |
| REQ-WEB-006 | CRITICAL | PASS | schéma strict sur chaque corps `src/api.js:38`, paramètres de chemin `src/api.js:375`, chaînes de requête refusées `src/api.js:385` ; propriété : `src/api.js:254`, `src/api.js:267` | un bloc qui ne ressemble pas à du chiffré est refusé : le serveur n’accepte aucun clair. Erreurs génériques : `socle/src/http.js:159` |
| REQ-WEB-007 | HIGH | PASS | requêtes préparées partout ; `grep -rnE "innerHTML|outerHTML|insertAdjacentHTML|document.write" src web/app.js web/crypto.js extension/*.js` → 0 ligne ; `grep -rnE "child_process|execSync|eval\(|new Function" src web/app.js web/crypto.js extension/*.js` → 0 ligne | le gabarit du socle (`socle/web/gabarit.js`), seul usage d’innerHTML, n’est pas importé par CODVAULT |
| REQ-WEB-008 | MEDIUM | PASS | toutes les requêtes : 900 par minute et par adresse `src/main.js:27` ; corps bornés par route (`socle/src/http.js:126`) ; plafonds par coffre en nombre et en octets `src/api.js:219` ; logos : 300 récupérations par heure `src/logos.js:24` | essai `test/codvault.test.js:351` |
| REQ-DATA-001 | CRITICAL | PASS | SQLite embarqué, aucun port `src/base.js:18` ; dossier en 0700 `src/base.js:13`, fichiers en 0600 `src/base.js:16` | PRAGMA secure_delete : un élément supprimé ne reste pas dans les pages libres |
| REQ-DATA-002 | HIGH | FAIL | coffres chiffrés dans le navigateur (AES-256-GCM) : la base ne contient aucun clair ; secrets TOTP scellés : `socle/src/chiffre.js:60` | HTTPS (action H1) et chiffrement du disque des hôtes pour les données de comptes et le journal (action H5) |
| REQ-DATA-003 | HIGH | FAIL | aucune sauvegarde automatisée du volume à ce jour | sauvegardes chiffrées hors hôte et restauration datée : action H6 ; une sauvegarde de la base ne livre aucun mot de passe sans les mots de passe maîtres |
| REQ-DATA-004 | HIGH | PASS | `socle/src/journal.js:10` ; chaque écriture du coffre journalisée `src/api.js:79` : acteur, action, identifiant d’élément, adresse, jamais de contenu ; domaines des logos jamais journalisés `src/logos.js:149` | refus : `socle/src/portail.js:105` ; limites : `socle/src/limiteur.js:48` ; essai `socle/test/surveillance.test.js:33` ; appareils reliés, retirés, refusés `src/api.js:348`, clé renouvelée `src/api.js:172` |
| REQ-DATA-005 | MEDIUM | PASS | vigie : `socle/src/vigie.js:11` ; runbook ci-dessous ; révocation globale : `socle/src/portail.js:475` | exercice du runbook à dater : action H6 |
| REQ-DATA-006 | MEDIUM | PASS | `web/confidentialite.txt` : ce qui est gardé, ce que le serveur voit malgré le chiffrement ; effacement `src/base.js:43` ; export `src/api.js:369` | le serveur ne garde du coffre que du chiffré ; les exports ne prennent que ses propres éléments ; appareils reliés effacés avec le compte |
| REQ-DATA-007 | MEDIUM | PASS | aucun fichier déposé sur le serveur (import lu dans le navigateur) ; tout bloc reçu validé à sa forme `src/api.js:25` ; les icônes venues des sites, hostiles par défaut : décodées et réencodées en PNG de 64 px `src/image.js:187`, servies en pièce jointe sous CSP sandbox `src/api.js:308` | essais `test/image.test.js` (bombe de compression, dimensions géantes, SVG, HTML) ; import d’un export ramené à la forme de CODVAULT `web/crypto.js:359` |
| REQ-CODE-001 | HIGH | PASS | essais de référence avant le passage Part III de la 2.0.0 : 30/30 ; API publique inchangée par ce passage (routes, schémas, formats de bloc) | voir NO-VIBE.md |
| REQ-CODE-002 | HIGH | PASS | voir NO-VIBE.md, couche des commentaires |  |
| REQ-CODE-003 | HIGH | PASS | voir NO-VIBE.md, couches structurelle et défensive |  |
| REQ-CODE-004 | HIGH | PASS | voir NO-VIBE.md, profil de style du dépôt |  |
| REQ-CODE-005 | MEDIUM | PASS | cassures volontaires, chacune détectée par un essai : NO-VIBE.md, « Tests » |  |
| REQ-CODE-006 | MEDIUM | PASS | `git log --stat` : un sujet par commit, messages courts en français comme dans les autres dépôts du projet |  |
| GOV-001 | HIGH | PASS | ce document : revue datée, périmètre (258 contrôles), résolution ligne par ligne | à refaire à chaque changement généré important |
| GOV-002 | MEDIUM | PASS | section « Inventory » ci-dessous : routes, données, tiers, secrets |  |
| GOV-003 | LOW | PASS | `socle/src/portail.js:144` (security.txt) ; contact : `src/main.js:18` ; signalement privé activé sur le dépôt par la commande de publication du 2026-10-08 (`gh api -X PUT repos/<dépôt>/private-vulnerability-reporting`), sortie relevée : « Signalement prive active » | réglage conservé par le renommage du dépôt ; à revérifier : `gh api repos/<dépôt>/private-vulnerability-reporting` → `{"enabled":true}` |
| GOV-004 | MEDIUM | PASS | VM d’essai distincte de la production (règle de l’exploitant) ; secrets tirés par installation (voir REQ-CFG-003) ; données d’essai fabriquées (voir REQ-ANON-007) | aucun compte tiers à séparer |
| GOV-005 | HIGH | FAIL | jeton de CI en lecture seule `.github/workflows/verification.yml:15` | 2FA sur le compte GitHub : action H3 |
| SEC-SECRETS-001 | CRITICAL | PASS | `git grep` de REQ-CFG-001 → aucune valeur ; detect-secrets → alphabets, vecteur public, empreintes de rendu et empreintes publiques de la SBOM seulement | historique complet : dépôt neuf, balayé ; gitleaks en CI (H3) |
| SEC-SECRETS-002 | CRITICAL | PASS | aucune construction : l’interface est servie telle quelle, seul un nonce est posé `web/index.html:12` | rien de secret n’est injecté dans le code servi |
| SEC-SECRETS-003 | CRITICAL | PASS | `.gitignore:8` ; seuls `web/` et `socle/web/` sont servis : `/.env`, `/.git/config`, `/../package.json`, `/socle/../src/api.js` → 404 sur la vitrine | `.env.example` sans valeur |
| SEC-SECRETS-004 | HIGH | PASS | secrets posés par le Hub depuis son coffre `deploy/compose.hub.yml:33` ; fichiers acceptés : `socle/src/config.js:5` | jamais sur le volume ni dans la CI |
| SEC-SECRETS-005 | HIGH | PASS | aucune clé de fournisseur ; le jeton d’administration ne gère que les comptes de CODVAULT, SOCLE_CLE ne scelle que les secrets TOTP | un secret par installation, donc par environnement |
| SEC-SECRETS-006 | HIGH | PASS | procédure de rotation par secret ci-dessous, sans interruption autre qu’un redémarrage : `socle/src/comptes.js:112` ; exercée : `outils/exercice-rotation.mjs` (12/12) | aucune clé n’a fuité ni été vue pendant le développement |
| SEC-SECRETS-007 | HIGH | PASS | clé maîtresse 32 octets aléatoires : `socle/src/chiffre.js:40` ; valeurs d’exemple refusées : `socle/src/config.js:54` | aucun repli de secret par défaut |
| SEC-SECRETS-008 | MEDIUM | PASS | `socle/src/config.js:14` ; mode dégradé affiché en permanence : `socle/web/compte.js:586` | aucun mode débogage, aucun compte de démonstration |
| SEC-AUTH-001 | CRITICAL | PASS | voir REQ-CRYPT-001 |  |
| SEC-AUTH-002 | MEDIUM | PASS | voir REQ-CRYPT-004 |  |
| SEC-AUTH-003 | CRITICAL | PASS | voir REQ-AUTH-010 |  |
| SEC-AUTH-004 | MEDIUM | PASS | voir REQ-AUTH-011 |  |
| SEC-AUTH-005 | CRITICAL | PASS | voir REQ-AUTH-006 ; lien depuis l’adresse publique : `socle/src/portail.js:55` | sans adresse publique, l’origine attestée par le navigateur de l’administrateur, contrôlée sur la même requête |
| SEC-AUTH-006 | MEDIUM | PASS | confirmation sur la nouvelle adresse et avis à l’ancienne : `socle/src/comptes.js:950` | essai `socle/test/courriel.test.js:122` |
| SEC-AUTH-007 | HIGH | PASS | TOTP et clés pour tous, second facteur imposé aux administrateurs : `socle/src/comptes.js:207` | codes de secours toujours émis |
| SEC-AUTH-008 | HIGH | N/A | aucune connexion par fournisseur externe : `grep -rniE "oauth\|openid\|id_token\|redirect_uri" socle/src src web/app.js` → 0 ligne |  |
| SEC-AUTH-009 | HIGH | PASS | les liens reçus par courriel demandent un geste : `socle/web/compte.js:337` ; uniques et courts : `socle/src/comptes.js:34` | aucune connexion sans mot de passe par courriel |
| SEC-AUTH-010 | CRITICAL | PASS | `socle/src/portail.js:111`, appelé par chaque route `src/api.js:77` ; routes de l’appareil : jeton exigé, compte actif vérifié à chaque requête `src/api.js:339` | essais `test/codvault.test.js:313`, `test/codvault.test.js:386` |
| SEC-AUTH-011 | HIGH | PASS | `socle/src/http.js:159` ; session illisible = pas de session : `socle/src/comptes.js:291` | aucun chemin d’exception n’ouvre l’accès |
| SEC-SESS-001 | CRITICAL | PASS | voir REQ-SESS-001 |  |
| SEC-SESS-002 | HIGH | PASS | `grep -rn "localStorage\|sessionStorage" web/app.js web/crypto.js socle/web/*.js extension/*.js` → 2 lignes, le thème clair ou sombre (`socle/web/compte.js:285`, `socle/web/compte.js:299`) | ni jeton, ni clé, ni élément dans le stockage des pages ; l’extension range son jeton d’appareil dans son propre stockage, hors d’atteinte des sites (aucun script de contenu, aucune ressource exposée), et la clé du coffre ouvert en mémoire de session seulement (REQ-SESS-001) |
| SEC-SESS-003 | HIGH | PASS | 256 bits : `socle/src/comptes.js:271` | renouvelé à chaque changement de niveau |
| SEC-SESS-004 | HIGH | PASS | voir REQ-SESS-003, REQ-SESS-004 et REQ-SESS-006 |  |
| SEC-SESS-005 | CRITICAL | N/A | aucun JWT : `grep -rniE "jwt\|jsonwebtoken\|jose" src web socle` → 0 ligne |  |
| SEC-SESS-006 | MEDIUM | N/A | aucun jeton de rafraîchissement : sessions serveur (voir SEC-SESS-005) |  |
| SEC-SESS-007 | MEDIUM | PASS | voir REQ-SESS-005 ; avis par courriel via le canal d’alerte | courriel : H2 |
| SEC-AUTHZ-001 | CRITICAL | PASS | routes de l’appareil limitées au compte qui l’a relié `src/api.js:358`, appareil retiré par son seul propriétaire `src/api.js:332` ; propriétaire ou destinataire vérifié sur chaque élément : `src/api.js:254`, `src/api.js:267`, `src/api.js:282`, `src/api.js:295` ; listes filtrées par le compte de la session `src/api.js:208` | essais `test/codvault.test.js:313` et `test/codvault.test.js:205` |
| SEC-AUTHZ-002 | CRITICAL | PASS | rôle membre pour écrire et partager `src/api.js:226` ; rôle lu en base : `socle/src/portail.js:111` | lecture seule : son coffre et ce qu’on lui partage |
| SEC-AUTHZ-003 | HIGH | PASS | schémas stricts, champs inconnus refusés : `socle/src/schema.js:69` ; propriétaire posé par le serveur `src/api.js:216` | essai `test/codvault.test.js:313` : un champ « proprietaire » ajouté → 400 |
| SEC-AUTHZ-004 | HIGH | PASS | route inconnue → 404 `src/api.js:382` ; seule route publique de CODVAULT `src/api.js:93`, plus l’état du portail | essai `test/codvault.test.js:313` : /api/debug, /api/seed, /api/v1/elements, /graphql → 404 |
| SEC-AUTHZ-005 | CRITICAL | N/A | ni organisation, ni équipe, ni espace de travail côté serveur : un élément appartient à un compte et se partage élément par élément (SEC-AUTHZ-001) ; les « espaces » sont des étiquettes chiffrées dans l’élément, inconnues du serveur : `grep -c espace src/*.js` → 0 |  |
| SEC-AUTHZ-006 | LOW | PASS | identifiants d’élément de 128 bits tirés au hasard `web/crypto.js:294`, contrôlés par le serveur `src/api.js:20` ; un identifiant déjà pris est refusé, jamais écrasé `src/api.js:230` | aucun entier séquentiel exposé |
| SEC-AUTHZ-007 | HIGH | PASS | versions : deux écritures concurrentes, la seconde refusée `src/api.js:259` ; renouvellement de la clé tout ou rien, refusé si un élément, une version ou un destinataire a changé `src/api.js:138` ; un partage en écriture ne supprime ni ne repartage `src/api.js:255` ; import tout ou rien `src/api.js:246` ; dérivation qui ne fait que monter `src/api.js:128` | essais `test/codvault.test.js:176`, `test/codvault.test.js:260`, `test/codvault.test.js:351`, `test/codvault.test.js:470` |
| SEC-AUTHZ-008 | MEDIUM | PASS | aucune fonction cachée côté client : chaque bouton appelle une route contrôlée côté serveur (balayage des rôles) |  |
| SEC-INJ-001 | CRITICAL | PASS | requêtes préparées partout ; `grep -n "prepare(\`" src/*.js` → 0 ligne | aucune valeur de requête dans le texte SQL |
| SEC-INJ-002 | HIGH | N/A | aucun ORM : node:sqlite, requêtes préparées seulement |  |
| SEC-INJ-003 | HIGH | N/A | aucune base documentaire : SQLite seulement |  |
| SEC-INJ-004 | CRITICAL | N/A | aucun processus lancé : `grep -rn "child_process\|spawn(" src socle/src` → 0 ligne |  |
| SEC-INJ-005 | HIGH | PASS | `socle/src/http.js:182` | aucun nom de fichier fourni par l’utilisateur n’est ouvert |
| SEC-INJ-006 | HIGH | N/A | aucun moteur de gabarit : `grep -rniwE "handlebars\|ejs\|nunjucks\|mustache" src socle/src` → 0 ligne ; `grep -rnE "new Function\|node:vm" src socle/src` → 0 ligne |  |
| SEC-INJ-007 | HIGH | N/A | aucun analyseur XML côté serveur : `grep -rniE "xml2js\|sax\|libxml\|fast-xml" src socle/src` → 0 ligne |  |
| SEC-INJ-008 | HIGH | PASS | JSON seulement ; clés de prototype refusées : `socle/src/schema.js:6` | aucune fusion récursive d’un corps de requête |
| SEC-XSS-001 | CRITICAL | PASS | `grep -rnE "innerHTML\|outerHTML\|insertAdjacentHTML\|document.write" web/app.js web/crypto.js extension/*.js` → 0 ligne ; tout passe par du texte : `socle/web/compte.js:16` | le gabarit du socle n’est pas importé |
| SEC-XSS-002 | HIGH | PASS | tout ce qu’un élément contient (y compris partagé par un autre compte) s’affiche en nœuds texte ; liens http(s) seulement `web/app.js:457` ; notes en `<pre>` texte | un nom, une note ou une adresse piégés restent du texte |
| SEC-XSS-003 | HIGH | PASS | aucun eval, setTimeout chaîne ni affectation de location : `grep -rnE "eval\(\|new Function\|location\.href *=" web/app.js web/crypto.js` → 0 ligne | le hash ne sert qu’à choisir une page parmi une liste fixe `web/app.js:315` |
| SEC-XSS-004 | HIGH | PASS | voir REQ-WEB-002 |  |
| SEC-XSS-005 | MEDIUM | PASS | seul échange : le Worker de preuve de travail, de même origine : `socle/web/compte.js:233` | aucune iframe, aucune écoute de window message |
| SEC-XSS-006 | MEDIUM | PASS | aucune carte de source servie (`grep -rn sourceMappingURL web` → 0 ligne) ; erreurs réduites à un message : `socle/src/http.js:159` |  |
| SEC-XSS-007 | MEDIUM | N/A | aucune redirection pilotée par paramètre : `grep -rnE "searchParams.get\(.(next\|redirect)" src web socle` → 0 ligne |  |
| SEC-XSS-008 | MEDIUM | PASS | aucun script tiers chargé d’ailleurs : tout est servi par CODVAULT ; @noble/hashes copié tel que publié, empreinte de chaque fichier vérifiée (`web/vendor/PROVENANCE`) | essai `test/fournitures.test.js:10` |
| SEC-HDR-001 | HIGH | FAIL | voir REQ-WEB-001 | action H1 |
| SEC-HDR-002 | HIGH | PASS | voir REQ-WEB-002 |  |
| SEC-HDR-003 | MEDIUM | PASS | `socle/src/http.js:79` ; Permissions-Policy refuse toutes les capacités (`curl -sI /`) | X-Frame-Options DENY en plus de frame-ancestors |
| SEC-HDR-004 | LOW | PASS | `curl -sI /` : ni Server ni X-Powered-By |  |
| SEC-HDR-005 | MEDIUM | PASS | no-store sur l’API et les pages : `socle/src/http.js:150` | fichiers statiques du socle en cache public d’une heure |
| SEC-HDR-006 | CRITICAL | PASS | voir REQ-WEB-004 |  |
| SEC-HDR-007 | HIGH | PASS | voir REQ-SESS-001 |  |
| SEC-CSRF-001 | HIGH | PASS | SameSite=Strict + origine + jeton : `socle/src/portail.js:84` | essai `socle/test/parcours.test.js:200` |
| SEC-CSRF-002 | MEDIUM | PASS | `socle/src/http.js:120` | 415 sur tout autre type |
| SEC-CSRF-003 | MEDIUM | PASS | aucune écriture sur GET : routes GET en lecture seule (src/api.js, socle/src/portail.js) | les liens de courriel demandent un geste, puis un POST |
| SEC-CSRF-004 | CRITICAL | PASS | seule adresse appelée à partir d’une saisie : le site d’un logo. HTTPS seul, nom de domaine public seul `src/logos.js:87` ; chaque IP résolue contrôlée (privées, réservées, documentation, NAT64, 6to4, ULA, lien local) `src/logos.js:43` puis épinglée pour la connexion `src/logos.js:100` ; redirections recontrôlées, trois au plus `src/logos.js:115` | essai `test/codvault.test.js:281` ; `CODVAULT_LOGOS=non` coupe toute requête sortante `src/logos.js:140` |
| SEC-CSRF-005 | HIGH | PASS | aucun webhook reçu ni émis | le Hub n’a qu’un jeton d’administration des comptes, sans route de CODVAULT |
| SEC-CSRF-006 | MEDIUM | N/A | aucune redirection : voir SEC-XSS-007 |  |
| SEC-API-001 | HIGH | PASS | voir REQ-WEB-006 ; paramètres de chemin `src/api.js:375` |  |
| SEC-API-002 | HIGH | PASS | global : 900 requêtes par minute et par adresse `src/main.js:27` ; connexion et jetons d’appareil : limiteur du socle ; dix appareils par compte `src/appareils.js:17` ; logos : 300 récupérations par heure `src/logos.js:24` |  |
| SEC-API-003 | MEDIUM | PASS | synchronisation du coffre entier, voulue (le navigateur déchiffre et cherche localement), bornée par les plafonds du coffre `src/config.js:18`, `src/config.js:19` | pas de recherche côté serveur : il ne lit rien |
| SEC-API-004 | HIGH | PASS | vues réduites aux champs utiles `src/api.js:198`, plus encore pour un appareil `src/api.js:362` ; ni le jeton ni son empreinte ne ressortent de la liste des appareils `src/appareils.js:48` ; d’un autre compte, seul son identifiant sort `src/api.js:91` | aucun secret, aucune empreinte de facteur dans les réponses |
| SEC-API-005 | MEDIUM | PASS | 405 avec Allow `src/api.js:383` ; hors API, seules GET et HEAD `src/main.js:46` | essai `test/codvault.test.js:313` : PATCH → 405 ; aucune page de documentation |
| SEC-API-006 | HIGH | N/A | aucun GraphQL : `grep -rniE "graphql\|apollo" src web socle` → 0 ligne |  |
| SEC-API-007 | MEDIUM | PASS | un seul formateur d’erreurs : `socle/src/http.js:159` | transactions pour les écritures multiples : `socle/src/comptes.js:136` |
| SEC-API-008 | MEDIUM | N/A | aucune opération monétaire ni crédit : `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |  |
| SEC-API-009 | HIGH | PASS | pas de RPC : chaque route HTTP vérifie session, rôle et schéma (voir SEC-AUTH-010) |  |
| SEC-API-010 | MEDIUM | PASS | `socle/src/http.js:126` ; 64 Kio par défaut, 160 Kio pour un élément `src/api.js:228`, 8 Mio pour un lot `src/api.js:239`, deux fois le plafond du coffre pour un renouvellement de clé `src/api.js:141` | essai `test/codvault.test.js:313` : 200 000 caractères → 413 |
| SEC-DB-001 | CRITICAL | PASS | voir REQ-DATA-001 |  |
| SEC-DB-002 | HIGH | N/A | SQLite embarqué sans rôle ni identifiant : `src/base.js:17` |  |
| SEC-DB-003 | HIGH | FAIL | aucun trafic réseau vers la base ; coffres chiffrés de bout en bout | chiffrement du disque des hôtes : action H5 |
| SEC-DB-004 | MEDIUM | PASS | le coffre entier est chiffré dans le navigateur : la base ne reçoit que des blocs AES-256-GCM `web/crypto.js:86` ; secrets TOTP des comptes scellés : `socle/src/chiffre.js:60` | essai `test/codvault.test.js:153` : ni le mot de passe maître ni la clé de récupération dans la base ni dans son journal WAL |
| SEC-DB-005 | CRITICAL | PASS | voir SEC-INJ-001 |  |
| SEC-DB-006 | HIGH | FAIL | voir REQ-DATA-003 | action H6 |
| SEC-DB-007 | MEDIUM | PASS | essais sur données fabriquées ; aucun compte par défaut : jeton d’installation exigé (`socle/src/comptes.js:243`) |  |
| SEC-DB-008 | CRITICAL | N/A | le navigateur ne parle jamais à la base : SQLite côté serveur seulement |  |
| SEC-DB-009 | LOW | PASS | `src/base.js:18` ; un seul processus, plafonds par coffre | pas de pool nécessaire |
| SEC-DB-010 | LOW | PASS | export de données tracé : `socle/src/portail.js:333` | aucun export administratif en masse |
| SEC-FILE-001 | HIGH | PASS | aucun fichier déposé sur le serveur ; les icônes reçues des sites sont décodées entièrement (PNG, ICO) puis réencodées, jamais crues sur leur en-tête `src/image.js:187` | JPEG, GIF, WebP, SVG, HTML : refusés, les initiales restent ; essai `test/image.test.js` |
| SEC-FILE-002 | MEDIUM | PASS | 256 Kio par icône `src/logos.js:19`, 6 s par requête `src/logos.js:21` ; dimensions bornées à 512 px avant tout décodage `src/image.js:10` ; décompression bornée à la taille annoncée `src/image.js:46` ; quota par coffre (voir SEC-API-003) | essai : bombe de 64 Mio et image de 100 000 px refusées |
| SEC-FILE-003 | HIGH | PASS | icônes rangées en base, sous le domaine contrôlé `src/logos.js:18` : aucun chemin de fichier venu de la requête | rien n’est écrit dans un dossier servi |
| SEC-FILE-004 | HIGH | PASS | servies sous l’origine de CODVAULT mais seulement en octets écrits par son propre encodeur PNG `src/image.js:178`, avec `Content-Type: image/png`, `nosniff`, `Content-Disposition: attachment` et `Content-Security-Policy: default-src 'none'; sandbox` `src/api.js:308` | essai `test/codvault.test.js:281` : en-têtes vérifiés ; une origine séparée n’apporterait rien de plus ici, aucun HTML ni SVG ne pouvant être servi |
| SEC-FILE-005 | CRITICAL | PASS | route des logos sous session `src/api.js:301` ; les blocs du coffre suivent le contrôle par objet (SEC-AUTHZ-001) | les icônes sont celles, publiques, des sites |
| SEC-FILE-006 | MEDIUM | N/A | aucun fichier déposé par un compte n’est redistribué à un autre : aucune route n’accepte de fichier (`grep -rn multipart src socle/src` → 0) ; un partage est un enregistrement chiffré, une icône une image réencodée par CODVAULT |  |
| SEC-FILE-007 | LOW | PASS | réencodage complet : seuls les pixels passent, aucune métadonnée `src/image.js:178` | essai `test/image.test.js:53` : EXIF avec position et texte d’auteur absents de la sortie |
| SEC-FILE-008 | HIGH | PASS | voir SEC-CSRF-004 pour la requête, SEC-FILE-001 et -002 pour ce qui revient | essai `test/codvault.test.js:281` |
| SEC-PAY-001 | CRITICAL | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |  |
| SEC-PAY-002 | CRITICAL | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement ; aucun webhook reçu |  |
| SEC-PAY-003 | HIGH | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement ; aucun abonnement |  |
| SEC-PAY-004 | HIGH | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |  |
| SEC-PAY-005 | HIGH | N/A | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |  |
| SEC-PAY-006 | HIGH | PASS | vérification : 5 par heure par compte et par adresse (`socle/src/portail.js:36`) ; alertes : 30 par heure et par compte (`socle/src/notifications.js:98`) |  |
| SEC-PAY-007 | MEDIUM | FAIL | le domaine d’expédition est celui du relais de l’exploitant | SPF, DKIM et DMARC à publier avec le relais : action H2 |
| SEC-PAY-008 | MEDIUM | PASS | aucun mot de passe dans un courriel ; liens uniques, hachés, de 30 minutes (`socle/src/comptes.js:34`) ou 72 heures pour fermer les sessions (`socle/src/notifications.js:27`) | le lien de révocation ne peut que fermer des sessions |
| SEC-NEXT-001 | CRITICAL | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |  |
| SEC-NEXT-002 | CRITICAL | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |  |
| SEC-NEXT-003 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |  |
| SEC-NEXT-004 | CRITICAL | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |  |
| SEC-NEXT-005 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |  |
| SEC-NEXT-006 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |  |
| SEC-NEXT-007 | HIGH | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |  |
| SEC-NEXT-008 | MEDIUM | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne ; aucun déploiement Vercel |  |
| SEC-NEXT-009 | MEDIUM | N/A | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne ; aucune bibliothèque de cache client |  |
| SEC-BAAS-001 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-002 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-003 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-004 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-005 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-006 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-007 | MEDIUM | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-008 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-009 | CRITICAL | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-010 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BAAS-011 | HIGH | N/A | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |  |
| SEC-BE-001 | MEDIUM | PASS | en-têtes posés avant toute route, erreurs comprises `src/main.js:36` | pas d’Express : équivalent explicite |
| SEC-BE-002 | MEDIUM | PASS | corps bornés ; 404 pour l’inconnu ; relais de confiance explicites : `socle/src/http.js:14` | essai « relais non déclaré ignoré » |
| SEC-BE-003 | HIGH | PASS | aucun processus, aucun eval, aucun import dynamique d’un chemin fourni (voir REQ-WEB-007) ; clés de prototype refusées : `socle/src/schema.js:6` |  |
| SEC-BE-004 | HIGH | PASS | aucune dépendance npm, vérifié en CI `.github/workflows/verification.yml:38` ; la seule bibliothèque tierce est vendorisée et épinglée par empreinte | rien à installer, donc rien à verrouiller |
| SEC-BE-005 | CRITICAL | N/A | aucun Django : service Node |  |
| SEC-BE-006 | HIGH | N/A | aucun Flask ni FastAPI : service Node |  |
| SEC-BE-007 | HIGH | N/A | aucun code Python servi |  |
| SEC-BE-008 | HIGH | N/A | aucun PHP |  |
| SEC-BE-009 | MEDIUM | PASS | utilisateur sans droits `Dockerfile:18`, programmes setuid retirés `Dockerfile:12`, base épinglée par empreinte `Dockerfile:6`, données en 0700 |  |
| SEC-BE-010 | MEDIUM | PASS | `socle/src/http.js:159` ; sonde publique réduite à « vivant » `src/api.js:93` | erreurs génériques, détail au journal seulement |
| SEC-WP-001 | CRITICAL | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-WP-002 | HIGH | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-WP-003 | HIGH | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-WP-004 | MEDIUM | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-WP-005 | MEDIUM | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-WP-006 | CRITICAL | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-WP-007 | HIGH | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-WP-008 | MEDIUM | N/A | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |  |
| SEC-INFRA-001 | HIGH | FAIL | voir REQ-WEB-001 | action H1 |
| SEC-INFRA-002 | MEDIUM | FAIL | aucun domaine dans le dépôt | DNS, CAA, verrou du registraire du domaine de publication : action H10 |
| SEC-INFRA-003 | HIGH | FAIL | hôtes de l’exploitant | pare-feu, SSH par clé, mises à jour : action H7 |
| SEC-INFRA-004 | MEDIUM | FAIL | `Dockerfile:6` ; `Dockerfile:18` ; `deploy/compose.hub.yml:15` ; `deploy/compose.hub.yml:18` ; `deploy/compose.hub.yml:19` ; `deploy/compose.hub.yml:20` | image à passer au crible (Trivy) sur la VM : action H11 |
| SEC-INFRA-005 | CRITICAL | N/A | aucun stockage objet : `grep -rniE "s3\|aws\|gcs\|azure\|bucket" src socle/src` → 0 ligne |  |
| SEC-INFRA-006 | HIGH | N/A | aucun nuage : service auto-hébergé, aucune clé IAM |  |
| SEC-INFRA-007 | HIGH | FAIL | permissions minimales, actions épinglées par commit, aucun secret pour les demandes de fusion | protection de branche et revue requise : action H3 |
| SEC-INFRA-008 | MEDIUM | FAIL | le Hub construit l’image depuis l’étiquette du dépôt ; base épinglée par empreinte ; SBOM `sbom.cdx.json` | étiquette de version signée et empreinte de l’image relevée au déploiement : actions H3, H11 |
| SEC-INFRA-009 | MEDIUM | N/A | aucune infrastructure décrite en code : `find . -name "*.tf" -o -name "Pulumi.yaml"` → 0 fichier |  |
| SEC-DEP-001 | HIGH | PASS | aucune dépendance installée (ni à la construction de l’image, ni en CI) ; @noble/hashes 2.4.0 copié tel que publié : intégrité du paquet et empreinte de chaque fichier dans `web/vendor/PROVENANCE` | la même étiquette donne le même arbre partout |
| SEC-DEP-002 | HIGH | FAIL | rien à passer à npm audit ; la bibliothèque vendorisée échappe à Dependabot | veille des avis de @noble/hashes et alertes du dépôt : action H3 |
| SEC-DEP-003 | MEDIUM | PASS | une seule bibliothèque tierce, auditée et maintenue, réduite aux six fichiers qu’Argon2id importe | provenance vérifiée : intégrité npm identique à celle du registre |
| SEC-DEP-004 | MEDIUM | PASS | version exacte ; actions de CI épinglées par commit `.github/workflows/verification.yml:22` | mise à jour : nouveaux fichiers, nouvelle PROVENANCE, essais |
| SEC-DEP-005 | MEDIUM | PASS | aucun script d’installation exécuté : l’image copie des fichiers `Dockerfile:17`, la CI lance `npm test` sans installer `.github/workflows/verification.yml:29` |  |
| SEC-DEP-006 | LOW | PASS | `sbom.cdx.json` (CycloneDX 1.5) : @noble/hashes, image de base, socle | tenue alignée par l’essai `test/fournitures.test.js:27` |
| SEC-DEP-007 | MEDIUM | PASS | voir SEC-XSS-008 |  |
| SEC-DEP-008 | LOW | FAIL | aucune veille d’avis encore | s’abonner aux avis de sécurité de @noble/hashes sur GitHub : action H3 |
| SEC-LLM-001 | CRITICAL | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LLM-002 | CRITICAL | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LLM-003 | HIGH | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LLM-004 | HIGH | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LLM-005 | CRITICAL | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LLM-006 | HIGH | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LLM-007 | MEDIUM | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LLM-008 | LOW | N/A | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |  |
| SEC-LOG-001 | MEDIUM | PASS | voir REQ-DATA-004 ; identifiant de requête : `socle/src/requete.js:12` |  |
| SEC-LOG-002 | HIGH | PASS | `socle/src/journal.js:10` ; le journal de CODVAULT ne porte que des identifiants d’élément et des paramètres de dérivation `src/api.js:36`, jamais un contenu ni un domaine | le serveur n’a de toute façon aucun clair à écrire |
| SEC-LOG-003 | MEDIUM | FAIL | sortie standard conservée par Docker, hors de portée du service `deploy/compose.hub.yml:23` | collecteur central hors hôte : action H9 |
| SEC-LOG-004 | MEDIUM | PASS | vigie : échecs, refus, limites, erreurs, connexion d’un administrateur (`socle/src/vigie.js:11`) ; refus d’origine et de jeton anti-CSRF journalisés : `socle/src/portail.js:105` | courriel pour sortir de l’application : H2 |
| SEC-LOG-005 | LOW | FAIL | sonde du Hub toutes les 30 s `hub.json:17` | surveillance externe : action H8 |
| SEC-LOG-006 | MEDIUM | PASS | runbook ci-dessous |  |
| SEC-LOG-007 | HIGH | PASS | fermeture globale des sessions : `socle/src/portail.js:475`, qui retire aussi tous les appareils reliés `src/main.js:40` ; un compte compromis : ses sessions et ses appareils tombent ensemble `src/api.js:72`, sa clé de coffre se renouvelle (REQ-SESS-005) ; rotation de SOCLE_CLE exercée (`outils/exercice-rotation.mjs`) | aucune fonction payante à couper |
| SEC-PRIV-001 | MEDIUM | PASS | `web/confidentialite.txt:8` avec finalités et durées ; purges automatiques : `socle/src/comptes.js:971` |  |
| SEC-PRIV-002 | MEDIUM | PASS | un cookie de session indispensable, documenté ; aucun traceur `web/confidentialite.txt:75` |  |
| SEC-PRIV-003 | MEDIUM | PASS | `web/confidentialite.txt:66` nomme chaque destinataire ; `web/confidentialite.txt:49` dit ce que le chiffrement ne cache pas | lien depuis la page Sécurité `web/app.js:273` |
| SEC-PRIV-004 | MEDIUM | PASS | export : `socle/src/portail.js:330`, avec le coffre tel que stocké `src/api.js:369` ; effacement en libre-service sous renfort : `socle/src/comptes.js:841`, coffre, éléments et partages avec le compte `src/api.js:367` | essai `test/codvault.test.js:529` |
| SEC-PRIV-005 | HIGH | FAIL | voir REQ-DATA-002 | actions H1, H5 |
| SEC-PRIV-006 | LOW | FAIL | aucun sous-traitant ; seul le relais SMTP de l’exploitant, s’il est configuré, reçoit des données (adresse d’alerte) | choisir un relais aux conditions de traitement connues : action H2 |
| SEC-PRIV-007 | MEDIUM | PASS | runbook : notification sous 72 heures |  |
| SEC-PRIV-008 | LOW | PASS | `web/confidentialite.txt:103` | aucune catégorie particulière traitée en clair |
| SEC-TEST-001 | MEDIUM | FAIL | `.github/workflows/verification.yml:113` | Actions : H3 |
| SEC-TEST-002 | HIGH | FAIL | voir REQ-CI-001 | actions H3, H4 |
| SEC-TEST-003 | HIGH | FAIL | aucune dépendance à passer au crible ; image : à cribler au déploiement | actions H3, H11 |
| SEC-TEST-004 | MEDIUM | FAIL | aucun passage DAST encore | ZAP en mode « baseline » contre la VM d’essai : action H11 |
| SEC-TEST-005 | LOW | FAIL | voir REQ-WEB-001 | notation après HTTPS : action H1 |
| SEC-TEST-006 | HIGH | PASS | voir REQ-CI-006 |  |
| SEC-TEST-007 | LOW | PASS | sondage manuel mené le jour de cet audit : adresses internes et redirections pour les logos, images piégées (bombe, dimensions, SVG, HTML, métadonnées), export fabriqué, formules de tableur, blocs en clair, champs en trop, corps géants, mauvais rôles, routes oubliées, ouverture en HTTP, jetons d’appareil faux, tronqués ou en rafale, renouvellement de clé rejoué ou incomplet ; pour l’extension : champ mot de passe caché, cadre intégré d’un autre site, page qui change de site entre le choix et le remplissage, domaine qui en imite un autre — chacun devenu un essai (`node outils/parcours-extension.mjs` : 17/17) |  |
| SEC-TEST-008 | LOW | N/A | ni argent, ni santé, ni large public : service auto-hébergé pour quelques comptes invités ; `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |  |

## Not applicable
| ID | Why, with proof |
|---|---|
| REQ-CRYPT-003 | bcrypt absent : `grep -rniE "bcrypt" socle/src src` → 0 ligne ; Argon2id seul |
| SEC-AUTH-008 | aucune connexion par fournisseur externe : `grep -rniE "oauth\|openid\|id_token\|redirect_uri" socle/src src web/app.js` → 0 ligne |
| SEC-SESS-005 | aucun JWT : `grep -rniE "jwt\|jsonwebtoken\|jose" src web socle` → 0 ligne |
| SEC-SESS-006 | aucun jeton de rafraîchissement : sessions serveur (voir SEC-SESS-005) |
| SEC-AUTHZ-005 | ni organisation, ni équipe, ni espace de travail côté serveur : un élément appartient à un compte et se partage élément par élément (SEC-AUTHZ-001) ; les « espaces » sont des étiquettes chiffrées dans l’élément, inconnues du serveur : `grep -c espace src/*.js` → 0 |
| SEC-INJ-002 | aucun ORM : node:sqlite, requêtes préparées seulement |
| SEC-INJ-003 | aucune base documentaire : SQLite seulement |
| SEC-INJ-004 | aucun processus lancé : `grep -rn "child_process\|spawn(" src socle/src` → 0 ligne |
| SEC-INJ-006 | aucun moteur de gabarit : `grep -rniwE "handlebars\|ejs\|nunjucks\|mustache" src socle/src` → 0 ligne ; `grep -rnE "new Function\|node:vm" src socle/src` → 0 ligne |
| SEC-INJ-007 | aucun analyseur XML côté serveur : `grep -rniE "xml2js\|sax\|libxml\|fast-xml" src socle/src` → 0 ligne |
| SEC-XSS-007 | aucune redirection pilotée par paramètre : `grep -rnE "searchParams.get\(.(next\|redirect)" src web socle` → 0 ligne |
| SEC-CSRF-006 | aucune redirection : voir SEC-XSS-007 |
| SEC-API-006 | aucun GraphQL : `grep -rniE "graphql\|apollo" src web socle` → 0 ligne |
| SEC-API-008 | aucune opération monétaire ni crédit : `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |
| SEC-DB-002 | SQLite embarqué sans rôle ni identifiant : `src/base.js:17` |
| SEC-DB-008 | le navigateur ne parle jamais à la base : SQLite côté serveur seulement |
| SEC-FILE-006 | aucun fichier déposé par un compte n’est redistribué à un autre : aucune route n’accepte de fichier (`grep -rn multipart src socle/src` → 0) ; un partage est un enregistrement chiffré, une icône une image réencodée par CODVAULT |
| SEC-PAY-001 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |
| SEC-PAY-002 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement ; aucun webhook reçu |
| SEC-PAY-003 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement ; aucun abonnement |
| SEC-PAY-004 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |
| SEC-PAY-005 | `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |
| SEC-NEXT-001 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |
| SEC-NEXT-002 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |
| SEC-NEXT-003 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |
| SEC-NEXT-004 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |
| SEC-NEXT-005 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |
| SEC-NEXT-006 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |
| SEC-NEXT-007 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne |
| SEC-NEXT-008 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne ; aucun déploiement Vercel |
| SEC-NEXT-009 | Node sans cadriciel : `package.json:5`, aucune dépendance ; `grep -rniE "next/\|nextjs\|use server" src web socle` → 0 ligne ; aucune bibliothèque de cache client |
| SEC-BAAS-001 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-002 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-003 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-004 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-005 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-006 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-007 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-008 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-009 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-010 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BAAS-011 | `grep -rniE "supabase\|firebase\|firestore\|postgrest" src web socle` → 0 ligne ; base SQLite embarquée : `src/base.js:17` |
| SEC-BE-005 | aucun Django : service Node |
| SEC-BE-006 | aucun Flask ni FastAPI : service Node |
| SEC-BE-007 | aucun code Python servi |
| SEC-BE-008 | aucun PHP |
| SEC-WP-001 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-WP-002 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-WP-003 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-WP-004 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-WP-005 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-WP-006 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-WP-007 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-WP-008 | application Node écrite ici : `grep -rniE "wordpress\|wp-admin\|bubble\|webflow" src web socle` → 0 ligne |
| SEC-INFRA-005 | aucun stockage objet : `grep -rniE "s3\|aws\|gcs\|azure\|bucket" src socle/src` → 0 ligne |
| SEC-INFRA-006 | aucun nuage : service auto-hébergé, aucune clé IAM |
| SEC-INFRA-009 | aucune infrastructure décrite en code : `find . -name "*.tf" -o -name "Pulumi.yaml"` → 0 fichier |
| SEC-LLM-001 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-LLM-002 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-LLM-003 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-LLM-004 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-LLM-005 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-LLM-006 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-LLM-007 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-LLM-008 | CODVAULT n’appelle aucun modèle et n’en expose aucun : `grep -rniE "openai\|anthropic\|ollama\|mistral\|llm\|gpt\|chat/completions" src web/app.js web/crypto.js socle/src` → 0 ligne ; pour le Hub, aucune action et `exposeActions` à false `hub.json:215` |
| SEC-TEST-008 | ni argent, ni santé, ni large public : service auto-hébergé pour quelques comptes invités ; `grep -rniE "stripe\|paypal\|checkout\|invoice\|payout\|refund" src web/*.js socle/src socle/web/*.js` → 0 ligne : aucun paiement |

## Anonymity (REQ-ANON-001 to -010)
Historique complet (toutes branches et étiquettes) et arbre balayés avec la liste de session et les motifs de l’annexe B.1 : une seule identité, tous les horodatages en UTC, aucune mention d’outil, aucun binaire porteur de métadonnées. 1 occurrence retirée dans 1 fichier (une liste de mots de passe courants) ; entrée dans un commit local, jamais poussé, elle a été effacée de l'historique par réécriture avant toute publication (auteurs, dates et fuseau conservés). Correspondances restantes, toutes justifiées : 3 lignes de la liste de session (deux plages privées génériques, que la garde des logos doit refuser, et le nom d’une application d’authentification cité par le socle) et 6 lignes du motif B.1 (détail en REQ-ANON-002). La 1.0.0 a été publiée après ce balayage ; les commits de la 2.0.0 (renommage, appareils, extension, renouvellement de clé), pas encore poussés, ont été balayés de la même façon avec une liste de session élargie : 0 occurrence nouvelle ; les quatre icônes PNG de l’extension ne portent que les blocs d’image (aucun bloc texte ni EXIF). Aucune exposition résiduelle dans l’historique publié. Le balayage repose sur des motifs ; la liste complète de l’exploitant (action H4) reste à appliquer. Détail dans le rapport d’anonymat hors dépôt.

## Human actions required
Ce qu’aucun agent ne peut faire à la place de l’exploitant. Cette liste bloque la mise en production tant qu’elle n’est pas vide.

| # | Action | Contrôles | Étapes |
|---|---|---|---|
| H1 | Servir CODVAULT en HTTPS | REQ-WEB-001, REQ-DATA-002, SEC-HDR-001, SEC-INFRA-001, SEC-PRIV-005, SEC-TEST-005 | Publier CODVAULT par le Hub (tunnel ou relais) ; dans ses réglages avancés : « Relais de confiance » (SOCLE_PROXYS) = la plage du réseau du connecteur ou du relais, « Accès sans HTTPS » = Non, « Adresse publique » en https:// ; redéployer ; vérifier `curl -sI https://<codvault>/ \| grep -i strict-transport-security` ; noter l’hôte sur SSL Labs ou testssl.sh (A attendu). Sans HTTPS, le coffre ne s’ouvre pas : CODVAULT l’affiche. |
| H2 | Relais SMTP et adresses d’alerte | REQ-AUTH-014, SEC-PAY-007, SEC-PRIV-006, SEC-LOG-004 | Réglages avancés de CODVAULT dans le Hub : relais, port, chiffrement, identifiants, adresse d’expédition ; choisir un relais dont les conditions de traitement et la région sont connues ; publier SPF, DKIM et DMARC pour le domaine d’expédition ; chaque administrateur ajoute puis confirme son adresse dans Sécurité → Alertes par courriel. |
| H3 | GitHub | REQ-CI-001…003, REQ-CI-005, GOV-005, SEC-INFRA-007, SEC-INFRA-008, SEC-TEST-001…003, SEC-DEP-002, SEC-DEP-008 | Renommer le dépôt (`gh repo rename codvault`) et pousser la 2.0.0 ; rétablir la facturation des Actions ; Settings → Branches : protéger `main` (pas de poussée forcée ; contrôles requis : essais, secrets, identite, anonymat, analyse) ; 2FA sur le compte ; « Watch → Custom → Security alerts » sur le dépôt de @noble/hashes ; étiquettes de version signées. Signalement privé, détection de secrets et protection de poussée : activés le 2026-10-08. |
| H4 | Liste d’anonymat | REQ-ANON-003, REQ-CI-004, REQ-CI-001 | Sur le poste qui commite : `~/.config/git/denylist.txt` (un terme par ligne) et crochet global `core.hooksPath` qui refuse un commit dont le diff contient un terme, plus `gitleaks protect --staged` ; sur GitHub : secret de dépôt `LISTE_ANONYMAT` avec les mêmes termes. Y mettre les sous-réseaux précis (trois premiers octets), pas une plage privée entière : la garde des logos de CODVAULT cite les plages RFC 1918 par construction. |
| H5 | Chiffrement des disques | REQ-DATA-002, SEC-DB-003, SEC-PRIV-005 | LUKS (ou chiffrement du stockage de l’hyperviseur) sur l’hôte qui porte le volume de CODVAULT : comptes, sessions et journal y sont en clair, les coffres non. |
| H6 | Sauvegardes et exercices | REQ-DATA-003, REQ-DATA-005, SEC-DB-006 | Sauvegarde chiffrée hors hôte du volume (codvault.db et son WAL, à froid ou par `sqlite3 .backup`) ; une restauration réelle sur la VM, datée ici ; dérouler une fois le runbook ci-dessous. |
| H7 | Hôtes | SEC-INFRA-003 | Pare-feu (seuls les ports publiés), SSH par clé sans root, mises à jour de sécurité automatiques, fail2ban. |
| H8 | Disponibilité vue de l’extérieur | SEC-LOG-005 | Une sonde externe sur `https://<codvault>/api/health`, alertant une personne. |
| H9 | Journaux centralisés | SEC-LOG-003 | Transférer les journaux du conteneur vers un collecteur hors de l’hôte (pilote de journalisation Docker ou agent). |
| H10 | Domaine | REQ-ANON-009, SEC-INFRA-002 | Domaine de publication : protection WHOIS, verrou du registraire, 2FA, enregistrement CAA, suppression des enregistrements orphelins. |
| H12 | Extension | SEC-INFRA-008 | Chrome, Edge, Brave : `chrome://extensions` → mode développeur → « Charger l’extension non empaquetée » → dossier `extension/` de l’étiquette v2.0.0. Firefox : signer en non listé sur addons.mozilla.org (`web-ext sign --channel=unlisted --source-dir extension`, clés d’API AMO de l’exploitant), puis installer le `.xpi` signé. Recharger l’extension à chaque version. |
| H11 | Crible au déploiement | SEC-INFRA-004, SEC-INFRA-008, SEC-TEST-003, SEC-TEST-004 | Sur la VM, après la construction par le Hub : `trivy image <image de codvault>` sans CRITICAL ni HIGH corrigeable ; `docker image inspect --format '{{.Id}}' <image>` noté ici avec l’étiquette ; `zap-baseline.py -t https://<codvault>` ; résultats notés ici. |

Orthographe du pseudonyme : le manuel nomme l’identité « Codex64 » ; les commits et le compte GitHub portent la forme du compte, identique dans tous les dépôts du projet, et la licence porte « Codex64 ». Changer maintenant créerait une seconde identité dans les journaux ; à trancher par l’exploitant.

## Secrets inventory
| Secret | Where it lives | Scope | Rotation procedure | Last rotated |
|---|---|---|---|---|
| SOCLE_CLE (tirée par le Hub, 32 octets) | coffre du Hub → variable du conteneur | scelle les secrets TOTP des comptes | réglages avancés de CODVAULT dans le Hub : l’actuelle dans « Clé maîtresse remplacée », une neuve (`openssl rand -base64 32`) dans « Clé maîtresse », redéployer (journal `[coffre] Clé tournée`), vider le champ, redéployer | à l’installation ; procédure exercée le 2026-10-08 (`node outils/exercice-rotation.mjs`, 12/12) |
| HUB_ADMIN_TOKEN (tiré par le Hub, 48 octets) | coffre du Hub → variable SOCLE_JETON_ADMIN_HUB | créer, modifier, réinitialiser, supprimer les comptes de CODVAULT ; jamais les coffres | régénérer le champ dans le Hub, redéployer CODVAULT | à l’installation |
| Jetons d’appareil (extension, 256 bits) | dans l’extension (son stockage) ; le serveur n’en garde que l’empreinte SHA-256 | lire le coffre chiffré et ses éléments d’un compte, rien d’autre | Extension → Retirer, puis relier à nouveau ; tombent seuls après 30 jours sans servir, 180 jours au plus, et avec toutes les sessions du compte | à chaque liaison |
| SOCLE_JETON_INSTALLATION | vide sous le Hub ; hors Hub, tiré au premier démarrage et écrit au journal | création du premier compte, puis inutile | aucun : sans effet dès qu’un compte existe | — |
| SOCLE_SMTP_MOTDEPASSE (émis par le fournisseur de courriel) | coffre du Hub → variable | relais des alertes | changer chez le fournisseur, coller dans le Hub, redéployer | à la mise en service (H2) |
| Mots de passe maîtres et clés de récupération | chez chaque personne, jamais sur le serveur | un coffre | changer le mot de passe maître ou refaire la clé de récupération dans « Coffre et clés » (renfort demandé) | — |

## Incident runbook
Détecter : alertes « vigie » de la page Sécurité des administrateurs (et par courriel, H2) ; `docker logs <codvault> | grep '"resultat":"refus"'`.

```bash
# 1. Fermer toutes les sessions sauf la sienne (renfort demandé)
#    Page Comptes → « Fermer toutes les sessions », ou :
curl -X POST -H 'Content-Type: application/json' -H "X-CSRF: $CSRF" -b "$COOKIE" https://<codvault>/api/compte/admin/sessions/fermer-tout -d '{}'
# 2. Couper toute requête sortante (logos) le temps de l'enquête
#    Hub → CODVAULT → Réglages → « Logos des sites » : Aucun → Redéployer
# 3. Tourner les secrets touchés : voir « Secrets inventory »
# 4. Forcer un nouveau mot de passe de compte : Page Comptes → compte → « Réinitialiser » (le second facteur reste exigé)
# 5. Si la base a pu être copiée : chaque personne change son mot de passe maître et refait sa clé de récupération
#    (l'ancienne enveloppe reste attaquable hors ligne au coût d'Argon2id), puis change sur les sites les mots de passe les plus sensibles
#    Si un coffre ouvert a pu être copié (poste compromis) : Coffre et clés → « Renouveler la clé du coffre »
#    (tout est rechiffré, sessions et appareils du compte coupés), puis changer les mots de passe des sites
# 5 bis. Un appareil perdu : Extension → Retirer ; tous d'un coup : l'étape 1 retire aussi tous les appareils reliés
# 6. Restaurer : arrêter CODVAULT, remettre codvault.db depuis la sauvegarde chiffrée, redémarrer
docker compose -p <codvault> stop && docker run --rm -v <volume>:/data -v <sauvegarde>:/b busybox sh -c 'rm -f /data/codvault.db-wal /data/codvault.db-shm && cp /b/codvault.db /data/ && chown 10005:10005 /data/codvault.db && chmod 600 /data/codvault.db' && docker compose -p <codvault> start
# 7. Vérifier la chaîne du journal : Page Comptes → Journal de sécurité (« chaîne intacte »)
```
Communiquer : prévenir les comptes concernés ; si des données personnelles ont pu être lues, notifier l’autorité de contrôle sous 72 heures à compter de la découverte (heure de découverte, nature, comptes touchés, mesures prises), et les personnes si le risque est élevé. La personne qui décide si la violation doit être notifiée est l’exploitant de l’instance. Revue après incident : cause, chronologie, contrôle qui a manqué, correctif et essai de non-régression. Dépendance compromise (@noble/hashes) : revenir à la version précédente de PROVENANCE, publier une version, demander à chacun de changer son mot de passe maître.

## Inventory
Routes publiques : `GET /api/health`, `GET /.well-known/security.txt`, `GET /api/compte/etat`, cérémonies de connexion et d’installation du socle (`/api/compte/connexion*`, `/api/compte/installation`, `/api/compte/jeton*`, `/api/compte/courriel/verifier`, `/api/compte/pas-moi/lien`, `/api/compte/deconnexion`), fichiers de `web/` et `socle/web/`. Jeton d’administration du Hub : `/api/compte/hub/comptes*`. Session (lecture) : `/api/version`, `/api/coffre`, `PUT /api/coffre/kdf`, `PUT /api/coffre/preferences`, `GET /api/elements`, `DELETE /api/elements/:id/partages/:dest` (quitter un partage), `GET /api/logos/:domaine`, `GET /api/appareils`, `DELETE /api/appareils/:id`, `/api/compte/*` du compte. Sous renfort : `PUT /api/coffre/maitre`, `PUT /api/coffre/cle`, `GET` et `PUT /api/coffre/recuperation`, `POST /api/appareils`. Jeton d’appareil, en lecture seule : `GET /api/appareil/coffre`, `GET /api/appareil/elements`. Membre : `POST /api/elements`, `POST /api/elements/lot`, `PUT` et `DELETE /api/elements/:id`, `GET /api/destinataires`, `PUT /api/elements/:id/partages`. Administrateur : `/api/compte/admin/*`.
Données : comptes, sessions et journal (socle) ; coffres, éléments et partages, chiffrés dans le navigateur ; appareils reliés (nom, dates, empreinte du jeton) ; cache commun des logos. Extension de navigateur (`extension/`) : aucun script de contenu, aucune ressource exposée aux sites, permission sur le seul serveur relié, remplissage sur un clic ou le raccourci seulement. Sorties : sites dont un logo est demandé (HTTPS, adresses publiques), relais SMTP de l’exploitant. Tiers embarqués : @noble/hashes 2.4.0 (`web/vendor/PROVENANCE`), image `node:24.21.0-alpine` épinglée par empreinte, socle 25b09a6. Secrets : voir « Secrets inventory ».
