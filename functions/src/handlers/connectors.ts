import { onCall } from 'firebase-functions/v2/https';
import { audit, callableDefaults, db, requireAuth } from '../lib/runtime';

/**
 * Deletes every stored connector credential of the caller. Used by the client
 * before erasing its account when the full server-side deleteMyAccount is not
 * available (free hosting of the connector API).
 */
export const purgeMyConnectors = onCall(callableDefaults, async (req) => {
  const uid = requireAuth(req);
  const snap = await db.collection(`private/${uid}/connectors`).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  await audit(uid, 'connectors.purged', { count: snap.size });
  return { deleted: snap.size };
});
