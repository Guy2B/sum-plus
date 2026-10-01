// Scheduled every 3 hours: anonymous counters → daily aggregates. See functions/src/handlers/analytics.ts.
export { aggregateHandler as handler } from '../../functions/src/netlify';
