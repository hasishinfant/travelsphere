import { extendTrustStore } from './tlsTrust.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';
import { createFcmSender, dispatchPending } from './integrations/fcm.js';

const added = extendTrustStore();
if (added) console.log(`[tls] added ${added} system root certificates to the trust store`);

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = createApp(config, db);

// Push delivery of risk warnings (FCM is credential-dependent; without it alerts remain in-app)
const push = config.FCM_PROJECT_ID && config.FCM_SERVICE_ACCOUNT_JSON
  ? createFcmSender(config.FCM_PROJECT_ID, config.FCM_SERVICE_ACCOUNT_JSON) : null;
if (!push) console.log('[push] FCM not configured — risk warnings are delivered in-app only');
const pushTimer = setInterval(() => {
  dispatchPending(db, push).catch(err => console.warn('[push] dispatch failed:', (err as Error).message));
}, 60_000);

const server = app.listen(config.PORT, () => {
  console.log(`TravelSphere API listening on :${config.PORT} (auth: ${config.AUTH_MODE}, env: ${config.NODE_ENV})`);
});

const shutdown = () => {
  clearInterval(pushTimer);
  server.close(() => db.end().finally(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
