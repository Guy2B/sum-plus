# Applications mobiles (Capacitor 7)

Les applications iOS et Android embarquent le même build web (`apps/web/dist`) et ajoutent un pont santé natif :

- **iOS** : Apple Santé / Apple Watch via HealthKit (`mobile/native/ios/SigmaHealthPlugin.swift`).
- **Android** : Health Connect (`mobile/native/android/SigmaHealthPlugin.kt`), qui agrège aussi **Samsung Health et Galaxy Watch**. Le SDK propriétaire Samsung n'est donc plus nécessaire.

Données lues : résumés quotidiens (sommeil, pas, minutes d'activité, fréquence cardiaque au repos), en lecture seule, après autorisation système **et** consentement dans Σ.

## Construire

```bash
cd mobile
npm ci
npm run sync            # build web + cap sync + intégration native (idempotente)
npm run open:android    # Android Studio (JDK 17, SDK 35)
npm run open:ios        # Xcode 16 sur macOS (puis: cd ios/App && pod install)
```

`scripts/install-native.mjs` (relancé par `sync`) :

- **Android** : Kotlin, dépendances Health Connect et coroutines, `minSdk 26`, permissions `health.READ_*`, points d'entrée de la politique de confidentialité (Android 13 et 14+), enregistrement du plugin, sauvegardes désactivées.
- **iOS** : ajout du plugin et d'un `SigmaBridgeViewController` à la cible Xcode, entitlement et capacité HealthKit, texte `NSHealthShareUsageDescription`.

## Publication

- **App Store** : activer HealthKit dans l'App ID, fournir la politique de confidentialité, déclarer les données de santé dans _App Privacy_. HealthKit interdit la publicité et la revente de ces données.
- **Google Play** : remplir la déclaration _Health Connect_ (justification de chaque permission) et la section _Data safety_.
- Signature : clés de publication gérées hors dépôt (Play App Signing, certificats Apple).

## État de vérification

Les projets natifs sont générés et câblés, mais **n'ont pas été compilés** dans l'environnement de développement actuel (pas de SDK Android ni de Xcode). À vérifier sur un appareil réel : l'autorisation HealthKit, les permissions Health Connect et l'import de 14 jours depuis l'écran Santé.
