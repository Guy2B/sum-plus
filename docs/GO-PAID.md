# Passer de la bêta au payant

Σ a deux états commerciaux pilotés par **un seul réglage** côté app (`VITE_OPEN_ACCESS`) et **un seul** côté règles Firestore (`openAccess()`). Ils doivent basculer **ensemble**, dans le même déploiement.

| | Bêta (aujourd'hui) | Payant |
|---|---|---|
| Accès | Pro offert à tous | Free limité, Pro payant |
| Menu | « Σ Pro offert pendant la bêta » | « Passer à Σ Pro → » |
| Limites Free (Coach 5/j, 1 projet, 3 habitudes) | jamais visibles | message + « Voir Σ Pro » |
| Fenêtre Pro | annonce bêta + offre Fondateur | choix annuel / mensuel → paiement |
| Question prix (J14) | posée une fois | désactivée |
| Comptage Fondateur | actif (comptes connectés) | arrêté |

## 1. Lemon Squeezy (à faire par vous)
1. Créer le compte et le store, compléter la vérification d'identité et les informations fiscales.
2. Créer le produit **Σ Pro** avec deux variantes : 8,90 €/mois et 69 €/an (TTC).
3. Récupérer les deux **liens de paiement** (« Share » → checkout URL).
4. Créer le code de réduction **Fondateur** :
   - type « repeating », **60 mois** (5 ans) — vérifier que Lemon Squeezy accepte cette durée ;
   - montant : ramène l'annuel à **39 €** et le mensuel à **4,90 €** (si un seul code ne peut pas faire les deux, créer deux codes, ou à défaut deux variantes « Fondateur » accessibles par lien privé) ;
   - **100 utilisations maximum**, limité au produit Σ Pro.
5. Créer un **webhook** vers `https://sum-plus-api.netlify.app/api/lemonsqueezy` (événements `subscription_*`) et noter le **secret de signature**.

## 2. Webhook sur Netlify (lot C, code à écrire)
- Porter `functions/src/handlers/billing.ts` (webhook signé) dans `functions/src/netlify.ts` comme requête `lemonsqueezy`.
- Variable Netlify : `LEMONSQUEEZY_WEBHOOK_SECRET`.
- Le webhook est **la seule** source de vérité : il écrit `entitlements/{uid}`. L'app ne s'accorde jamais Pro elle-même.
- Ajouter l'événement serveur « achat » dans Analytics (carte Free → Pro, colonne « Achats »).

## 3. Bascule (un seul commit)
- `apps/web/.env.production` :
  - `VITE_OPEN_ACCESS=` (vide)
  - `VITE_PAYMENT_MODE=live`
  - `VITE_CHECKOUT_MONTHLY_URL=…` et `VITE_CHECKOUT_ANNUAL_URL=…`
- `firestore.rules` : `openAccess()` → `return false; // OPEN_ACCESS`
- Annoncer la fin de la bêta **au moins 30 jours avant** (Conditions §4 « Phase bêta »).

## 4. Fondateurs
1. Dans Analytics → Free → Pro : nombre de comptes éligibles (≥ 14 jours).
2. Exporter les éligibles depuis la collection `founders` (activeDays ≥ 14), triés par `firstSeen`, 100 premiers.
3. Leur communiquer le code (e-mail du compte). Validité : **60 jours** après l'ouverture des paiements.
4. **60 jours après l'ouverture**, supprimer la collection `founders` (Politique de confidentialité §14).
5. À 4 ans et 9 mois de chaque abonnement Fondateur : prévenir de la fin du tarif (au moins 30 jours avant).

## 5. Vérifications après bascule
- Un compte Free voit les limites et la fenêtre de paiement ; un paiement test (mode test Lemon Squeezy) passe le compte en Pro via le webhook.
- Analytics : offres vues → clics → paiements ouverts → achats, par déclencheur.
