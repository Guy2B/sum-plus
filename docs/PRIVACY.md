# Vie privée : registre des traitements et analyse d'impact (AIPD)

> Document de travail préparé par l'équipe technique. Il doit être complété (responsable de traitement, DPO éventuel) et **validé par un juriste avant la mise en vente**.

## 1. Registre des traitements (art. 30 RGPD)

| Traitement                   | Données                                                              | Base légale                                                  | Où                                                           | Conservation                                             |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------- |
| Usage local de l'application | Tâches, projets, agenda, journal, finances, apprentissages, réglages | Hors champ serveur (données sur l'appareil de l'utilisateur) | IndexedDB du navigateur                                      | Jusqu'à l'effacement par l'utilisateur                   |
| Compte                       | E-mail, nom affiché, UID, fournisseur de connexion                   | Contrat (art. 6-1-b)                                         | Firebase Auth (Google Cloud)                                 | Durée du compte                                          |
| Synchronisation Pro          | Copies des enregistrements synchronisables                           | Contrat                                                      | Firestore `europe-west1`                                     | Durée du compte ; purge à la suppression                 |
| Données de santé             | Sommeil, énergie, stress, pas, activité, FC de repos                 | **Consentement explicite** (art. 9-2-a)                      | Appareil ; Firestore seulement si sync + consentement        | Jusqu'au retrait du consentement (suppression immédiate) |
| Abonnement                   | Statut, dates, identifiant d'abonnement, lien du portail client      | Contrat, obligations légales                                 | Firestore `entitlements` ; Lemon Squeezy (marchand officiel) | Durée légale comptable chez Lemon Squeezy                |
| Connecteurs serveur          | Mots de passe d'application et jetons OAuth (chiffrés)               | Contrat                                                      | Firestore `private/` (inaccessible aux clients)              | Jusqu'à la déconnexion ou la suppression du compte       |
| Journaux techniques          | Erreurs expurgées, journal d'audit (actions, sans contenu)           | Intérêt légitime (sécurité)                                  | Cloud Logging, Firestore `auditLog`                          | 30 jours (logs) ; audit : 12 mois recommandés            |

Contenus jamais stockés côté serveur : les e-mails (Gmail, Outlook, IMAP), les interactions sociales, l'historique du Coach.

## 2. Nécessité et proportionnalité

- **Minimisation.** Seuls des résumés quotidiens de santé sont lus. Pour les mails, on garde en-têtes et extrait, jamais le corps complet. Pour les mineurs, un prénom et un contexte scolaire suffisent.
- **Local d'abord.** Sans compte, aucune donnée ne quitte l'appareil.
- **Contrôle.** Chaque domaine peut être exclu de l'analyse (_Mon contexte_). Chaque source peut être déconnectée, ce qui purge ses données locales.
- **Transparence.** Chaque recommandation affiche ses raisons, ses incertitudes et ses sources.
- **Pas de décision automatisée** au sens de l'art. 22 : Σ propose, l'utilisateur décide ; aucune action externe n'est exécutée sans lui.
- **Pas de profilage des enfants** ni d'évaluation des candidats (module Carrière).

## 3. Droits des personnes

| Droit                         | Mise en œuvre                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accès et portabilité          | _Compte → Données → Exporter (JSON)_ (local) et _Exporter mes données cloud_ (fonction `exportMyData`)                                                              |
| Rectification                 | Édition directe dans l'application                                                                                                                                  |
| Effacement                    | _Effacer cet appareil_ ; _Supprimer mon compte_ (fonction `deleteMyAccount` : données, identifiants de connecteurs, états OAuth, droits, compte d'authentification) |
| Retrait du consentement santé | Écran Santé → _Retirer mon consentement_ (suppression immédiate)                                                                                                    |
| Opposition / limitation       | Désactivation par domaine, déconnexion des sources                                                                                                                  |

## 4. Risques et mesures (AIPD)

| Risque                                          | Vraisemblance | Gravité | Mesures                                                                                                                       |
| ----------------------------------------------- | ------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Accès illégitime aux données synchronisées      | Faible        | Élevée  | Règles Firestore par utilisateur (testées), App Check, TLS, pas de suppression côté client, audit                             |
| Fuite d'identifiants de connecteurs             | Faible        | Élevée  | AES-256-GCM avec clé dans Secret Manager et AAD liant le secret à son propriétaire ; aucune lecture client                    |
| Données de santé exploitées sans consentement   | Faible        | Élevée  | Consentement séparé et horodaté ; moteurs neutralisés sans consentement ; règle Firestore exigeant le consentement enregistré |
| XSS exfiltrant des données locales              | Faible        | Élevée  | Rendu JSX uniquement, lint anti-injection, CSP stricte                                                                        |
| Recommandation erronée influençant une décision | Moyenne       | Moyenne | Explications, incertitudes, avertissements « non médical, non financier », contrôle humain                                    |
| Sauvegarde du téléphone exposant des données    | Faible        | Moyenne | Android : `allowBackup=false` et exclusion des règles d'extraction                                                            |
| Transfert hors UE                               | Moyenne       | Moyenne | Firebase `europe-west1` ; Lemon Squeezy et fournisseurs OAuth soumis à leurs propres garanties (CCT)                          |

Risque résiduel : **acceptable** sous réserve de la validation juridique, de la vérification des applications OAuth et d'une revue annuelle.
