# Connecteurs : configuration fournisseur par fournisseur

Chaque connecteur reste affiché « Non configuré » tant que ses identifiants ne sont pas fournis. Σ ne simule jamais une connexion.

| Connecteur                   | Où s'exécute-t-il                    | Données                                                                      | Configuration                     | Approbation externe                                                                                |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Gmail                        | Navigateur (jeton court, en mémoire) | 40 derniers messages de la boîte de réception, 21 jours, en-têtes et extrait | `VITE_GOOGLE_CLIENT_ID`           | **Oui** : `gmail.readonly` est un scope _restreint_ → vérification Google + audit de sécurité CASA |
| Google Agenda                | Navigateur                           | Événements, −1 à +60 jours, lecture seule                                    | idem                              | Vérification de l'écran de consentement (scope sensible)                                           |
| YouTube                      | Navigateur                           | Fils de commentaires de votre chaîne                                         | idem                              | Vérification (scope sensible)                                                                      |
| Google Drive                 | Navigateur                           | Sauvegarde dans le dossier privé `appDataFolder`                             | idem                              | Non (scope non sensible)                                                                           |
| Outlook / Microsoft 365      | Navigateur (MSAL, PKCE)              | Mail, agenda, contacts en lecture seule                                      | `VITE_MICROSOFT_CLIENT_ID`        | Vérification d'éditeur recommandée                                                                 |
| Yahoo, GMX, iCloud, IMAP     | Cloud Function (Pro)                 | 40 derniers messages de l'INBOX, jamais stockés côté serveur                 | secret `CONNECTOR_ENCRYPTION_KEY` | Non (l'utilisateur crée un mot de passe d'application)                                             |
| LinkedIn                     | Cloud Function (Pro)                 | Profil (OpenID Connect)                                                      | `LINKEDIN_CLIENT_ID` + secret     | Publications et commentaires : programme partenaire _Community Management API_                     |
| X                            | Cloud Function (Pro)                 | Profil et mentions                                                           | `X_CLIENT_ID` + secret            | Mentions : offre API payante (Basic ou supérieure)                                                 |
| TikTok                       | Cloud Function (Pro)                 | Profil, vidéos et compteurs                                                  | `TIKTOK_CLIENT_KEY` + secret      | Audit d'application TikTok (Login Kit + Display API)                                               |
| Facebook / Instagram         | —                                    | —                                                                            | —                                 | **Non disponible** : nécessite l'App Review Meta ; affiché « En attente d'approbation »            |
| Apple Santé / Health Connect | Appli mobile                         | Résumés quotidiens (sommeil, pas, activité, FC repos)                        | voir `docs/MOBILE.md`             | Revue App Store (HealthKit) et déclaration Health Connect sur Google Play                          |

## Google (client OAuth Web)

1. Google Cloud Console → APIs & Services → activer _Gmail API_, _Google Calendar API_, _YouTube Data API v3_ et _Google Drive API_.
2. Écran de consentement : type _External_, domaines autorisés, liens vers `/legal/privacy.html` et `/legal/terms.html`. Scopes : `gmail.readonly`, `calendar.readonly`, `youtube.force-ssl`, `drive.appdata`.
3. Identifiants → _OAuth client ID_ → _Web application_ ; origines JavaScript : `https://votre-domaine`, `http://localhost:5173`. Aucune URI de redirection n'est nécessaire (modèle _token_).
4. `VITE_GOOGLE_CLIENT_ID=<id>.apps.googleusercontent.com`. **Aucun secret client côté web.**
5. Tant que l'application n'est pas vérifiée, seuls les _test users_ déclarés peuvent se connecter (100 maximum).

> Pour lancer plus vite, on peut retirer temporairement Gmail et garder Agenda, Drive et Outlook : la vérification des scopes sensibles est bien plus légère que celle d'un scope restreint.

## Microsoft Entra

1. _App registrations_ → New → comptes « tout annuaire + comptes Microsoft personnels ».
2. Plateforme **Single-page application** ; URI de redirection : `https://votre-domaine/app.html` et `http://localhost:5173/app.html`.
3. _API permissions_ (délégué) : `User.Read`, `Mail.Read`, `Calendars.Read`, `Contacts.Read`.
4. `VITE_MICROSOFT_CLIENT_ID=<Application ID>`.
5. Pour la connexion au compte Σ via Microsoft : Firebase Authentication → fournisseur Microsoft, avec un secret client **côté Firebase uniquement**.

## LinkedIn, X, TikTok

URI de redirection unique pour les trois : `https://votre-domaine/api/oauth/callback`, relayée par Hosting vers la fonction `socialOAuthCallback`.

- **LinkedIn** : produit _Sign In with LinkedIn using OpenID Connect_, scopes `openid profile email`.
- **X** : _User authentication settings_ → OAuth 2.0, type _Web App (confidential)_, scopes `tweet.read users.read offline.access`.
- **TikTok** : Login Kit + Display API, scopes `user.info.basic video.list`.

Activer ensuite côté web : `VITE_SOCIAL_LINKEDIN_ENABLED=true` (et l'équivalent pour X et TikTok).

## Lemon Squeezy (paiement)

1. Créer le produit « Σ Pro » avec deux variantes : mensuelle (8,90 €) et annuelle (69 €).
2. Liens de checkout de chaque variante → `VITE_CHECKOUT_MONTHLY_URL` / `VITE_CHECKOUT_ANNUAL_URL`. L'application y ajoute `checkout[custom][uid]`.
3. _Settings → Webhooks_ : URL `https://votre-domaine/api/billing/lemonsqueezy`, un secret identique à `LEMONSQUEEZY_WEBHOOK_SECRET`, et les événements `subscription_*`.
4. Tester en _test mode_ (`VITE_PAYMENT_MODE=test`), puis passer en `live`. `release:check` bloque la mise en vente sans le mode `live`.
