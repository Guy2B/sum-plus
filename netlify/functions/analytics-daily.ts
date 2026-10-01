// Scheduled every morning: retention, purge, digest. See functions/src/handlers/analytics.ts.
export { dailyHandler as handler } from '../../functions/src/netlify';
