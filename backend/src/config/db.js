import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// Por default, node-pg parsea las columnas `date` (OID 1082) como objetos
// Date de JS en base al timezone del proceso, lo cual puede correr la fecha
// un día para atrás/adelante según el TZ del servidor. Como acá tratamos
// las fechas siempre como 'YYYY-MM-DD' (semanas, días de uso, etc.), las
// dejamos como string tal cual vienen de Postgres.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('Unexpected error on idle PostgreSQL client', err);
  process.exit(1);
});

/**
 * Ejecuta una query parametrizada.
 * @param {string} text
 * @param {Array<any>} params
 */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Ejecuta una función dentro de una transacción, con rollback automático si falla.
 * @param {(client: pg.PoolClient) => Promise<any>} fn
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
