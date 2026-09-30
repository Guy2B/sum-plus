import '../styles/site.css';
import { config } from '../config';

// Empty legal identity stays visibly incomplete; the release check blocks launch until it is set.
const MISSING = '[à compléter]';

const fill = (key: string, value: string) =>
  document.querySelectorAll(`[data-legal="${key}"]`).forEach((el) => {
    el.textContent = value || MISSING;
  });

fill('entity', config.legal.entity);
fill('address', config.legal.address);
fill('email', config.legal.supportEmail);
fill('price-monthly', config.payments.monthlyPrice);
fill('price-annual', config.payments.annualPrice);
fill(
  'date',
  new Date(2026, 9, 1).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
);

document.querySelectorAll<HTMLAnchorElement>('[data-legal="email-link"]').forEach((a) => {
  if (config.legal.supportEmail) a.href = `mailto:${config.legal.supportEmail}`;
});
