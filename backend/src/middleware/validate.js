import { validationResult } from 'express-validator';
import { BadRequestError } from '../utils/errors.js';

/**
 * Middleware que revisa el resultado de las validaciones de express-validator
 * definidas en la ruta y corta con 400 si hay errores.
 */
export function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    return next(new BadRequestError('Datos inválidos', result.array()));
  }
  next();
}
