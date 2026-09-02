import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import 'dotenv/config';
import { pool } from '../config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', '..', '..', 'db', 'schema.sql');

async function migrate() {
  const sql = readFileSync(schemaPath, 'utf-8');
  console.log(`Aplicando esquema desde ${schemaPath} ...`);
  await pool.query(sql);
  console.log('Esquema aplicado correctamente.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Error aplicando el esquema:', err);
  process.exit(1);
});
