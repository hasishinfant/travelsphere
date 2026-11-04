import { extendTrustStore } from './tlsTrust.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createApp } from './app.js';

const added = extendTrustStore();
if (added) console.log(`[tls] added ${added} system root certificates to the trust store`);

const config = loadConfig();
const db = createPool(config.DATABASE_URL);
const app = createApp(config, db);

const server = app.listen(config.PORT, () => {
  console.log(`TravelSphere API listening on :${config.PORT} (auth: ${config.AUTH_MODE}, env: ${config.NODE_ENV})`);
});

const shutdown = () => {
  server.close(() => db.end().finally(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
