/**
 * Turns the first bytes of a raw RFC 822 message into a short plain-text
 * snippet: headers are dropped, the first text/plain (or text/html) part is
 * decoded (quoted-printable / base64) and markup is stripped.
 */
export function snippetFromSource(raw: string, max = 300): string {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headers = headerEnd >= 0 ? raw.slice(0, headerEnd) : '';
  let body = headerEnd >= 0 ? raw.slice(headerEnd).trim() : raw;

  const boundary = /boundary="?([^";\r\n]+)"?/i.exec(headers)?.[1];
  let partHeaders = headers;
  if (boundary) {
    const parts = body.split(`--${boundary}`).map((p) => p.trim()).filter((p) => p && p !== '--');
    const pick = parts.find((p) => /content-type:\s*text\/plain/i.test(p)) ?? parts.find((p) => /content-type:\s*text\/html/i.test(p)) ?? parts[0] ?? '';
    const split = pick.search(/\r?\n\r?\n/);
    partHeaders = split >= 0 ? pick.slice(0, split) : '';
    body = split >= 0 ? pick.slice(split).trim() : pick;
    // Nested multipart (e.g. multipart/alternative inside multipart/mixed).
    const nested = /boundary="?([^";\r\n]+)"?/i.exec(partHeaders)?.[1];
    if (nested) return snippetFromSource(`${partHeaders}\r\n\r\n${body}`, max);
  }

  const encoding = /content-transfer-encoding:\s*([\w-]+)/i.exec(partHeaders)?.[1]?.toLowerCase();
  if (encoding === 'base64') {
    try {
      body = Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    } catch {
      body = '';
    }
  } else if (encoding === 'quoted-printable') {
    body = decodeQuotedPrintable(body);
  }
  if (/content-type:\s*text\/html/i.test(partHeaders) || /<\/?(html|div|p|br|span|table)\b/i.test(body)) {
    body = body
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
  return body
    .split(/\r?\n/)
    .filter((l) => !/^>/.test(l.trim()))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function decodeQuotedPrintable(s: string): string {
  const bytes = s
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  try {
    return Buffer.from(bytes, 'latin1').toString('utf8');
  } catch {
    return bytes;
  }
}
