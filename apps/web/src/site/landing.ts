import '../styles/site.css';
import { config } from '../config';

type Lang = 'fr' | 'en' | 'de' | 'es';
type Dict = Record<string, string>;

document.documentElement.classList.add('js');

// French is authored in index.html; these strings are only used by the script (demo interactions).
const FR: Dict = {
  'coach.a1':
    'Le devis promis à Müller est la meilleure prochaine action : échéance demain, 25 min estimées, deux étapes débloquées.',
  'coach.a2':
    'La homepage et deux tâches internes peuvent attendre vendredi sans créer de retard ni bloquer quelqu’un.',
  'coach.a3':
    'Vendredi dépasse votre capacité d’environ 1 h 35. Je peux déplacer « Comptabilité » à jeudi et « Homepage » à lundi sans toucher aux échéances client.',
  'coach.a4':
    '« Refonte du site » n’a eu aucune action depuis 11 jours et a été reportée 4 fois. Plus petite prochaine étape : lister les 3 pages à refaire (15 min).',
  'coach.a5':
    'Je peux déplacer « Comptabilité » et « Homepage » et protéger 14:00–16:00. Rien n’est appliqué sans votre confirmation.',
  'coach.a6':
    'Le 28, « Devis Müller » a été choisi plutôt que « Homepage » : promesse faite à Müller, échéance le lendemain, 42 min libres. Vous l’aviez terminé.',
  'demo.recalced': '✓ Journée recalculée',
  'demo.close': 'Fermer',
};

const T: Record<Exclude<Lang, 'fr'>, Dict> = {
  en: {
    'cta.demo': 'Try without my data',
    'cta.mine': 'Start with my data',
    'cta.demoNote': 'A sample week, nothing to type, nothing to share.',
    skip: 'Skip to content',
    'nav.product': 'Product',
    'nav.why': 'Why Σ',
    'nav.privacy': 'Local-first',
    'nav.pricing': 'Pricing',
    'cta.signin': 'Sign in',
    'cta.try': 'Try Σ',
    'cta.free': 'Try Σ for free',
    'cta.how': 'See how it works ↓',
    'cta.start': 'Start for free',
    'cta.pro': 'Go Σ Pro',
    'hero.pill': 'Personal decision engine · local-first',
    'hero.title': 'You have 37 things to handle.<br /><span>Σ shows you the 3 that matter.</span>',
    'hero.lead':
      'Tasks, calendar, mail and context become three explained decisions. Not another list to organise. Not a chatbot that improvises.',
    'trust.1': 'No account required',
    'trust.2': 'Works without cloud AI',
    'trust.3': 'Français, English, Deutsch, Español',
    'demo.today': 'Today',
    'demo.hello': 'Good morning, Alex',
    'demo.title': 'Here is what deserves your attention.',
    'demo.dayChanged': 'My day has changed',
    'demo.energy': 'Energy',
    'demo.low': 'Low',
    'demo.normal': 'Normal',
    'demo.high': 'High',
    'demo.timeLeft': 'Time left',
    'demo.recalc': 'Recalculate my day',
    'demo.recalced': '✓ Day recalculated',
    'demo.close': 'Close',
    'role.now': 'Do now',
    'role.watch': 'Keep an eye on',
    'role.protect': 'Protect this slot',
    'demo.c1': 'Send the quote promised to Müller',
    'demo.c1d': '<b>25 min</b> · due tomorrow · unblocks 2 actions',
    'demo.start': 'Start',
    'demo.done': 'Done',
    'demo.why': 'Why?',
    'demo.schedule': 'Schedule',
    'why.promise': 'Promise',
    'why.due': 'Deadline',
    'why.dueV': 'Tomorrow 5 pm',
    'why.unblocks': 'Unblocks',
    'why.unblocksV': '2 actions',
    'why.effort': 'Effort',
    'why.free': 'Availability',
    'why.freeV': '42 min free',
    'why.goal': 'Goal',
    'why.goalV': 'Sign Müller',
    'why.notQ': 'Why not “Redo the homepage”?',
    'why.notA': 'No deadline · needs 90 min · can wait until Friday.',
    'demo.c2': 'Reply from Léa expected for 3 days',
    'demo.c2d': '<b>No action now</b> · check again this afternoon',
    'demo.c3': 'Prepare Thursday’s meeting',
    'demo.c3d': '<b>2:10–3:00 pm</b> · 50 min free',
    'demo.aside': 'Σ set aside 18 other items',
    'demo.avoided': ' · 2 h 10 of overload avoided',
    'demo.a1': '<b>7</b> can wait',
    'demo.a2': '<b>4</b> exceed your capacity',
    'demo.a3': '<b>3</b> less impact',
    'demo.a4': '<b>2</b> duplicates merged',
    'demo.avoidedHow':
      'Overload avoided: work due within 3 days that no longer fits in your day, after your meetings.',
    'float.1': 'Less to handle',
    'float.1d': 'Σ filters before it shows.',
    'float.2': 'Adapts to you',
    'float.2d': 'Real time, feedback, habits.',
    'proof.todo': 'To-do list',
    'proof.todoD': '→ organises everything',
    'proof.cal': 'AI calendar',
    'proof.calD': '→ schedules everything',
    'proof.sigmaD': '→ decides what can wait',
    'how.eyebrow': 'No black box',
    'how.title': 'A recommendation is only useful if you can challenge it.',
    'how.lead': 'Σ shows the facts behind every decision — and why something else was set aside.',
    'how.1t': 'Why now?',
    'how.1d': 'Deadline, promises, effort, availability, dependencies and goals are all visible.',
    'how.2t': 'Why not something else?',
    'how.2d': 'Σ compares what was chosen with what was set aside, without hiding the trade-off.',
    'how.3t': 'What if my day changes?',
    'how.3d': 'Change energy, time left or end time. The three decisions are recalculated.',
    'how.conf': 'High confidence',
    'how.effortV': '25 min (calibrated on your real times)',
    'how.cf': 'No deadline · 90 min · blocks nobody · can wait until Friday.',
    'adapt.eyebrow': 'Your day is not a fixed schedule',
    'adapt.title': '“I’m exhausted and I have to leave at 3 pm.”',
    'adapt.lead':
      'Σ reduces the load, protects what matters and lets the rest wait. The plan adapts to your reality, not the other way round.',
    'adapt.s1': '😫 Low energy',
    'adapt.s2': '⏳ 2 h left',
    'adapt.s3': '🚪 Leaving at 3 pm',
    'adapt.plan': 'New plan',
    'adapt.now': 'Now',
    'adapt.nowV': 'Reply to the client · 12 min',
    'adapt.watch': 'Watch',
    'adapt.watchV': 'Invoice due tomorrow',
    'adapt.protect': 'Protect',
    'adapt.protectV': '1:30–2:15 pm · preparation',
    'coach.title': 'Ask your own system, not a general-purpose chatbot.',
    'coach.lead':
      'Answers come from your structured data, cite their sources and can propose a plan for you to confirm.',
    'coach.q1': 'What should I do now?',
    'coach.q2': 'What can wait?',
    'coach.q3': 'Why am I overloaded?',
    'coach.q4': 'What is no longer moving?',
    'coach.q5': 'Free up 2 hours tomorrow.',
    'coach.q6': 'Why did we decide that?',
    'coach.a1':
      'The quote promised to Müller is the best next action: due tomorrow, 25 min estimated, two steps unblocked.',
    'coach.a2':
      'The homepage and two internal tasks can wait until Friday without causing delays or blocking anyone.',
    'coach.a3':
      'Friday exceeds your capacity by about 1 h 35. I can move “Accounting” to Thursday and “Homepage” to Monday without touching client deadlines.',
    'coach.a4':
      '“Website redesign” has had no action for 11 days and was postponed 4 times. Smallest next step: list the 3 pages to redo (15 min).',
    'coach.a5':
      'I can move “Accounting” and “Homepage” and protect 2–4 pm. Nothing is applied without your confirmation.',
    'coach.a6':
      'On the 28th, “Müller quote” was chosen over “Homepage”: a promise to Müller, due the next day, 42 min free. You completed it.',
    'coach.sources': 'Sources: Calendar (6) · Tasks (14) · Projects (3)',
    'coach.apply': 'Apply this plan',
    'cmd.eyebrow': 'One bar',
    'cmd.title': 'Capture, plan or ask, in plain language.',
    'cmd.input': 'lunch friday 1pm with Marc',
    'cmd.kind': 'Event detected',
    'cmd.result': 'Lunch with Marc · Friday 1:00 pm',
    'cmd.create': 'Create',
    'cmd.e1': '“I promised Müller the quote by Friday”',
    'cmd.e2': '“I’m exhausted and leaving at 3pm”',
    'cmd.e3': '“maths test on the 14th”',
    'priv.eyebrow': 'Local-first by design',
    'priv.title': 'Your life doesn’t need to become a cloud AI’s data.',
    'priv.lead':
      'The Σ decision engine works without a language model. AI is an optional layer to understand or rephrase — never to decide your priorities.',
    'priv.core': 'Deterministic, explainable engine that works offline.',
    'priv.coreB': 'Always available',
    'priv.local': 'Browser AI or local AI',
    'priv.localD':
      'The browser’s built-in model, Ollama or LM Studio, on your machine. Σ checks every answer.',
    'priv.localB': 'Optional',
    'priv.never': 'What never leaves',
    'priv.neverD': 'Finances, health and mail content are never sent to a model.',
    'priv.neverB': 'Guaranteed',
    'priv.p1': '✓ No account required',
    'priv.p2': '✓ Export your data',
    'priv.p3': '✓ Control source by source',
    'priv.p4': '✓ No silent external actions',
    'priv.p5': '✓ Complete deletion',
    'priv.p6': '✓ No cloud AI required',
    'learn.eyebrow': 'Real personalisation',
    'learn.title': 'The more you use it, the less you need to organise it.',
    'learn.1': 'You often postpone admin after 4 pm.',
    'learn.1d': 'Σ gradually avoids that slot.',
    'learn.2': 'Your client tasks take 18 % longer than planned on average.',
    'learn.2d': 'Future estimates are recalibrated.',
    'learn.3': 'You promised Müller the quote.',
    'learn.3d': 'A promise comes before a plain task.',
    'learn.4': 'This project was postponed 4 times in 11 days.',
    'learn.4d': 'Σ suggests the smallest next step to unblock it.',
    'cmp.eyebrow': 'A different category',
    'cmp.title': 'Other tools organise your work. Σ arbitrates your attention.',
    'cmp.r1': 'Shows what exists',
    'cmp.r2': 'Places work in the calendar',
    'cmp.r3': 'Decides what can wait',
    'cmp.r4': 'Explains why A rather than B',
    'cmp.r5': 'Works without cloud AI',
    'price.eyebrow': 'Simple to start',
    'price.title': 'Discover the engine for free. Go Pro when Σ becomes your system.',
    'price.freeLead': 'See within a few days whether three decisions beat another to-do list.',
    'price.f1': '3 explained decisions a day',
    'price.f2': 'Why now / why not',
    'price.f3': 'Day plan and “what if…?”',
    'price.f4': 'Missions: exam, interview, fitness, reading…',
    'price.f5': 'Natural-language capture, local AI',
    'price.f6': 'Coach: 5 analyses a day',
    'price.badge': 'For the complete system',
    'price.month': '/ month',
    'price.or': 'or',
    'price.year': '/ year',
    'price.p1': 'Connected sources: calendar, mail, IMAP, social',
    'price.p2': 'Multi-device sync and Drive backup',
    'price.p3': 'Unlimited Coach',
    'price.p4': 'Finance, health, household and career',
    'price.p5': 'Unlimited projects and habits',
    'final.eyebrow': 'Tomorrow morning',
    'final.title': 'Don’t open five apps to rebuild your day.',
    'final.lead': 'Open Σ. Look at the three decisions. Start.',
    'final.meta': 'Local-first · Explainable · Multilingual · Works without cloud AI',
    'footer.tagline': 'A calm decision layer above your digital life.',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.support': 'Support',
  },
  de: {
    'cta.demo': 'Ohne meine Daten testen',
    'cta.mine': 'Mit meinen Daten starten',
    'cta.demoNote': 'Eine Beispielwoche, nichts eintippen, nichts teilen.',
    skip: 'Zum Inhalt springen',
    'nav.product': 'Produkt',
    'nav.why': 'Warum Σ',
    'nav.privacy': 'Lokal zuerst',
    'nav.pricing': 'Preise',
    'cta.signin': 'Anmelden',
    'cta.try': 'Σ testen',
    'cta.free': 'Σ kostenlos testen',
    'cta.how': 'So funktioniert es ↓',
    'cta.start': 'Kostenlos starten',
    'cta.pro': 'Zu Σ Pro wechseln',
    'hero.pill': 'Persönliche Entscheidungs-Engine · lokal zuerst',
    'hero.title': 'Sie haben 37 Dinge zu erledigen.<br /><span>Σ zeigt Ihnen die 3, die zählen.</span>',
    'hero.lead':
      'Aufgaben, Kalender, Mails und Kontext werden zu drei erklärten Entscheidungen. Keine neue Liste zum Sortieren. Kein Chatbot, der improvisiert.',
    'trust.1': 'Kein Konto erforderlich',
    'trust.2': 'Funktioniert ohne Cloud-KI',
    'trust.3': 'Français, English, Deutsch, Español',
    'demo.today': 'Heute',
    'demo.hello': 'Guten Morgen, Alex',
    'demo.title': 'Das verdient Ihre Aufmerksamkeit.',
    'demo.dayChanged': 'Mein Tag hat sich geändert',
    'demo.energy': 'Energie',
    'demo.low': 'Niedrig',
    'demo.normal': 'Normal',
    'demo.high': 'Hoch',
    'demo.timeLeft': 'Verbleibende Zeit',
    'demo.recalc': 'Meinen Tag neu berechnen',
    'demo.recalced': '✓ Tag neu berechnet',
    'demo.close': 'Schließen',
    'role.now': 'Jetzt erledigen',
    'role.watch': 'Im Blick behalten',
    'role.protect': 'Dieses Zeitfenster schützen',
    'demo.c1': 'Müller das zugesagte Angebot schicken',
    'demo.c1d': '<b>25 Min.</b> · fällig morgen · gibt 2 Aufgaben frei',
    'demo.start': 'Starten',
    'demo.done': 'Erledigt',
    'demo.why': 'Warum?',
    'demo.schedule': 'Einplanen',
    'why.promise': 'Zusage',
    'why.due': 'Frist',
    'why.dueV': 'Morgen 17:00',
    'why.unblocks': 'Gibt frei',
    'why.unblocksV': '2 Aufgaben',
    'why.effort': 'Aufwand',
    'why.free': 'Verfügbarkeit',
    'why.freeV': '42 Min. frei',
    'why.goal': 'Ziel',
    'why.goalV': 'Müller gewinnen',
    'why.notQ': 'Warum nicht „Homepage überarbeiten“?',
    'why.notA': 'Keine Frist · braucht 90 Min. · kann bis Freitag warten.',
    'demo.c2': 'Antwort von Léa seit 3 Tagen erwartet',
    'demo.c2d': '<b>Jetzt nichts zu tun</b> · heute Nachmittag nachsehen',
    'demo.c3': 'Das Meeting am Donnerstag vorbereiten',
    'demo.c3d': '<b>14:10–15:00</b> · 50 Min. frei',
    'demo.aside': 'Σ hat 18 weitere Punkte zurückgestellt',
    'demo.avoided': ' · 2 Std. 10 Überlastung vermieden',
    'demo.a1': '<b>7</b> können warten',
    'demo.a2': '<b>4</b> übersteigen Ihre Kapazität',
    'demo.a3': '<b>3</b> weniger Wirkung',
    'demo.a4': '<b>2</b> Duplikate zusammengeführt',
    'demo.avoidedHow':
      'Vermiedene Überlastung: Arbeit, die in 3 Tagen fällig ist und nach Ihren Terminen nicht mehr in den Tag passt.',
    'float.1': 'Weniger zu verwalten',
    'float.1d': 'Σ filtert, bevor es zeigt.',
    'float.2': 'Passt sich Ihnen an',
    'float.2d': 'Echte Zeiten, Feedback, Gewohnheiten.',
    'proof.todo': 'To-do-Liste',
    'proof.todoD': '→ organisiert alles',
    'proof.cal': 'KI-Kalender',
    'proof.calD': '→ plant alles ein',
    'proof.sigmaD': '→ entscheidet, was warten kann',
    'how.eyebrow': 'Keine Blackbox',
    'how.title': 'Eine Empfehlung ist nur nützlich, wenn Sie sie hinterfragen können.',
    'how.lead':
      'Σ zeigt die Fakten hinter jeder Entscheidung — und warum etwas anderes zurückgestellt wurde.',
    'how.1t': 'Warum jetzt?',
    'how.1d': 'Frist, Zusagen, Aufwand, Verfügbarkeit, Abhängigkeiten und Ziele sind sichtbar.',
    'how.2t': 'Warum nicht etwas anderes?',
    'how.2d': 'Σ vergleicht das Gewählte mit dem Zurückgestellten, ohne die Abwägung zu verstecken.',
    'how.3t': 'Und wenn sich mein Tag ändert?',
    'how.3d':
      'Ändern Sie Energie, verbleibende Zeit oder Feierabend. Die drei Entscheidungen werden neu berechnet.',
    'how.conf': 'Hohe Sicherheit',
    'how.effortV': '25 Min. (an Ihren echten Zeiten kalibriert)',
    'how.cf': 'Keine Frist · 90 Min. · blockiert niemanden · kann bis Freitag warten.',
    'adapt.eyebrow': 'Ihr Tag ist kein starrer Plan',
    'adapt.title': '„Ich bin erschöpft und muss um 15 Uhr los.“',
    'adapt.lead':
      'Σ reduziert die Last, schützt, was zählt, und lässt den Rest warten. Der Plan passt sich Ihrer Realität an, nicht umgekehrt.',
    'adapt.s1': '😫 Wenig Energie',
    'adapt.s2': '⏳ Noch 2 Std.',
    'adapt.s3': '🚪 Aufbruch 15:00',
    'adapt.plan': 'Neuer Plan',
    'adapt.now': 'Jetzt',
    'adapt.nowV': 'Dem Kunden antworten · 12 Min.',
    'adapt.watch': 'Im Blick',
    'adapt.watchV': 'Rechnung morgen fällig',
    'adapt.protect': 'Schützen',
    'adapt.protectV': '13:30–14:15 · Vorbereitung',
    'coach.title': 'Fragen Sie Ihr eigenes System, nicht einen Allzweck-Chatbot.',
    'coach.lead':
      'Antworten basieren auf Ihren strukturierten Daten, nennen ihre Quellen und können einen Plan zur Bestätigung vorschlagen.',
    'coach.q1': 'Was soll ich jetzt tun?',
    'coach.q2': 'Was kann warten?',
    'coach.q3': 'Warum bin ich überlastet?',
    'coach.q4': 'Was kommt nicht mehr voran?',
    'coach.q5': 'Schaff mir morgen 2 Stunden frei.',
    'coach.q6': 'Warum hatten wir das entschieden?',
    'coach.a1':
      'Das Müller zugesagte Angebot ist der beste nächste Schritt: fällig morgen, 25 Min. geschätzt, zwei Schritte werden frei.',
    'coach.a2':
      'Die Homepage und zwei interne Aufgaben können bis Freitag warten, ohne Verzug und ohne jemanden zu blockieren.',
    'coach.a3':
      'Der Freitag übersteigt Ihre Kapazität um etwa 1 Std. 35. Ich kann „Buchhaltung“ auf Donnerstag und „Homepage“ auf Montag verschieben, ohne Kundenfristen anzutasten.',
    'coach.a4':
      '„Website-Relaunch“ hatte seit 11 Tagen keine Aktion und wurde 4-mal verschoben. Kleinster nächster Schritt: die 3 Seiten auflisten (15 Min.).',
    'coach.a5':
      'Ich kann „Buchhaltung“ und „Homepage“ verschieben und 14–16 Uhr schützen. Nichts wird ohne Ihre Bestätigung angewendet.',
    'coach.a6':
      'Am 28. wurde „Angebot Müller“ statt „Homepage“ gewählt: Zusage an Müller, fällig am nächsten Tag, 42 Min. frei. Sie hatten es erledigt.',
    'coach.sources': 'Quellen: Kalender (6) · Aufgaben (14) · Projekte (3)',
    'coach.apply': 'Diesen Plan anwenden',
    'cmd.eyebrow': 'Eine einzige Leiste',
    'cmd.title': 'Erfassen, planen oder fragen — in natürlicher Sprache.',
    'cmd.input': 'Mittagessen Freitag 13 Uhr mit Marc',
    'cmd.kind': 'Termin erkannt',
    'cmd.result': 'Mittagessen mit Marc · Freitag 13:00',
    'cmd.create': 'Anlegen',
    'cmd.e1': '„Müller das Angebot bis Freitag versprochen“',
    'cmd.e2': '„bin k.o. und gehe um 15 Uhr“',
    'cmd.e3': '„Mathe-Klausur am 14.“',
    'priv.eyebrow': 'Lokal zuerst, von Grund auf',
    'priv.title': 'Ihr Leben muss nicht zu Daten einer Cloud-KI werden.',
    'priv.lead':
      'Die Σ-Engine entscheidet ohne Sprachmodell. KI ist eine optionale Schicht zum Verstehen oder Umformulieren — nie, um Ihre Prioritäten festzulegen.',
    'priv.core': 'Deterministische, erklärbare Engine, auch offline nutzbar.',
    'priv.coreB': 'Immer verfügbar',
    'priv.local': 'Browser-KI oder lokale KI',
    'priv.localD':
      'Das eingebaute Modell des Browsers, Ollama oder LM Studio, auf Ihrem Rechner. Σ prüft jede Antwort.',
    'priv.localB': 'Optional',
    'priv.never': 'Was nie hinausgeht',
    'priv.neverD': 'Finanzen, Gesundheit und Mailinhalte werden nie an ein Modell gesendet.',
    'priv.neverB': 'Garantiert',
    'priv.p1': '✓ Kein Konto erforderlich',
    'priv.p2': '✓ Export Ihrer Daten',
    'priv.p3': '✓ Kontrolle pro Quelle',
    'priv.p4': '✓ Keine stillen externen Aktionen',
    'priv.p5': '✓ Vollständige Löschung',
    'priv.p6': '✓ Keine Cloud-KI nötig',
    'learn.eyebrow': 'Echte Personalisierung',
    'learn.title': 'Je mehr Sie es nutzen, desto weniger müssen Sie organisieren.',
    'learn.1': 'Sie verschieben Verwaltungskram oft auf nach 16 Uhr.',
    'learn.1d': 'Σ meidet dieses Zeitfenster nach und nach.',
    'learn.2': 'Ihre Kundenaufgaben dauern im Schnitt 18 % länger als geplant.',
    'learn.2d': 'Künftige Schätzungen werden neu kalibriert.',
    'learn.3': 'Sie haben Müller das Angebot zugesagt.',
    'learn.3d': 'Eine Zusage geht vor einer normalen Aufgabe.',
    'learn.4': 'Dieses Projekt wurde in 11 Tagen 4-mal verschoben.',
    'learn.4d': 'Σ schlägt den kleinsten nächsten Schritt vor, um es freizubekommen.',
    'cmp.eyebrow': 'Eine andere Kategorie',
    'cmp.title': 'Andere Tools organisieren Ihre Arbeit. Σ verteilt Ihre Aufmerksamkeit.',
    'cmp.r1': 'Zeigt, was existiert',
    'cmp.r2': 'Plant Arbeit im Kalender ein',
    'cmp.r3': 'Entscheidet, was warten kann',
    'cmp.r4': 'Erklärt, warum A statt B',
    'cmp.r5': 'Funktioniert ohne Cloud-KI',
    'price.eyebrow': 'Einfach anfangen',
    'price.title': 'Entdecken Sie die Engine kostenlos. Wechseln Sie zu Pro, wenn Σ Ihr System wird.',
    'price.freeLead':
      'Finden Sie in wenigen Tagen heraus, ob drei Entscheidungen besser sind als eine neue To-do-Liste.',
    'price.f1': '3 erklärte Entscheidungen pro Tag',
    'price.f2': 'Warum jetzt / warum nicht',
    'price.f3': 'Tagesplan und „Was wäre, wenn…?“',
    'price.f4': 'Missionen: Prüfung, Vorstellungsgespräch, Sport, Lesen…',
    'price.f5': 'Erfassung in natürlicher Sprache, lokale KI',
    'price.f6': 'Coach: 5 Analysen pro Tag',
    'price.badge': 'Für das komplette System',
    'price.month': '/ Monat',
    'price.or': 'oder',
    'price.year': '/ Jahr',
    'price.p1': 'Verbundene Quellen: Kalender, Mail, IMAP, soziale Netzwerke',
    'price.p2': 'Synchronisierung auf allen Geräten und Drive-Backup',
    'price.p3': 'Unbegrenzter Coach',
    'price.p4': 'Finanzen, Gesundheit, Haushalt und Karriere',
    'price.p5': 'Unbegrenzte Projekte und Gewohnheiten',
    'final.eyebrow': 'Morgen früh',
    'final.title': 'Öffnen Sie nicht fünf Apps, um Ihren Tag zusammenzusetzen.',
    'final.lead': 'Öffnen Sie Σ. Sehen Sie die drei Entscheidungen. Legen Sie los.',
    'final.meta': 'Lokal zuerst · Erklärbar · Mehrsprachig · Ohne Cloud-KI',
    'footer.tagline': 'Eine ruhige Entscheidungsebene über Ihrem digitalen Leben.',
    'footer.privacy': 'Datenschutz',
    'footer.terms': 'AGB',
    'footer.support': 'Support',
  },
  es: {
    'cta.demo': 'Probar sin mis datos',
    'cta.mine': 'Empezar con mis datos',
    'cta.demoNote': 'Una semana de ejemplo, nada que escribir, nada que compartir.',
    skip: 'Ir al contenido',
    'nav.product': 'Producto',
    'nav.why': 'Por qué Σ',
    'nav.privacy': 'Local primero',
    'nav.pricing': 'Precios',
    'cta.signin': 'Iniciar sesión',
    'cta.try': 'Probar Σ',
    'cta.free': 'Probar Σ gratis',
    'cta.how': 'Ver cómo funciona ↓',
    'cta.start': 'Empezar gratis',
    'cta.pro': 'Pasar a Σ Pro',
    'hero.pill': 'Motor de decisión personal · local primero',
    'hero.title': 'Tienes 37 cosas que gestionar.<br /><span>Σ te muestra las 3 que importan.</span>',
    'hero.lead':
      'Tareas, agenda, correo y contexto se convierten en tres decisiones explicadas. No otra lista que organizar. No un chatbot que improvisa.',
    'trust.1': 'Sin cuenta obligatoria',
    'trust.2': 'Funciona sin IA en la nube',
    'trust.3': 'Français, English, Deutsch, Español',
    'demo.today': 'Hoy',
    'demo.hello': 'Buenos días, Alex',
    'demo.title': 'Esto es lo que merece tu atención.',
    'demo.dayChanged': 'Mi día ha cambiado',
    'demo.energy': 'Energía',
    'demo.low': 'Baja',
    'demo.normal': 'Normal',
    'demo.high': 'Alta',
    'demo.timeLeft': 'Tiempo restante',
    'demo.recalc': 'Recalcular mi día',
    'demo.recalced': '✓ Día recalculado',
    'demo.close': 'Cerrar',
    'role.now': 'Hacer ahora',
    'role.watch': 'Vigilar',
    'role.protect': 'Proteger esta franja',
    'demo.c1': 'Enviar el presupuesto prometido a Müller',
    'demo.c1d': '<b>25 min</b> · vence mañana · desbloquea 2 acciones',
    'demo.start': 'Empezar',
    'demo.done': 'Hecho',
    'demo.why': '¿Por qué?',
    'demo.schedule': 'Planificar',
    'why.promise': 'Promesa',
    'why.due': 'Plazo',
    'why.dueV': 'Mañana 17:00',
    'why.unblocks': 'Desbloquea',
    'why.unblocksV': '2 acciones',
    'why.effort': 'Esfuerzo',
    'why.free': 'Disponibilidad',
    'why.freeV': '42 min libres',
    'why.goal': 'Objetivo',
    'why.goalV': 'Cerrar con Müller',
    'why.notQ': '¿Por qué no «Rehacer la home»?',
    'why.notA': 'Sin plazo · necesita 90 min · puede esperar al viernes.',
    'demo.c2': 'Respuesta de Léa esperada desde hace 3 días',
    'demo.c2d': '<b>Nada que hacer ahora</b> · revisar esta tarde',
    'demo.c3': 'Preparar la reunión del jueves',
    'demo.c3d': '<b>14:10–15:00</b> · 50 min libres',
    'demo.aside': 'Σ apartó otros 18 elementos',
    'demo.avoided': ' · 2 h 10 de sobrecarga evitada',
    'demo.a1': '<b>7</b> pueden esperar',
    'demo.a2': '<b>4</b> superan tu capacidad',
    'demo.a3': '<b>3</b> menos impacto',
    'demo.a4': '<b>2</b> duplicados agrupados',
    'demo.avoidedHow':
      'Sobrecarga evitada: trabajo que vence en 3 días y ya no cabe en tu día, después de tus reuniones.',
    'float.1': 'Menos que gestionar',
    'float.1d': 'Σ filtra antes de mostrar.',
    'float.2': 'Se adapta a ti',
    'float.2d': 'Tiempos reales, comentarios, hábitos.',
    'proof.todo': 'Lista de tareas',
    'proof.todoD': '→ lo organiza todo',
    'proof.cal': 'Agenda con IA',
    'proof.calD': '→ lo coloca todo',
    'proof.sigmaD': '→ decide qué puede esperar',
    'how.eyebrow': 'Sin caja negra',
    'how.title': 'Una recomendación solo es útil si puedes cuestionarla.',
    'how.lead': 'Σ muestra los hechos detrás de cada decisión — y por qué se dejó otra cosa de lado.',
    'how.1t': '¿Por qué ahora?',
    'how.1d': 'Plazo, promesas, esfuerzo, disponibilidad, dependencias y objetivos están a la vista.',
    'how.2t': '¿Por qué no otra cosa?',
    'how.2d': 'Σ compara lo elegido con lo apartado, sin ocultar el arbitraje.',
    'how.3t': '¿Y si mi día cambia?',
    'how.3d': 'Cambia energía, tiempo restante u hora de salida. Las tres decisiones se recalculan.',
    'how.conf': 'Confianza alta',
    'how.effortV': '25 min (calibrado con tus tiempos reales)',
    'how.cf': 'Sin plazo · 90 min · no bloquea a nadie · puede esperar al viernes.',
    'adapt.eyebrow': 'Tu día no es un horario fijo',
    'adapt.title': '«Estoy agotado y tengo que irme a las 15 h.»',
    'adapt.lead':
      'Σ reduce la carga, protege lo que importa y deja esperar el resto. El plan se adapta a tu realidad, no al revés.',
    'adapt.s1': '😫 Energía baja',
    'adapt.s2': '⏳ Quedan 2 h',
    'adapt.s3': '🚪 Salida 15:00',
    'adapt.plan': 'Nuevo plan',
    'adapt.now': 'Ahora',
    'adapt.nowV': 'Responder al cliente · 12 min',
    'adapt.watch': 'Vigilar',
    'adapt.watchV': 'Factura que vence mañana',
    'adapt.protect': 'Proteger',
    'adapt.protectV': '13:30–14:15 · preparación',
    'coach.title': 'Pregunta a tu propio sistema, no a un chatbot genérico.',
    'coach.lead':
      'Las respuestas parten de tus datos estructurados, citan sus fuentes y pueden proponer un plan para que lo confirmes.',
    'coach.q1': '¿Qué debo hacer ahora?',
    'coach.q2': '¿Qué puede esperar?',
    'coach.q3': '¿Por qué estoy sobrecargado?',
    'coach.q4': '¿Qué ya no avanza?',
    'coach.q5': 'Libérame 2 h mañana.',
    'coach.q6': '¿Por qué habíamos decidido eso?',
    'coach.a1':
      'El presupuesto prometido a Müller es la mejor próxima acción: vence mañana, 25 min estimados, desbloquea dos pasos.',
    'coach.a2':
      'La home y dos tareas internas pueden esperar al viernes sin causar retrasos ni bloquear a nadie.',
    'coach.a3':
      'El viernes supera tu capacidad en unas 1 h 35. Puedo mover «Contabilidad» al jueves y «Home» al lunes sin tocar los plazos de clientes.',
    'coach.a4':
      '«Rediseño web» no tiene ninguna acción desde hace 11 días y se aplazó 4 veces. Siguiente paso más pequeño: listar las 3 páginas (15 min).',
    'coach.a5':
      'Puedo mover «Contabilidad» y «Home» y proteger de 14:00 a 16:00. Nada se aplica sin tu confirmación.',
    'coach.a6':
      'El día 28 se eligió «Presupuesto Müller» en lugar de «Home»: promesa a Müller, vencía al día siguiente, 42 min libres. Lo terminaste.',
    'coach.sources': 'Fuentes: Agenda (6) · Tareas (14) · Proyectos (3)',
    'coach.apply': 'Aplicar este plan',
    'cmd.eyebrow': 'Una sola barra',
    'cmd.title': 'Captura, planifica o pregunta, en lenguaje natural.',
    'cmd.input': 'comida viernes 13h con Marc',
    'cmd.kind': 'Evento detectado',
    'cmd.result': 'Comida con Marc · viernes 13:00',
    'cmd.create': 'Crear',
    'cmd.e1': '«le prometí a Müller el presupuesto el viernes»',
    'cmd.e2': '«estoy agotado y me voy a las 15h»',
    'cmd.e3': '«examen de mates el 14»',
    'priv.eyebrow': 'Local primero, por diseño',
    'priv.title': 'Tu vida no tiene por qué convertirse en datos de una IA en la nube.',
    'priv.lead':
      'El motor de decisión Σ funciona sin modelo de lenguaje. La IA es una capa opcional para entender o reformular — nunca para decidir tus prioridades.',
    'priv.core': 'Motor determinista, explicable, utilizable sin conexión.',
    'priv.coreB': 'Siempre disponible',
    'priv.local': 'IA del navegador o IA local',
    'priv.localD':
      'El modelo integrado del navegador, Ollama o LM Studio, en tu equipo. Σ comprueba cada respuesta.',
    'priv.localB': 'Opcional',
    'priv.never': 'Lo que nunca sale',
    'priv.neverD': 'Finanzas, salud y contenido de correos nunca se envían a un modelo.',
    'priv.neverB': 'Garantizado',
    'priv.p1': '✓ Sin cuenta obligatoria',
    'priv.p2': '✓ Exporta tus datos',
    'priv.p3': '✓ Control fuente por fuente',
    'priv.p4': '✓ Ninguna acción externa silenciosa',
    'priv.p5': '✓ Borrado completo',
    'priv.p6': '✓ Sin IA en la nube obligatoria',
    'learn.eyebrow': 'Personalización real',
    'learn.title': 'Cuanto más lo usas, menos necesitas organizarlo.',
    'learn.1': 'Sueles aplazar lo administrativo después de las 16 h.',
    'learn.1d': 'Σ evita progresivamente esa franja.',
    'learn.2': 'Tus tareas de clientes tardan de media un 18 % más de lo previsto.',
    'learn.2d': 'Las próximas estimaciones se recalibran.',
    'learn.3': 'Le prometiste el presupuesto a Müller.',
    'learn.3d': 'Una promesa va antes que una tarea normal.',
    'learn.4': 'Este proyecto se aplazó 4 veces en 11 días.',
    'learn.4d': 'Σ propone el siguiente paso más pequeño para desbloquearlo.',
    'cmp.eyebrow': 'Una categoría distinta',
    'cmp.title': 'Otras herramientas organizan tu trabajo. Σ arbitra tu atención.',
    'cmp.r1': 'Muestra lo que existe',
    'cmp.r2': 'Coloca el trabajo en la agenda',
    'cmp.r3': 'Decide qué puede esperar',
    'cmp.r4': 'Explica por qué A y no B',
    'cmp.r5': 'Funciona sin IA en la nube',
    'price.eyebrow': 'Sencillo para empezar',
    'price.title': 'Descubre el motor gratis. Pasa a Pro cuando Σ sea tu sistema.',
    'price.freeLead': 'Comprueba en pocos días si tres decisiones valen más que otra lista de tareas.',
    'price.f1': '3 decisiones explicadas al día',
    'price.f2': 'Por qué ahora / por qué no',
    'price.f3': 'Plan del día y «¿y si…?»',
    'price.f4': 'Misiones: examen, entrevista, deporte, lectura…',
    'price.f5': 'Captura en lenguaje natural, IA local',
    'price.f6': 'Coach: 5 análisis al día',
    'price.badge': 'Para el sistema completo',
    'price.month': '/ mes',
    'price.or': 'o',
    'price.year': '/ año',
    'price.p1': 'Fuentes conectadas: agenda, correo, IMAP, redes',
    'price.p2': 'Sincronización entre dispositivos y copia en Drive',
    'price.p3': 'Coach ilimitado',
    'price.p4': 'Finanzas, salud, hogar y carrera',
    'price.p5': 'Proyectos y hábitos ilimitados',
    'final.eyebrow': 'Mañana por la mañana',
    'final.title': 'No abras cinco apps para reconstruir tu día.',
    'final.lead': 'Abre Σ. Mira las tres decisiones. Empieza.',
    'final.meta': 'Local primero · Explicable · Multilingüe · Sin IA en la nube',
    'footer.tagline': 'Una capa de decisión tranquila sobre tu vida digital.',
    'footer.privacy': 'Privacidad',
    'footer.terms': 'Condiciones',
    'footer.support': 'Soporte',
  },
};

const $ = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(sel);
const $$ = <E extends Element = HTMLElement>(sel: string) => [...document.querySelectorAll<E>(sel)];

// Originals (French) are captured once so switching back restores them.
const text = new Map<Element, string>();
const html = new Map<Element, Node[]>();
$$('[data-i18n]').forEach((el) => text.set(el, el.textContent?.trim() ?? ''));
$$('[data-i18n-html]').forEach((el) =>
  html.set(
    el,
    [...el.childNodes].map((n) => n.cloneNode(true)),
  ),
);

/** Builds nodes from the dictionaries' tiny markup (<b>, <span>, <br />) without innerHTML. */
function rich(src: string): Node[] {
  return src
    .split(/(<b>.*?<\/b>|<span>.*?<\/span>|<br \/>)/)
    .filter(Boolean)
    .map((part) => {
      if (part === '<br />') return document.createElement('br');
      const m = /^<(b|span)>(.*)<\/\1>$/.exec(part);
      if (!m) return document.createTextNode(part);
      const node = document.createElement(m[1] as 'b' | 'span');
      node.textContent = m[2] ?? '';
      return node;
    });
}

let lang: Lang = 'fr';
const tr = (key: string, fallback = '') => (lang === 'fr' ? FR[key] : (T[lang][key] ?? FR[key])) ?? fallback;

function renderDate() {
  const el = $('#demo-date');
  if (!el) return;
  const s = new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(),
  );
  el.textContent = s.charAt(0).toUpperCase() + s.slice(1);
}

function apply(next: Lang) {
  lang = next;
  document.documentElement.lang = next;
  text.forEach((fr, el) => {
    const key = el.getAttribute('data-i18n') as string;
    el.textContent = next === 'fr' ? fr : (T[next][key] ?? fr);
  });
  html.forEach((fr, el) => {
    const key = el.getAttribute('data-i18n-html') as string;
    const src = next === 'fr' ? undefined : T[next][key];
    el.replaceChildren(...(src ? rich(src) : fr.map((n) => n.cloneNode(true))));
  });
  // Buttons whose label depends on state.
  $$<HTMLButtonElement>('[data-why-toggle]').forEach((b) => {
    if (b.getAttribute('aria-expanded') === 'true') b.textContent = tr('demo.close');
  });
  const pressed = $<HTMLButtonElement>('.prompt-grid button[aria-pressed="true"]');
  const answer = $('#coach-answer');
  if (pressed && answer)
    answer.textContent = tr(`coach.a${pressed.dataset.q?.slice(1)}`, answer.textContent ?? '');
  renderDate();
  // The app opens in the language chosen here.
  $$<HTMLAnchorElement>('a[data-start]').forEach((a) => {
    const target = new URL(a.getAttribute('href') ?? 'app.html', location.href);
    target.searchParams.set('lang', next);
    a.href = target.pathname.split('/').pop() + target.search;
  });
  try {
    localStorage.setItem('sigma-site-lang', next);
  } catch {
    /* storage unavailable */
  }
}

const select = $<HTMLSelectElement>('#lang');
let initial = 'fr';
try {
  initial = localStorage.getItem('sigma-site-lang') ?? navigator.language.slice(0, 2);
} catch {
  initial = navigator.language.slice(0, 2);
}
if (!['fr', 'en', 'de', 'es'].includes(initial)) initial = 'fr';
if (select) {
  select.value = initial;
  select.addEventListener('change', () => apply(select.value as Lang));
}
apply(initial as Lang);

// Footer and prices from the deployment config.
const year = $('#year');
if (year) year.textContent = String(new Date().getFullYear());
const legal = $('#legal-entity');
if (legal) legal.textContent = config.legal.entity ? ` — ${config.legal.entity}` : '';
const monthly = $('#price-monthly');
if (monthly && config.payments.monthlyPrice) monthly.textContent = config.payments.monthlyPrice;
const annual = $('#price-annual');
if (annual && config.payments.annualPrice) annual.textContent = config.payments.annualPrice;

// Demo: "Why?" drawers.
$$<HTMLButtonElement>('[data-why-toggle]').forEach((button) =>
  button.addEventListener('click', () => {
    const drawer = document.getElementById(button.getAttribute('aria-controls') ?? '');
    if (!drawer) return;
    const open = drawer.hidden;
    drawer.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open
      ? tr('demo.close')
      : ((lang === 'fr' ? undefined : T[lang]['demo.why']) ?? text.get(button) ?? '');
  }),
);

// Demo: "My day has changed".
const dayButton = $<HTMLButtonElement>('#dayChangedButton');
const dayPanel = $('#dayChangePanel');
if (dayButton && dayPanel)
  dayButton.addEventListener('click', () => {
    dayPanel.hidden = !dayPanel.hidden;
    dayButton.setAttribute('aria-expanded', String(!dayPanel.hidden));
  });
$$<HTMLButtonElement>('.segmented button').forEach((button) =>
  button.addEventListener('click', () => {
    button.parentElement?.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('active', b === button);
      b.setAttribute('aria-pressed', String(b === button));
    });
  }),
);
const recalc = $<HTMLButtonElement>('#recalculateButton');
if (recalc)
  recalc.addEventListener('click', () => {
    const old = recalc.textContent;
    recalc.textContent = tr('demo.recalced');
    recalc.disabled = true;
    setTimeout(() => {
      recalc.textContent = old;
      recalc.disabled = false;
    }, 1600);
  });

// "No black box" steps.
$$<HTMLButtonElement>('.explain-step').forEach((step) =>
  step.addEventListener('click', () =>
    $$('.explain-step').forEach((s) => {
      s.classList.toggle('active', s === step);
      s.setAttribute('aria-pressed', String(s === step));
    }),
  ),
);

// Coach demo.
$$<HTMLButtonElement>('.prompt-grid button').forEach((button) =>
  button.addEventListener('click', () => {
    $$('.prompt-grid button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
    const answer = $('#coach-answer');
    if (answer) answer.textContent = tr(`coach.a${button.dataset.q?.slice(1)}`, answer.textContent ?? '');
  }),
);

// Reveal on scroll.
const reveal = $$('.reveal');
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          io.unobserve(e.target);
        }
      }),
    { threshold: 0.08 },
  );
  reveal.forEach((el) => io.observe(el));
} else reveal.forEach((el) => el.classList.add('visible'));
