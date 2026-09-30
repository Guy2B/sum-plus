/** Removes personal data and secrets before anything reaches Cloud Logging. */
export function scrubForLog(text: string): string {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email>')
    .replace(/(ya29\.|eyJ|EAA)[A-Za-z0-9._-]{10,}/g, '<token>')
    .replace(/([?&](code|token|access_token|id_token|state|password)=)[^&\s]+/gi, '$1<redacted>')
    .replace(/\b\d{9,}\b/g, '<number>')
    .slice(0, 4000);
}
