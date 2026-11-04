// Creates a fresh throwaway database for the test run and applies all migrations.
import pg from 'pg';
import { migrate } from '../src/migrate.js';

const ADMIN_URL = process.env.TEST_ADMIN_DATABASE_URL || 'postgres://localhost:5432/postgres';
const TEST_DB = 'travelsphere_api_test';

export async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.query(`create database ${TEST_DB}`);
  await admin.end();
  const url = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB}`);
  await migrate(url, { local: true, log: () => undefined });
  process.env.TEST_DATABASE_URL = url;
}

export async function teardown() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`drop database if exists ${TEST_DB} with (force)`);
  await admin.end();
}
