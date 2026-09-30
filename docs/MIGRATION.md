# Migration depuis les versions V1 à V8

## Pour les utilisateurs

Au premier lancement de la nouvelle version, sur le **même domaine** que l'ancienne, Σ lit automatiquement `localStorage["sum-algbr-state-v1"]` et importe :

| Ancien                            | Nouveau               | Remarques                                                                                            |
| --------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| tâches                            | `tasks`               | `done` devient `status: done`, `inbox` devient `status: inbox`, `estimate` devient `estimateMinutes` |
| projets et étapes                 | `projects.milestones` |                                                                                                      |
| finances                          | `finance`             | montants convertis en centimes, `professional` devient `taxRelevant`                                 |
| santé                             | `health`              | notes sur 10 ramenées sur 5 ; **utilisées seulement après consentement santé**                       |
| journal (+ gratitude)             | `journal`             | textes fusionnés                                                                                     |
| apprentissage et ressources       | `skills`              |                                                                                                      |
| événements                        | `events`              | date et heure converties en ISO                                                                      |
| habitudes et suivis               | `habits`, `habitLogs` |                                                                                                      |
| objectifs                         | `goals`               |                                                                                                      |
| profil, édition, devise, contexte | `settings`            | `professional` devient `solo`, `personal` devient `life`                                             |

L'import a lieu une seule fois (drapeau `legacyMigrated`). Un message indique le nombre d'éléments récupérés. Les données de l'ancienne version ne sont pas supprimées : elles le sont seulement via _Effacer cet appareil_.

**Changement de domaine** (par exemple de `guy2b.github.io/sum` vers un domaine propre) : le stockage du navigateur est propre à chaque domaine. La reprise automatique ne fonctionne donc que si la nouvelle version est servie sur le même domaine que l'ancienne. Sinon, ouvrez une fois la nouvelle version sur l'ancien domaine (elle migre les données), exportez une sauvegarde depuis _Compte → Données_, puis importez-la sur le nouveau domaine.

## Pour l'équipe

- L'ancien dépôt `guy2b/sum` et les dossiers `lifeOS\Sigma-Life-OS-*` sont conservés en archive, sans être modifiés.
- Ce dépôt repart d'un historique neuf (le secret publié dans l'ancien historique est ainsi exclu).
- Données cloud de l'ancienne version (`workspaces/{uid}` monolithique) : elles ne sont pas reprises automatiquement. Si des utilisateurs réels en ont, un script d'export ou d'import peut être écrit à la demande.
- Mapping testé : `apps/web/tests/domain.test.ts` (« imports legacy V1-V8 state ») et `capture-store.test.ts` (migration unique).
