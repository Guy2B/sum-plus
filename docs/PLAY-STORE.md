# Publier Σ Life OS sur Google Play

Tout ce qu'il faut pour la première publication : étapes dans Play Console, textes de la fiche (FR, EN, DE, ES), images, et réponses aux formulaires de Google. Les images sont dans `mobile/store/` ; le fichier à envoyer (AAB signé) est produit par GitHub Actions → **Android** → dernière exécution ✅ → artefact **sigma-android-aab**.

---

## 1. Créer l'application (Play Console)

1. **Créer une application**
   - Nom : `Σ Life OS`
   - Langue par défaut : Français (France)
   - Application (pas jeu) · Gratuite
   - Cocher les déclarations (règles du programme, lois américaines sur l'exportation).
2. **Tester → Test interne → Créer une release**
   - Accepter **Signature d'application par Google Play** (recommandé). Google gère la clé finale ; la vôtre (`lifeOS/android-keys`) sert à envoyer les mises à jour.
   - Téléverser `app-release.aab` (dézipper l'artefact `sigma-android-aab`).
   - Nom de la release : laisser le numéro proposé. Notes : « Première version bêta. »
   - Ajouter des testeurs internes : votre adresse et celles de proches (jusqu'à 100, sans délai d'examen long).
3. **Empreinte de la clé de Google (important pour la connexion Google)**
   - Play Console → **Tester et publier → Configuration → Intégrité de l'app → Signature d'application** : copier **SHA-1** et **SHA-256** de la *clé de signature d'application*.
   - Me les donner (ou : console Firebase → Paramètres du projet → app Android `com.algbr.lifeos` → Ajouter une empreinte, deux fois).
   - Sans cela, « Continuer avec Google » échoue pour les installations depuis le Play Store.
4. **Test fermé (obligatoire avant la production pour un compte personnel)**
   - Tester → Tests fermés → créer un canal, ajouter **au moins 12 testeurs** (liste d'e-mails Google ou groupe Google), et les garder inscrits **14 jours consécutifs**.
   - Ensuite seulement : Production → demander l'accès à la production.

---

## 2. Fiche du Play Store (Présence sur le Store → Fiche principale)

| Champ | Limite | Fichier / texte |
|---|---|---|
| Nom | 30 | `Σ Life OS` |
| Description courte | 80 | ci-dessous |
| Description complète | 4000 | ci-dessous |
| Icône | 512×512 PNG | `mobile/store/icon-512.png` |
| Image de présentation | 1024×500 | `mobile/store/feature-graphic-fr.png` (une par langue) |
| Captures téléphone | 2 à 8 | `mobile/store/phone-1-today.png` … `phone-5-capture.png` |
| Catégorie | | **Productivité** |
| E-mail de contact | | contact@guybeaho.com |
| Site web | | https://lifeos.guybeaho.com |
| Politique de confidentialité | | https://lifeos.guybeaho.com/legal/privacy.html |

Ajouter les traductions : **Traduire → Gérer les traductions → Ajouter : anglais (en-US), allemand (de-DE), espagnol (es-ES)**, puis coller les textes et l'image de présentation de chaque langue.

### Français

**Description courte**
> 3 décisions par jour, expliquées. Tâches, agenda et mails : le reste peut attendre.

**Description complète**
> Vous avez 37 choses à gérer. Σ vous montre les 3 qui comptent aujourd'hui — et pourquoi.
>
> Σ Life OS n'est pas une liste de plus à organiser. C'est un moteur de décision personnel : il relie vos tâches, votre agenda, vos mails et votre énergie, puis choisit ce qui mérite votre attention maintenant, ce qu'il faut surveiller et le créneau à protéger.
>
> POURQUOI MAINTENANT ? POURQUOI PAS AUTRE CHOSE ?
> Chaque recommandation est expliquée : échéance, promesse faite à quelqu'un, effort, temps libre réel, ce qu'elle débloque. Et Σ dit aussi ce qu'il a écarté, et pourquoi.
>
> VOTRE JOURNÉE CHANGE ? Σ AUSSI.
> « Je suis épuisé et je pars à 15 h » : Σ recalcule le plan, réduit la charge et protège l'essentiel.
>
> CE QUI RISQUE DE TOMBER ENTRE LES MAILLES
> Promesses, échéances proches, personnes qui attendent une réponse, projets qui n'avancent plus : l'écran Attention garde tout cela en arrière-plan pour vous.
>
> MISSIONS
> Un examen, un entretien, une remise en forme, une langue, une présentation : Σ prépare un plan daté et l'ajuste à vos séances réelles.
>
> UN COACH QUI N'INVENTE RIEN
> Posez une question à votre propre système : « Qu'est-ce qui peut attendre ? », « Pourquoi ma semaine est surchargée ? ». Les réponses partent de vos données et citent leurs sources.
>
> LOCAL D'ABORD
> Vos données restent sur votre téléphone par défaut. Compte facultatif, synchronisation facultative, export et suppression complète à tout moment. Aucune IA cloud n'est nécessaire.
>
> SOURCES
> Gmail, Google Agenda, Outlook et agenda Microsoft, messagerie IMAP. Disponible en français, anglais, allemand et espagnol.
>
> Bêta : toutes les fonctions Pro sont offertes pendant la bêta.

### English

**Short description**
> 3 explained decisions a day. Tasks, calendar and mail: the rest can wait.

**Full description**
> You have 37 things to handle. Σ shows you the 3 that matter today — and why.
>
> Σ Life OS is not another list to organise. It is a personal decision engine: it connects your tasks, calendar, mail and energy, then picks what deserves your attention now, what to keep an eye on and which time slot to protect.
>
> WHY NOW? WHY NOT SOMETHING ELSE?
> Every recommendation is explained: deadline, a promise made to someone, effort, real free time, what it unblocks. Σ also tells you what it set aside, and why.
>
> YOUR DAY CHANGES? SO DOES Σ.
> "I'm exhausted and leaving at 3 pm": Σ recalculates the plan, lowers the load and protects what matters.
>
> WHAT COULD SLIP THROUGH THE CRACKS
> Promises, close deadlines, people waiting for a reply, projects that stopped moving: the Attention screen keeps all of it in the background for you.
>
> MISSIONS
> An exam, a job interview, getting fit, a language, a talk: Σ builds a dated plan and adapts it to the sessions you actually do.
>
> A COACH THAT INVENTS NOTHING
> Ask your own system: "What can wait?", "Why is my week overloaded?". Answers come from your data and cite their sources.
>
> LOCAL-FIRST
> Your data stays on your phone by default. Optional account, optional sync, export and full deletion at any time. No cloud AI required.
>
> SOURCES
> Gmail, Google Calendar, Outlook and Microsoft calendar, IMAP mail. Available in English, French, German and Spanish.
>
> Beta: every Pro feature is free during the beta.

### Deutsch

**Kurzbeschreibung**
> 3 erklärte Entscheidungen pro Tag. Aufgaben, Kalender, Mails: Der Rest kann warten.

**Vollständige Beschreibung**
> Sie haben 37 Dinge zu erledigen. Σ zeigt Ihnen die 3, die heute zählen – und warum.
>
> Σ Life OS ist keine weitere Liste zum Sortieren. Es ist eine persönliche Entscheidungs-Engine: Sie verbindet Aufgaben, Kalender, Mails und Energie und wählt, was jetzt Ihre Aufmerksamkeit verdient, was Sie im Blick behalten sollten und welches Zeitfenster geschützt wird.
>
> WARUM JETZT? WARUM NICHT ETWAS ANDERES?
> Jede Empfehlung wird erklärt: Frist, eine Zusage an jemanden, Aufwand, echte freie Zeit, was sie freigibt. Σ sagt auch, was es zurückgestellt hat – und warum.
>
> IHR TAG ÄNDERT SICH? Σ AUCH.
> „Ich bin erschöpft und muss um 15 Uhr los“: Σ berechnet den Plan neu, reduziert die Last und schützt das Wesentliche.
>
> WAS DURCHRUTSCHEN KÖNNTE
> Zusagen, nahe Fristen, Menschen, die auf Antwort warten, Projekte, die stillstehen: Der Bildschirm „Aufmerksamkeit“ behält all das für Sie im Hintergrund.
>
> MISSIONEN
> Eine Prüfung, ein Vorstellungsgespräch, wieder fit werden, eine Sprache, ein Vortrag: Σ erstellt einen datierten Plan und passt ihn an Ihre tatsächlichen Einheiten an.
>
> EIN COACH, DER NICHTS ERFINDET
> Fragen Sie Ihr eigenes System: „Was kann warten?“, „Warum ist meine Woche überladen?“. Die Antworten beruhen auf Ihren Daten und nennen ihre Quellen.
>
> LOKAL ZUERST
> Ihre Daten bleiben standardmäßig auf Ihrem Telefon. Konto optional, Synchronisierung optional, Export und vollständige Löschung jederzeit. Keine Cloud-KI nötig.
>
> QUELLEN
> Gmail, Google Kalender, Outlook und Microsoft-Kalender, IMAP-Mail. Auf Deutsch, Englisch, Französisch und Spanisch.
>
> Beta: Alle Pro-Funktionen sind während der Beta kostenlos.

### Español

**Descripción breve**
> 3 decisiones explicadas al día. Tareas, agenda y correo: el resto puede esperar.

**Descripción completa**
> Tienes 37 cosas que gestionar. Σ te muestra las 3 que importan hoy, y por qué.
>
> Σ Life OS no es otra lista que organizar. Es un motor de decisión personal: conecta tus tareas, tu agenda, tu correo y tu energía, y elige lo que merece tu atención ahora, lo que conviene vigilar y la franja que hay que proteger.
>
> ¿POR QUÉ AHORA? ¿POR QUÉ NO OTRA COSA?
> Cada recomendación está explicada: plazo, una promesa hecha a alguien, esfuerzo, tiempo libre real, lo que desbloquea. Σ también te dice qué apartó, y por qué.
>
> ¿CAMBIA TU DÍA? Σ TAMBIÉN.
> «Estoy agotado y me voy a las 15 h»: Σ recalcula el plan, reduce la carga y protege lo esencial.
>
> LO QUE PODRÍA ESCAPARSE
> Promesas, plazos cercanos, personas que esperan respuesta, proyectos que ya no avanzan: la pantalla Atención lo guarda todo en segundo plano por ti.
>
> MISIONES
> Un examen, una entrevista, ponerse en forma, un idioma, una presentación: Σ crea un plan con fechas y lo ajusta a tus sesiones reales.
>
> UN COACH QUE NO INVENTA NADA
> Pregunta a tu propio sistema: «¿Qué puede esperar?», «¿Por qué mi semana está sobrecargada?». Las respuestas parten de tus datos y citan sus fuentes.
>
> LOCAL PRIMERO
> Tus datos se quedan en tu teléfono por defecto. Cuenta opcional, sincronización opcional, exportación y borrado completo en cualquier momento. No necesita IA en la nube.
>
> FUENTES
> Gmail, Google Calendar, Outlook y calendario de Microsoft, correo IMAP. Disponible en español, inglés, francés y alemán.
>
> Beta: todas las funciones Pro son gratis durante la beta.

---

## 3. Contenu de l'application (Règles → Contenu de l'application)

### Politique de confidentialité
`https://lifeos.guybeaho.com/legal/privacy.html`

### Accès à l'application
**Toutes les fonctionnalités sont disponibles sans accès spécial.** Note pour l'examinateur :
> L'app fonctionne sans compte. Au premier lancement, toucher « Voir Σ décider sur une semaine fictive » (« See Σ decide on a sample week » en anglais). Un compte (Google ou e-mail) n'est nécessaire que pour la synchronisation et les connecteurs.

### Annonces
**Non**, l'application ne contient pas d'annonces.

### Classification du contenu (questionnaire IARC)
- Catégorie : **Utilitaires, productivité, communication ou autre**.
- Violence, sexualité, langage, substances, jeux d'argent : **Non** partout.
- Les utilisateurs peuvent-ils interagir ou échanger du contenu entre eux ? **Non**.
- Partage de la position : **Non**. Achats numériques : **Non** pendant la bêta.
- Résultat attendu : **PEGI 3 / Tout public**.

### Public cible
- Tranche d'âge : **18 ans et plus** (évite les obligations « Familles »).
- L'app n'attire pas particulièrement les enfants : **Non**.

### Application d'actualités · Applications gouvernementales · Prêts · COVID
**Non** à toutes.

### Fonctionnalités financières
**Aucune** (suivi personnel de budget sans transfert d'argent, sans prêt, sans crypto).

### Applications de santé
Cocher seulement **Bien-être / gestion du sommeil et de l'énergie (saisie manuelle)** si Google le demande ; pas de diagnostic, pas de dispositif médical, pas de Health Connect dans cette version.

### Suppression du compte
- L'app permet de créer un compte : **Oui**.
- Lien pour demander la suppression : `https://lifeos.guybeaho.com/legal/privacy.html` (section 9 « Vos droits » : Compte → Données → Supprimer mon compte, ou par e-mail).
- Suppression partielle (données sans compte) : **Oui**, via Compte → Données → Effacer cet appareil.

### Sécurité des données (Data safety)

Réponses générales :
- L'app collecte-t-elle ou partage-t-elle des données ? **Oui**.
- Toutes les données sont-elles chiffrées en transit ? **Oui**.
- Les utilisateurs peuvent-ils demander la suppression ? **Oui**.
- Partage avec des tiers : **Non** pour tout ce qui suit (Firebase et Netlify agissent comme sous-traitants, ce n'est pas du « partage » au sens de Google).

Types de données **collectées** (toutes facultatives, aucune n'est obligatoire pour utiliser l'app) :

| Catégorie → type | Quand | Finalité | Traitement éphémère |
|---|---|---|---|
| Informations personnelles → **Adresse e-mail**, **Nom** | compte créé | Gestion du compte | Non |
| Informations personnelles → **Identifiants utilisateur** | compte créé | Gestion du compte, fonctionnement | Non |
| Agenda → **Événements de l'agenda** | synchronisation activée | Fonctionnement de l'app | Non |
| Contacts → **Contacts** | synchronisation activée | Fonctionnement de l'app | Non |
| Informations financières → **Autres informations financières** | synchronisation activée (module Finances) | Fonctionnement de l'app | Non |
| Santé et remise en forme → **Informations de santé** | synchronisation activée **et** consentement santé | Fonctionnement de l'app | Non |
| Messages → **E-mails** | connecteur IMAP uniquement (Gmail et Outlook sont lus directement par le téléphone) | Fonctionnement de l'app | **Oui** |
| Activité dans l'app → **Autre contenu généré par l'utilisateur** | synchronisation (tâches, notes, missions) ; retours hebdomadaires envoyés | Fonctionnement ; retours | Non |
| Activité dans l'app → **Interactions avec l'app** | mesure anonyme acceptée ; jours d'usage du programme Fondateur | Analyse ; fonctionnement | Non |

**Non collectés** : position, photos, fichiers, audio, navigation web, identifiants publicitaires, journaux de plantage, contenu des mails Gmail/Outlook (traité uniquement sur l'appareil).

---

## 4. Après la première installation depuis Google Play
- Vérifier « Continuer avec Google » (nécessite l'étape 1.3).
- Vérifier une synchronisation Gmail (au plus 100 testeurs tant que Google n'a pas validé l'autorisation Gmail).
- Chaque push sur `main` produit un nouvel AAB (numéro de version = numéro de construction) : le téléverser dans une nouvelle release.
