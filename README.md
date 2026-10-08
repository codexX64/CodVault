# SÉSAME

Gestionnaire de mots de passe sous le Hub. Chaque compte a son coffre :
identifiants avec générateur, codes A2F (TOTP), notes sécurisées. On importe
depuis Bitwarden, Chrome, Edge, Firefox ou Safari, et on partage un élément
avec un autre compte de la même instance.

Le chiffrement se fait dans le navigateur. Le serveur ne reçoit que des blocs
chiffrés et ne peut lire ni les mots de passe, ni les notes, ni les secrets
A2F, ni les favoris. Ce qu'il voit malgré tout est écrit dans
[web/confidentialite.txt](web/confidentialite.txt).

## Le chiffrement

Tout est dans [web/crypto.js](web/crypto.js), sur le WebCrypto du navigateur.

Le mot de passe maître est étiré par Argon2id (64 Mio, 3 passes, 4 voies,
sel propre au coffre) puis passe par HKDF pour donner la clé qui enveloppe la
clé du coffre, 32 octets tirés au hasard. Une clé de récupération, elle aussi
de 32 octets, enveloppe la même clé : elle est montrée une fois, en base 32,
et rouvre le coffre si le mot de passe maître est perdu. Sans l'un ni
l'autre, personne ne rouvre le coffre, pas même l'administrateur.

Chaque élément a sa propre clé, enveloppée par la clé du coffre, et chaque
bloc est scellé en AES-256-GCM avec des données associées qui le lient à sa
place (compte, élément, destinataire) : un bloc déplacé par le serveur ne
s'ouvre pas. Un partage enveloppe la clé de l'élément pour la clé publique du
destinataire (ECDH P-256 éphémère, HKDF, AES-256-GCM) ; l'empreinte de cette
clé publique se compare de vive voix avant un partage sensible.

Argon2id vient de [@noble/hashes](web/vendor/PROVENANCE) 2.4.0, servi tel
que publié, empreintes vérifiées par les essais. Le serveur refuse une
enveloppe sous le plancher (19 Mio, 2 passes, 1 voie), et un coffre créé avec
des paramètres plus faibles que la cible est réenveloppé au déverrouillage
suivant.

## Les logos

Le navigateur montre d'abord les initiales du site, puis son logo si le
serveur en a un. Le serveur va le chercher lui-même sur le site (jamais
auprès d'un service tiers), en HTTPS, seulement vers une adresse publique :
chaque adresse résolue est contrôlée puis épinglée pour la connexion, les
redirections aussi. L'icône reçue est décodée (PNG, ou ICO contenant un PNG
ou un BMP), ramenée à 64 px et réencodée en PNG par
[src/image.js](src/image.js) : ce qui est servi n'a de l'original que ses
pixels. `SESAME_LOGOS=non` coupe toute requête sortante.

## Installation

Depuis le Hub (0.9.13 ou plus) : Catalogue → SÉSAME. Les comptes se créent
depuis le Hub, par son lien de création : installé par le Hub, SÉSAME
n'ouvre aucune page de premier lancement.

Seul, sans le Hub : `docker compose up -d --build`, avec un `.env` (voir
[.env.example](.env.example)). Le jeton d'installation du premier compte
s'affiche dans `docker compose logs sesame`.

SÉSAME doit être servi en HTTPS, ou ouvert sur `localhost` : hors d'un
contexte sûr, le navigateur ne donne ni WebCrypto ni les clés d'accès.

## Plafonds

Par coffre : 5 000 éléments (`SESAME_MAX_ELEMENTS`) et 64 Mio chiffrés
(`SESAME_MAX_MIO`). Un élément chiffré pèse au plus 100 Kio environ ; un
import compte au plus 500 éléments.

## Essais

```
npm test
cd socle && node --disable-warning=ExperimentalWarning --test test/*.test.js
```

Les essais tournent aux paramètres de production d'Argon2id, sans réglage
abaissé : une quarantaine de secondes. `node outils/parcours-navigateur.mjs`
parcourt l'interface dans Chromium (Playwright requis) contre
`node outils/vitrine.mjs`, et contrôle la mise en page à sept largeurs, de 360 à 1920 px.

## Sécurité

[SECURITY.md](SECURITY.md) donne l'état de chaque contrôle du référentiel
Codex64. Une faille se signale en privé :
https://github.com/CodexX64/sesame/security/advisories/new
