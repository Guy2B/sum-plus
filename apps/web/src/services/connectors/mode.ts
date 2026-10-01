/**
 * Silent mode for automatic syncs: connectors may only use tokens they can get
 * without showing anything. When a source would need a click (Google web token
 * expired, Microsoft session gone), it throws NeedsUserError and the app shows a
 * discreet "reconnect" link instead of popping a window.
 */
export class NeedsUserError extends Error {
  constructor(public readonly source: string) {
    super('needs-user');
  }
}

let depth = 0;
export const isSilent = () => depth > 0;

export async function silently<T>(fn: () => Promise<T>): Promise<T> {
  depth++;
  try {
    return await fn();
  } finally {
    depth--;
  }
}
