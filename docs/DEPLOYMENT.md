# Déploiement et exploitation

## 0. Avant tout : secret compromis

Le secret client Google OAuth `GOCSPX-…` a été publié dans l'historique de l'ancien dépôt `guy2b/sum`. **Révoquez-le** : Google Cloud Console → APIs & Services → Credentials → client OAuth Web → _Reset secret_. Ce nouveau dépôt ne contient aucun secret (vérifié par gitleaks en CI et par `release:check`).

## Mise en ligne statique actuelle (sans backend)

La version actuelle est publiée sur **https://sum-plus.web.app**, un site d'hébergement séparé du projet `project-sum-b961a` (le site principal et les règles Firestore de l'ancienne application ne sont pas modifiés). Toutes les fonctions locales sont disponibles ; le compte, la synchronisation, les connecteurs et le paiement affichent « Non configuré » jusqu'au déploiement complet décrit ci-dessous.

```bash
npm run deploy:static
```

## 1. Projets Firebase

Deux projets : `staging` et `production` (alias dans `.firebaserc`, à adapter).

Pour chacun :

1. Plan **Blaze** (requis pour Cloud Functions et Secret Manager).
2. **Authentication** : activer Google, Microsoft et E-mail/Mot de passe. Ajouter votre domaine dans _Authorized domains_.
3. **Firestore** en mode natif, région `eur3` ou `europe-west1`.
4. **App Check** : créer une clé reCAPTCHA Enterprise pour le domaine web, l'enregistrer dans App Check, puis activer l'_enforcement_ sur Firestore et Functions après vérification.
5. **Application web** : récupérer la configuration publique → variables `VITE_FIREBASE_*`.
6. **TTL Firestore** (en complément du job `housekeeping`) :
   ```bash
   gcloud firestore fields ttls update expiresAt --collection-group=oauthStates --enable-ttl
   gcloud firestore fields ttls update expiresAt --collection-group=rateLimits --enable-ttl
   ```

## 2. Secrets et paramètres des Functions

```bash
# 32 octets aléatoires, base64 — chiffrement des identifiants de connecteurs. Ne jamais le changer sans migration.
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | firebase functions:secrets:set CONNECTOR_ENCRYPTION_KEY --data-file=-
firebase functions:secrets:set LEMONSQUEEZY_WEBHOOK_SECRET
firebase functions:secrets:set LINKEDIN_CLIENT_SECRET   # si LinkedIn est utilisé
firebase functions:secrets:set X_CLIENT_SECRET          # si X est utilisé
firebase functions:secrets:set TIKTOK_CLIENT_SECRET     # si TikTok est utilisé
```

Paramètres non secrets : créer `functions/.env.<projectId>` (non commité) :

```
PUBLIC_APP_URL=https://app.votre-domaine.com
ALLOWED_ORIGINS=https://staging.votre-domaine.com
LINKEDIN_CLIENT_ID=
X_CLIENT_ID=
TIKTOK_CLIENT_KEY=
```

Un secret non utilisé doit quand même exister (valeur vide acceptée : `echo -n "" | firebase functions:secrets:set …`), car il est déclaré par les fonctions.

## 3. Variables de l'application web

Liste complète et commentée : `apps/web/.env.example`. En local : `apps/web/.env.local`. En CI : **variables d'environnement GitHub** (`staging`, `production`) portant les mêmes noms. Toutes sont publiques par nature (identifiants, liens) : aucun secret.

## 4. Premier déploiement manuel

```bash
npm ci
npm run verify
npm run build
firebase use staging
firebase deploy            # hosting + functions + rules
npm run admin:grant -- vous@exemple.com --project <projectId>   # console Admin QA
```

Contrôler ensuite _Compte → Admin QA → Lancer le diagnostic_.

## 5. CI/CD

- `ci.yml` à chaque push/PR : lint, format, types, tests, build, E2E Playwright, tests des règles (émulateur), Lighthouse (perf ≥ 90, a11y ≥ 95), gitleaks, `npm audit`.
- `deploy.yml` sur tag `vX.Y.Z` : staging automatiquement, puis production après approbation (configurer des _required reviewers_ sur l'environnement GitHub `production`).
- Authentification GCP par **Workload Identity Federation** (aucune clé de compte de service) : secrets GitHub `GCP_WORKLOAD_IDENTITY_PROVIDER` et `GCP_DEPLOY_SERVICE_ACCOUNT`. Rôles du compte de service : Firebase Admin, Cloud Functions Admin, Service Account User, Secret Manager Secret Accessor.
- Protéger `main` : PR obligatoire et checks CI requis.

Publier une version :

```bash
npm version minor -m "release %s"   # met à jour package.json (seule source de version)
git push --follow-tags
```

## 6. Surveillance et alertes

- Erreurs client : entrées `client-error` dans Cloud Logging (sans e-mail, jeton ni contenu).
- Créer dans Cloud Monitoring :
  - une métrique basée sur les logs `severity>=ERROR` des Functions, avec une alerte au-delà de 10/5 min ;
  - une alerte sur la latence p95 de `imapSync`/`socialSync` > 20 s ;
  - une alerte sur les réponses 401 du webhook de paiement (signature invalide = mauvaise configuration ou attaque).
- Budget GCP avec alertes à 50 / 90 / 100 %.

## 7. Retour arrière

- Hosting : Firebase Console → Hosting → _Release history_ → Rollback (instantané).
- Functions : redéployer le tag précédent (`git checkout vX.Y.(Z-1) && firebase deploy --only functions`).
- Règles : `firebase deploy --only firestore:rules` depuis le tag précédent.
- Données : activer la _Point-in-time recovery_ Firestore (7 jours) et des exports planifiés :
  ```bash
  gcloud firestore databases update --database='(default)' --enable-pitr
  ```

## 8. Mise en vente

`npm run release:check` doit passer : paiement `live`, liens de checkout HTTPS, identité légale, e-mail de support, App Check, URL publique, aucun secret dans le bundle. Faire relire les pages légales (`apps/web/legal`) et l'AIPD (`docs/PRIVACY.md`) par un juriste.
