import { ApiError } from '../utils/errors.js';

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
  }

  // Errores conocidos de Postgres
  if (err.code === '23505') {
    return res.status(409).json({ error: 'El recurso ya existe (violación de unicidad)' });
  }
  if (err.code === '23503') {
    return res.status(409).json({ error: 'Referencia inválida a otro recurso' });
  }
  if (err.code === '23514') {
    return res.status(400).json({ error: 'Valor fuera del rango permitido' });
  }

  console.error(err);
  return res.status(500).json({ error: 'Error interno del servidor' });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Ruta no encontrada: ${req.method} ${req.originalUrl}` });
}
