# Σ Life OS — Audit « production grade » et plan de mise à niveau

Date : 2026-09-30 · Base auditée : `guy2b/sum`, branche `feature/decision-os-wave-01` (commit `ec6b8f7`, 2026-07-29)

## 1. Verdict

**Σ Life OS n'est pas prêt pour la production.** Le projet est riche fonctionnellement et possède un vrai capital (moteurs de signaux, de décision, de planification, testés unitairement), mais :

1. il existe **des failles de sécurité exploitables aujourd'hui** (secret OAuth dans l'historique public, Premium auto-attribuable, règles Firestore trop larges) ;
2. **l'application réellement servie aux utilisateurs n'est pas celle qui est testée** : 95 des 96 modules vérifiés par `npm run check` ne sont pas chargés par `app.html` ;
3. l'application servie est un **empilement de ~130 fichiers chargés à la main**, sans build, sans CSP, sans monitoring, avec des données sensibles (santé, finances, journal) synchronisées en clair dans un seul document Firestore.

Le bon chemin n'est pas une réécriture totale, mais une **consolidation** : un seul runtime, construit à partir des moteurs testés, derrière un build, des tests E2E et une CI bloquante.

### À faire immédiatement (avant toute autre chose)

| #   | Action                                                                                                                                                                                                                               | Où                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| 1   | **Révoquer le secret client Google OAuth `GOCSPX-1dAE…`** et en générer un nouveau. Il a été commité le 2026-07-18 (commits `884eccc` / `23ae357`, fichier `firebase-config.js`) et reste lisible dans l'historique du dépôt public. | Google Cloud Console → APIs & Services → Credentials |
| 2   | Supprimer ou protéger la fonction `setBetaPremium` : tout utilisateur connecté peut se donner le Premium.                                                                                                                            | `functions/index.js:18`                              |
| 3   | Corriger la règle Firestore `users/{uid}/{document=**}` qui annule les `write: if false` des collections serveur.                                                                                                                    | `firestore.rules:79`                                 |

## 2. Périmètre et méthode

- **Versions examinées** : les 25 dossiers de `Documents\Digital Projects\lifeOS\` (V1 → V4.8.1) et le dépôt GitHub. Les dossiers locaux ne vont que jusqu'à la V4.8.1 et les dossiers V4.9.x sont vides. **GitHub est la seule source à jour** (≈ 460 sprints plus loin). Le dossier `C:\Dev\sum`, que le README désigne comme dépôt canonique, n'existe pas sur cette machine.
- **Exécuté** : `npm run check`, `npm test`, les 638 tests « sprint » `.mjs` et une analyse statique ciblée (chargement des scripts, règles, fonctions cloud, rendu HTML, stockage).
- **Non exécuté** : navigation réelle de l'app, flux OAuth réels, builds iOS/Android, audit des dépendances des backends Node.

## 3. État des lieux chiffré

| Indicateur                                             | Valeur                                                                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Fichiers suivis par git                                | 2 094                                                                                                   |
| Lignes JS / MJS / CSS / HTML                           | ≈ 35 400 / 9 900 / 14 600 / 10 400                                                                      |
| Scripts chargés par `app.html`                         | **111** (+ 21 feuilles de style)                                                                        |
| Poids du code propre chargé (non minifié)              | ≈ 1,16 Mo + 115 Ko de HTML                                                                              |
| Tests `npm test`                                       | ≈ 200, **tous verts**, mais sur du code **non utilisé par l'app**                                       |
| Tests « sprint » `.mjs`                                | 640, **jamais lancés par `npm test` ni la CI**, 637 ✔ / 3 ✖                                             |
| Numéros de version en circulation                      | `config.js` 4.6.0 · `package.json` 79.0.0 · service worker `v8003`                                      |
| Fichiers de patchs/backups/rapports de sprint commités | ≈ 160 (`.sigma-patches/`, `*.backup-*`, `README-SPRINTS-*`, `SIGMA-RELEASE-*`, `*.ps1`, `modules.zip`…) |

## 4. Constats détaillés

Sévérité : 🔴 critique · 🟠 majeur · 🟡 modéré

### 4.1 Sécurité

| Sév. | Constat                                                                                                                                                                                                                                                                                                        | Preuve                              | Correctif                                                                                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔴   | Secret client Google OAuth dans l'historique public                                                                                                                                                                                                                                                            | commits `884eccc`, `23ae357`        | Révoquer puis faire tourner la clé. Optionnellement, purger l'historique (`git filter-repo`), en sachant que la révocation est ce qui compte.                             |
| 🔴   | `setBetaPremium` : Premium auto-attribuable par n'importe quel compte                                                                                                                                                                                                                                          | `functions/index.js:18`             | Supprimer. Les droits ne doivent être écrits que par le webhook de paiement vérifié.                                                                                      |
| 🔴   | La règle `match /users/{uid}/{document=**}` autorise le propriétaire à **écrire partout** sous son UID, y compris `auditEvents`, `signals`, `actionRequests` et `socialProviders`, pourtant marqués `write: if false`. En Firestore, une seule règle `allow` suffit : le journal d'audit est donc falsifiable. | `firestore.rules:79-88`             | Remplacer le joker par une liste explicite des collections écrivables par le client, avec validation de schéma. Ajouter des tests de règles avec l'émulateur.             |
| 🟠   | Licences et Premium vérifiés côté navigateur (`state.license` dans `localStorage`, codes `SUM-DEMO-2026` / `SUM-OWNER-PREVIEW` dans `config.js` public)                                                                                                                                                        | `app.js:122-177`, `config.js:43-46` | Faire des droits (entitlements) une donnée serveur uniquement : Firestore en lecture seule, écrite par un webhook de paiement. Retirer les codes du bundle de production. |
| 🟠   | Aucune Content-Security-Policy. Chart.js chargé depuis un CDN sans `integrity` (SRI).                                                                                                                                                                                                                          | `app.html`, `firebase.json`         | Mettre une CSP stricte dans les en-têtes d'hébergement, auto-héberger Chart.js via le build.                                                                              |
| 🟠   | Échappement HTML incohérent : 101 `innerHTML` dans le code servi, 6 copies différentes de `escapeHtml`, des interpolations non échappées (ex. `identity.email` dans `google-consent-onboarding-v1.js:15`). Le courrier et les réseaux sociaux injectent du contenu tiers.                                      | `modules/**`                        | Un seul helper de rendu sûr (template tagué ou `textContent`), avec une règle de lint qui interdit `innerHTML` sans lui.                                                  |
| 🟠   | CORS : `socialProviders` renvoie l'`Origin` de la requête telle quelle (n'importe quel site est accepté)                                                                                                                                                                                                       | `functions/index.js:241`            | Mettre une liste blanche d'origines.                                                                                                                                      |
| 🟡   | Les règles Storage évaluent `request.resource.size` aussi en lecture : le propriétaire ne peut probablement pas relire ses fichiers. Aucun contrôle du type MIME.                                                                                                                                              | `storage.rules`                     | Séparer `read` et `write`, et contraindre `contentType`.                                                                                                                  |
| 🟡   | Jetons OAuth sociaux stockés en clair dans `socialPrivateTokens` (protégés par les règles, mais non chiffrés)                                                                                                                                                                                                  | `functions/index.js`                | Chiffrement applicatif avec Cloud KMS, ou Secret Manager par utilisateur.                                                                                                 |
| 🟡   | `healthImport` enregistre les objets reçus sans validation de schéma (`...row`)                                                                                                                                                                                                                                | `functions/index.js`                | Valider avec un schéma (zod/ajv), borner les champs.                                                                                                                      |

### 4.2 Architecture : deux produits dans un seul dépôt

- **Runtime A, celui que les utilisateurs utilisent** : `app.html` + 111 scripts globaux (`window.Sigma*`). Chaque sprint a ajouté un « loader » qui modifie le précédent (`*-v2-loader.js`, `runtime-firestore-hotfix-v1-loader.js`, `wave-01…03`…). On trouve des doublons fonctionnels : `coach.js` / `coach-v121.js`, `social.js` + 15 fichiers `social-*-v49x`, `decision-engine/` vs `decisions/`, `connectors/` vs `connectors-v3/`, les connecteurs Node à la racine _et_ dans `backend/`.
- **Runtime B, celui qui est testé** : des modules ES propres (`modules/signals`, `decisions`, `planning`, `connectors`, `application`, `api`…) couverts par `npm test`, mais consommés seulement par des pages de démo isolées (`product/*.html`, 28 « consoles » alimentées par des données fictives).

**Conséquence** : la couverture de tests donne une fausse assurance. Une régression dans le runtime A n'est détectée par rien.

**Cible** : un seul point d'entrée en modules ES, construit par Vite, où l'UI consomme la couche `application/` + `api/` du runtime B. Le runtime A est migré écran par écran, puis supprimé.

### 4.3 Données, vie privée, RGPD

- 🔴 **Données de santé = catégorie particulière (RGPD art. 9)**. Il faut un consentement explicite et séparé, une analyse d'impact (AIPD/DPIA) et un hébergement UE (la région `europe-west1` est déjà bien choisie). Les champs `legalEntity`, `supportEmail` et l'adresse légale sont vides.
- 🟠 Tout l'état de l'utilisateur (tâches, santé, finances, journal, messages) est écrit **en un seul document** `workspaces/{uid}` (`modules/firebase-cloud.js:54`). Il y a un risque d'atteindre la **limite de 1 Mio** d'un document Firestore, ce qui ferait échouer la synchronisation. Il n'y a ni résolution de conflits entre appareils, ni migration de schéma versionnée.
- 🟠 Pas de parcours complet « exporter mes données » / « supprimer mon compte et toutes mes données, y compris côté serveur ».
- 🟡 Pas de politique de rétention pour `socialOAuthStates`, `betaFeedback`, `healthMetrics`.

### 4.4 Qualité et tests

- 🟠 Aucun test de bout en bout du vrai parcours (onboarding → connexion Google → Aujourd'hui → action).
- 🟠 640 tests `.mjs` hors CI. 42 d'entre eux se limitent à `typeof x === 'function'`. 3 échouent : `UTF-8 global patch payload`, `restoration payload includes all original provider adapters`, `utf8-stabilization-v2/acceptance`.
- 🟡 Aucun linter, formateur ni typage (même via JSDoc + `tsc --checkJs`). Le script `check` est une chaîne de 96 `node --check` écrite à la main.
- 🟡 Pas de tests des règles Firestore/Storage (émulateur).

### 4.5 Performance et PWA

- 🟠 ≈ 130 requêtes, 1,16 Mo non minifié, tout chargé en `defer` au démarrage, même les écrans jamais ouverts. Cache-busting manuel (`?v=4810`, `?v=465479`…).
- 🟡 Le service worker est en network-first sans précache versionné : pas de vrai mode hors-ligne, et le nom du cache est décorrélé de la version.

### 4.6 Déploiement et exploitation

- 🟠 **Deux cibles d'hébergement** : GitHub Pages (`static.yml` publie `path: .`, soit **tout le dépôt**, backends, tests et backups compris) et Firebase Hosting (`public: "."`). Il n'y a pas d'environnements séparés dev/staging/prod.
- 🟠 Aucun monitoring d'erreurs (Sentry ou équivalent) ni alerte sur les Cloud Functions.
- 🟡 La CI (`quality.yml`) tourne sur Node 20, alors que le développement se fait en Node 24. Pas de protection de branche. La branche `feature/decision-os-wave-01` n'est pas mergée depuis 2 mois.
- 🟡 Les numéros de version incohérents rendent le support et le rollback impossibles à tracer.

### 4.7 Hygiène du dépôt

À retirer du suivi git (≈ 160 fichiers) : `.sigma-patches/`, `*.backup-*`, `README-SPRINTS-*`, `README-HOTFIX-*`, `SIGMA-*.json`, `UPLOAD-*.txt`, `APPLY-*.ps1`, `ROLLBACK-*.ps1`, `tools/SYNC-*.ps1`, `modules.zip`, `tree`, `t:intelligence`, `legacy/`, `legacy-render/`, les connecteurs en double à la racine. On garde un seul `CHANGELOG.md`.

## 5. Plan de mise à niveau

Chaque phase a un **critère de sortie** vérifiable. Les estimations supposent une personne à temps plein avec assistance IA. Elles sont indicatives.

### Phase 0 — Urgences sécurité · ½ à 1 jour

- Révoquer et faire tourner le secret Google. Vérifier les journaux d'accès OAuth de la période.
- Supprimer `setBetaPremium`. Réécrire `firestore.rules` et `storage.rules` avec des collections explicites.
- Ajouter une liste blanche CORS dans les fonctions.
- Mettre en place des tests de règles avec l'émulateur Firebase.

**Sortie** : aucun secret dans l'arbre courant (scan `gitleaks` vert), tests de règles verts, fonctions redéployées.

### Phase 1 — Assainir le dépôt · 1 à 2 jours

- Merger `feature/decision-os-wave-01` → `main`, puis protéger `main` (PR + CI obligatoires).
- Supprimer les fichiers listés en 4.7. Créer un `.gitignore` propre et dédupliqué.
- Une seule source de version (`package.json`), injectée dans l'app et le service worker au build.
- Mettre ESLint + Prettier, et intégrer les tests `.mjs` utiles dans `npm test` (supprimer ceux qui ne testent que `typeof`, corriger les 3 en échec).

**Sortie** : moins de 700 fichiers suivis, `npm run verify` = lint + tous les tests, CI verte sur Node 22 LTS.

### Phase 2 — Un seul runtime · 2 à 4 semaines (la plus importante)

- Introduire **Vite** : point d'entrée ES module unique, découpage par écran (lazy-load), minification, hash des fichiers, Chart.js via npm.
- Définir le **périmètre V1** (voir §6) et migrer écran par écran vers la couche `modules/application` + `modules/api` : Aujourd'hui → Attention → Plan → Sources → Coach → Réglages.
- Un seul helper de rendu sûr. Supprimer les loaders et les modules `-vN` au fur et à mesure.
- Ajouter `// @ts-check` + `tsc --noEmit` sur les modules métier (typage progressif sans réécriture en TypeScript).

**Sortie** : `app.html` charge un seul bundle, moins de 300 Ko gzip au premier écran. Les dossiers `product/*-loader.js` et les modules legacy ont disparu.

### Phase 3 — Tests de bout en bout et qualité · 1 semaine (en parallèle de la phase 2)

- **Playwright** : onboarding, création de tâche, synchronisation cloud (émulateur), bascule d'édition, i18n ×4, mode hors-ligne, mobile 375 px.
- Accessibilité automatisée (axe-core) sur chaque écran. Budget Lighthouse en CI (Perf ≥ 90, A11y ≥ 95).

**Sortie** : les parcours critiques sont couverts en CI, et une régression d'UI bloque le merge.

### Phase 4 — Données et RGPD · 1 à 2 semaines

- Découper `workspaces/{uid}` en sous-collections par domaine, avec horodatage par document et fusion « last-write-wins » par champ. Ajouter des migrations de schéma versionnées.
- Consentement santé explicite et séparé. Rédiger l'AIPD. Mettre à jour les mentions légales (entité, adresse, contact DPO/support).
- Fonctions `exportMyData` et `deleteMyAccount` (Auth + Firestore + Storage + jetons sociaux). TTL Firestore sur les collections temporaires.
- Chiffrer les jetons OAuth avec Cloud KMS.

**Sortie** : export et suppression testés de bout en bout, documents largement sous 1 Mio, AIPD rédigée.

### Phase 5 — Exploitation · 3 à 5 jours

- Firebase Hosting comme seule cible (abandon de GitHub Pages). Deux projets Firebase, `staging` et `prod`, et des déploiements par CI via les environnements GitHub.
- En-têtes de sécurité (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`).
- Sentry (front + fonctions) avec suppression des données personnelles. Alertes Cloud Monitoring sur les erreurs et la latence des fonctions. App Check sur les fonctions appelables.
- Service worker via Workbox (précache versionné, mise à jour contrôlée).

**Sortie** : un tag `vX.Y.Z` déploie automatiquement en staging puis en prod après validation manuelle. Rollback en une commande.

### Phase 6 — Ouverture commerciale · 1 semaine + délais externes

- Paiement (Lemon Squeezy ou Stripe) → webhook signé → `entitlements/{uid}` écrit par le serveur uniquement.
- `npm run release:check` vert : admin QA désactivé, codes démo retirés du bundle de prod, URL légales et de support renseignées.
- Validations fournisseurs : écran de consentement OAuth Google vérifié (les scopes Gmail sont « restreints », ce qui demande un audit de sécurité CASA), produits LinkedIn/X/TikTok approuvés.

**Sortie** : premier client payant en production.

> Le mobile (Capacitor, HealthKit, Health Connect) est **hors de ce plan**. Il devrait venir après la phase 5, sur la base d'une PWA stabilisée.

## 6. Décisions à prendre par toi

1. **Périmètre V1** : quelles éditions (Student, Solo, Creator, Life, Nomad…) et quels connecteurs au lancement ? Recommandation : 1 à 2 éditions, Google (Gmail + Agenda) et Microsoft seulement. Les connecteurs sociaux passent en V1.1 car ils dépendent d'approbations externes.
2. **Scopes Gmail** : lire le contenu des e-mails impose l'audit CASA de Google (coût et délai). Alternative : se limiter aux métadonnées au lancement.
3. **Hébergement** : je recommande de confirmer Firebase Hosting + `europe-west1` et d'abandonner GitHub Pages.
4. **Fournisseur de paiement** : Lemon Squeezy (merchant of record, TVA gérée) ou Stripe.
5. **Historique git** : purger le secret de l'historique, ce qui oblige à réécrire l'historique et à forcer le push, ou se contenter de la révocation.

## 7. Ce qui est déjà bien et doit être conservé

- Les moteurs métier en modules ES (`signals`, `decisions`, `planning`, `attention`, `connectors/universal-connector-core`) : conçus proprement et testés.
- Le principe « validation humaine avant toute action externe ».
- La région Firebase UE, les collections serveur de jetons fermées au client, le flux PKCE et le `state` OAuth côté serveur.
- La traduction en 4 langues avec contrôle de parité des clés.
- Le script `release:check`, qui bloque déjà une mise en vente non configurée.
