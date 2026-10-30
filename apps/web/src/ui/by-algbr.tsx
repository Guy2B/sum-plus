/** "by Al.G.B.r." credit: opens the studio (algbr.de) in the app's language; it has no Spanish version. */
import { locale } from '../i18n';

export function ByAlgbr({ plain = false }: { plain?: boolean }) {
  const l = locale.value;
  return (
    <a
      class={plain ? 'by-algbr' : 'byline by-algbr'}
      href={`https://algbr.de/${l === 'es' ? 'en' : l}/`}
      target="_blank"
      rel="noopener"
      title="Al.G.B.r. Digital Studio"
    >
      by Al.G.B.r.
    </a>
  );
}
