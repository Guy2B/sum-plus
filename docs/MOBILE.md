# Applications mobiles (Capacitor 8)

L'app Android (et plus tard iOS) embarque le build web de production, avec **l'app** (`app.html`) comme page d'accueil : elle s'ouvre directement sur Aujourd'hui.

- Identifiant : **`com.algbr.lifeos`** (définitif une fois publié sur Google Play).
- Android cible : API 36 (Android 16), minimum API 24.
- Icône et écran de démarrage générés depuis le Σ de l'app (`mobile/scripts/make-assets.mjs`).

## Construire — dans le cloud (GitHub Actions)

Le workflow `.github/workflows/android.yml` tourne à chaque push sur `main` qui touche l'app ou `mobile/`, ou à la main (Actions → Android → Run workflow) :

1. **APK de test** (`sigma-android-apk`) : à télécharger depuis l'onglet Actions et à installer sur un téléphone (autoriser « sources inconnues »).
2. **AAB signé pour Google Play** (`sigma-android-aab`) : produit seulement quand les secrets de la clé d'envoi existent :
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.

Le numéro de version Android (`versionCode`) est le numéro d'exécution du workflow ; le nom de version vient de `package.json`.

## En local (facultatif)

```bash
cd mobile
npm ci
npm run sync           # build web + www + cap sync android
npm run open:android   # Android Studio (JDK 21)
npm run assets         # régénère icônes et splash
```

## Connexion native (Google, Microsoft)

Google et Microsoft refusent la connexion dans un WebView. L'app utilise `@capacitor-firebase/authentication` (option `skipNativeAuth`) :

- **Google** : sélecteur de comptes du téléphone → jeton d'identité → session Firebase JavaScript (la même que sur le web). Gmail / Google Agenda / Drive : écran d'autorisation Android pour les scopes demandés → jeton d'accès (1 h, en mémoire).
- **Microsoft** : connexion dans un onglet de navigateur → jeton Microsoft Graph pour Outlook, agenda et contacts (1 h, en mémoire). La connexion d'un **compte Σ** par Microsoft reste sur le web : Firebase n'accepte pas les jetons Microsoft obtenus hors navigateur.
- App Android déclarée dans Firebase (`google-services.json`) avec les empreintes de la **clé de test fixe** (`app/debug.keystore`, publique par convention) et de la **clé d'envoi** (hors dépôt, `lifeOS/android-keys/`).
- **À la première publication sur Google Play** : ajouter dans Firebase (Paramètres du projet → app Android → Ajouter une empreinte) les empreintes SHA-1 et SHA-256 de la **clé de signature d'application** affichées par Play Console (Intégrité de l'app), sinon la connexion Google échoue pour les utilisateurs du Play Store.

## Ce qui diffère de la version web

- Réseaux sociaux (LinkedIn, X, TikTok) : connexion depuis la version web (redirections OAuth hors de l'app).
- Pas de service worker : l'app embarque ses fichiers ; les mises à jour passent par le Play Store.
- Bouton retour Android : revient en arrière dans l'app, quitte depuis le premier écran.
- Sauvegarde Android désactivée (`allowBackup=false`).

## Santé (plus tard)

Le pont Health Connect (Samsung Health, Galaxy Watch…) et HealthKit est conservé dans `mobile/native/` ; `npm run health:patch` l'intègre. Il demande la déclaration Health Connect sur Google Play : prévu dans une mise à jour, pas dans la v1.
