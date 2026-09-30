import '../styles/site.css';
import { config } from '../config';

type Dict = Record<string, string>;

// French is authored in index.html; other languages override by key.
const T: Record<'en' | 'de' | 'es', Dict> = {
  en: {
    'nav.features': 'Features',
    'nav.editions': 'Editions',
    'nav.pricing': 'Pricing',
    'cta.open': 'Open Σ',
    'hero.eyebrow': 'Decision-first · Multilingual · Local-first',
    'hero.title': 'Turn scattered signals into the next useful action.',
    'hero.lead':
      'Σ observes the sources you authorise, connects work and life context, and explains what deserves attention — three recommendations a day, not fifteen dashboards.',
    'cta.start': 'Start free',
    'cta.how': 'See how it works',
    'cta.pro': 'Go Pro',
    'hero.t1': 'No account required',
    'hero.t2': 'Your data stays on your device by default',
    'hero.t3': 'Français, English, Deutsch, Español',
    'features.title': 'A calm decision layer above the tools you already use',
    'f1.t': 'Today',
    'f1.d': 'Up to three justified actions with score, reasons and uncertainties.',
    'f2.t': 'Attention',
    'f2.d': 'One queue for replies, opportunities, admin and capacity signals.',
    'f3.t': 'Plan',
    'f3.d': 'Real daily capacity (meetings, energy), protected blocks and a suggested order.',
    'f4.t': 'Σ Coach',
    'f4.d': 'Answers grounded only in your data, citing their sources and inventing nothing.',
    'f5.t': 'Sources',
    'f5.d':
      'Gmail, Outlook, IMAP, Google Calendar, Microsoft, YouTube, LinkedIn, X, TikTok, Apple Health, Health Connect.',
    'f6.t': 'Privacy',
    'f6.d': 'Local-first, export anytime, optional cloud sync, complete deletion in one click.',
    'editions.title': 'One engine, five editions',
    'editions.lead': 'Choose one active workspace. Switch later without losing data.',
    'how.title': 'Simple enough to become a habit',
    'how.1t': 'Choose your mode',
    'how.1d': 'Student, Solo, Creator, Life or Nomad.',
    'how.2t': 'Capture real signals',
    'how.2d': 'Tasks, calendar, mail, money, energy, learning.',
    'how.3t': 'Act on one recommendation',
    'how.3d': 'Σ highlights the most useful next step — and explains why.',
    'pricing.title': 'Start free. Upgrade when the full system matters.',
    'pricing.free': 'One active workspace, local essentials, export, 5 Coach analyses a day.',
    'pricing.month': '/ month',
    'pricing.or': 'or',
    'pricing.year': '/ year',
    'pricing.pro': 'Finance, health, household, career, connected sources, cloud sync, unlimited Coach.',
    'footer.privacy': 'Privacy',
    'footer.terms': 'Terms',
    'footer.support': 'Support',
  },
  de: {
    'nav.features': 'Funktionen',
    'nav.editions': 'Editionen',
    'nav.pricing': 'Preise',
    'cta.open': 'Σ öffnen',
    'hero.eyebrow': 'Entscheidung zuerst · Mehrsprachig · Lokal zuerst',
    'hero.title': 'Aus verstreuten Signalen wird die nächste sinnvolle Aktion.',
    'hero.lead':
      'Σ beobachtet die Quellen, die Sie freigeben, verbindet Arbeit und Leben und erklärt, was Aufmerksamkeit verdient – drei Empfehlungen pro Tag statt fünfzehn Dashboards.',
    'cta.start': 'Kostenlos starten',
    'cta.how': 'So funktioniert es',
    'cta.pro': 'Pro werden',
    'hero.t1': 'Kein Konto erforderlich',
    'hero.t2': 'Ihre Daten bleiben standardmäßig auf Ihrem Gerät',
    'hero.t3': 'Français, English, Deutsch, Español',
    'features.title': 'Eine ruhige Entscheidungsebene über Ihren Werkzeugen',
    'f1.t': 'Heute',
    'f1.d': 'Bis zu drei begründete Aktionen mit Score, Gründen und Unsicherheiten.',
    'f2.t': 'Aufmerksamkeit',
    'f2.d': 'Eine Warteschlange für Antworten, Chancen, Verwaltung und Kapazität.',
    'f3.t': 'Plan',
    'f3.d': 'Echte Tageskapazität (Termine, Energie), geschützte Blöcke und Reihenfolge.',
    'f4.t': 'Σ Coach',
    'f4.d': 'Antworten nur auf Basis Ihrer Daten – mit Quellen, ohne Erfindungen.',
    'f5.t': 'Quellen',
    'f5.d':
      'Gmail, Outlook, IMAP, Google Kalender, Microsoft, YouTube, LinkedIn, X, TikTok, Apple Health, Health Connect.',
    'f6.t': 'Datenschutz',
    'f6.d': 'Lokal zuerst, jederzeit exportieren, optionale Cloud-Synchronisierung, vollständige Löschung.',
    'editions.title': 'Ein Motor, fünf Editionen',
    'editions.lead': 'Wählen Sie einen aktiven Bereich. Wechsel ohne Datenverlust.',
    'how.title': 'Einfach genug für eine Gewohnheit',
    'how.1t': 'Modus wählen',
    'how.1d': 'Student, Solo, Creator, Life oder Nomad.',
    'how.2t': 'Echte Signale erfassen',
    'how.2d': 'Aufgaben, Kalender, Mail, Geld, Energie, Lernen.',
    'how.3t': 'Einer Empfehlung folgen',
    'how.3d': 'Σ zeigt den nützlichsten nächsten Schritt – und warum.',
    'pricing.title': 'Kostenlos starten. Upgrade, wenn das ganze System zählt.',
    'pricing.free': 'Ein aktiver Bereich, lokale Grundfunktionen, Export, 5 Coach-Analysen pro Tag.',
    'pricing.month': '/ Monat',
    'pricing.or': 'oder',
    'pricing.year': '/ Jahr',
    'pricing.pro':
      'Finanzen, Gesundheit, Haushalt, Karriere, verbundene Quellen, Cloud-Sync, unbegrenzter Coach.',
    'footer.privacy': 'Datenschutz',
    'footer.terms': 'Bedingungen',
    'footer.support': 'Support',
  },
  es: {
    'nav.features': 'Funciones',
    'nav.editions': 'Ediciones',
    'nav.pricing': 'Precios',
    'cta.open': 'Abrir Σ',
    'hero.eyebrow': 'Decisión primero · Multilingüe · Local primero',
    'hero.title': 'Convierte señales dispersas en la siguiente acción útil.',
    'hero.lead':
      'Σ observa las fuentes que autorizas, conecta trabajo y vida, y explica qué merece tu atención: tres recomendaciones al día, no quince paneles.',
    'cta.start': 'Empezar gratis',
    'cta.how': 'Cómo funciona',
    'cta.pro': 'Pasar a Pro',
    'hero.t1': 'Sin cuenta obligatoria',
    'hero.t2': 'Tus datos se quedan en tu dispositivo por defecto',
    'hero.t3': 'Français, English, Deutsch, Español',
    'features.title': 'Una capa de decisión tranquila sobre tus herramientas',
    'f1.t': 'Hoy',
    'f1.d': 'Hasta tres acciones justificadas con puntuación, razones e incertidumbres.',
    'f2.t': 'Atención',
    'f2.d': 'Una sola cola para respuestas, oportunidades, trámites y capacidad.',
    'f3.t': 'Plan',
    'f3.d': 'Capacidad real del día (reuniones, energía), bloques protegidos y orden sugerido.',
    'f4.t': 'Σ Coach',
    'f4.d': 'Respuestas basadas solo en tus datos, citando fuentes y sin inventar nada.',
    'f5.t': 'Fuentes',
    'f5.d':
      'Gmail, Outlook, IMAP, Google Calendar, Microsoft, YouTube, LinkedIn, X, TikTok, Apple Salud, Health Connect.',
    'f6.t': 'Privacidad',
    'f6.d': 'Local primero, exporta cuando quieras, sincronización opcional, borrado completo con un clic.',
    'editions.title': 'Un motor, cinco ediciones',
    'editions.lead': 'Elige un espacio activo. Cámbialo sin perder datos.',
    'how.title': 'Lo bastante simple para ser un hábito',
    'how.1t': 'Elige tu modo',
    'how.1d': 'Student, Solo, Creator, Life o Nomad.',
    'how.2t': 'Captura señales reales',
    'how.2d': 'Tareas, agenda, correo, dinero, energía, aprendizaje.',
    'how.3t': 'Actúa sobre una recomendación',
    'how.3d': 'Σ destaca el paso más útil y explica por qué.',
    'pricing.title': 'Empieza gratis. Mejora cuando el sistema completo importe.',
    'pricing.free': 'Un espacio activo, lo esencial en local, exportación, 5 análisis del Coach al día.',
    'pricing.month': '/ mes',
    'pricing.or': 'o',
    'pricing.year': '/ año',
    'pricing.pro': 'Finanzas, salud, hogar, carrera, fuentes conectadas, sincronización, Coach ilimitado.',
    'footer.privacy': 'Privacidad',
    'footer.terms': 'Condiciones',
    'footer.support': 'Soporte',
  },
};

const originals = new Map<Element, string>();
document.querySelectorAll('[data-i18n]').forEach((el) => originals.set(el, el.textContent ?? ''));

function apply(lang: string) {
  const dict = (T as Record<string, Dict>)[lang];
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n') as string;
    el.textContent = dict?.[key] ?? originals.get(el) ?? '';
  });
  try {
    localStorage.setItem('sigma-site-lang', lang);
  } catch {
    /* ignore */
  }
}

const select = document.getElementById('lang') as HTMLSelectElement;
let initial = 'fr';
try {
  initial = localStorage.getItem('sigma-site-lang') ?? navigator.language.slice(0, 2);
} catch {
  initial = navigator.language.slice(0, 2);
}
if (!['fr', 'en', 'de', 'es'].includes(initial)) initial = 'fr';
select.value = initial;
apply(initial);
select.addEventListener('change', () => apply(select.value));

(document.getElementById('year') as HTMLElement).textContent = String(new Date().getFullYear());
(document.getElementById('legal-entity') as HTMLElement).textContent = config.legal.entity
  ? `— ${config.legal.entity}`
  : '';
(document.getElementById('price-monthly') as HTMLElement).textContent = config.payments.monthlyPrice;
(document.getElementById('price-annual') as HTMLElement).textContent = config.payments.annualPrice;
