import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../utils/errors.js';

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return next(new UnauthorizedError('Falta el token de autenticación'));
  }

  const token = header.slice('Bearer '.length);
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    next(new UnauthorizedError('Token inválido o expirado'));
  }
}
