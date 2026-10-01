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

## Ce qui diffère de la version web (v1)

- Connexion : e-mail + mot de passe. Google et Microsoft bloquent leurs fenêtres de connexion dans une app (WebView) : à ajouter avec une connexion native.
- Gmail, Outlook, agendas Google/Microsoft et réseaux sociaux : version web seulement pour l'instant. La messagerie IMAP (Yahoo…) fonctionne (origine `https://localhost` autorisée côté API Netlify).
- Pas de service worker : l'app embarque ses fichiers ; les mises à jour passent par le Play Store.
- Bouton retour Android : revient en arrière dans l'app, quitte depuis le premier écran.
- Sauvegarde Android désactivée (`allowBackup=false`) : les données restent locales, comme promis dans la politique de confidentialité.

## Santé (plus tard)

Le pont Health Connect (Samsung Health, Galaxy Watch…) et HealthKit est conservé dans `mobile/native/` ; `npm run health:patch` l'intègre. Il demande la déclaration Health Connect sur Google Play : prévu dans une mise à jour, pas dans la v1.
