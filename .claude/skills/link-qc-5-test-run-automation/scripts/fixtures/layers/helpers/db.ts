// Fixture driver adapter for the validator self-test (stands in for helpers/db.ts). Never executed.
// The one place a driver is imported; the connection comes only from the QC-named variable.
import { Client } from 'pg';
export function dbClientFromEnv() {
  return new Client({ connectionString: process.env.QA_DB_URL });
}
