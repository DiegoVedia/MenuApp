import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { body } from 'express-validator';
import { query } from '../config/db.js';
import { validate } from '../middleware/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ConflictError, UnauthorizedError } from '../utils/errors.js';

const router = Router();

function signToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

router.post(
  '/register',
  [
    body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('La contraseña debe tener al menos 8 caracteres'),
    body('name').optional().isString().trim().isLength({ max: 200 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body;

    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      throw new ConflictError('Ya existe una cuenta con ese email');
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ($1, $2, $3)
       RETURNING id, email, name, lookback_weeks, created_at`,
      [email, passwordHash, name || null]
    );

    const user = result.rows[0];
    const token = signToken(user.id);
    res.status(201).json({ token, user });
  })
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('Email inválido').normalizeEmail(),
    body('password').notEmpty().withMessage('Falta la contraseña'),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    const result = await query(
      'SELECT id, email, name, password_hash, lookback_weeks, created_at FROM users WHERE email = $1',
      [email]
    );
    const user = result.rows[0];
    if (!user) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const matches = await bcrypt.compare(password, user.password_hash);
    if (!matches) {
      throw new UnauthorizedError('Credenciales inválidas');
    }

    const token = signToken(user.id);
    delete user.password_hash;
    res.json({ token, user });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await query(
      'SELECT id, email, name, lookback_weeks, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    res.json(result.rows[0]);
  })
);

router.patch(
  '/me',
  requireAuth,
  [
    body('name').optional().isString().trim().isLength({ max: 200 }),
    body('lookback_weeks').optional().isInt({ min: 0, max: 52 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, lookback_weeks: lookbackWeeks } = req.body;
    const result = await query(
      `UPDATE users SET
         name = COALESCE($2, name),
         lookback_weeks = COALESCE($3, lookback_weeks)
       WHERE id = $1
       RETURNING id, email, name, lookback_weeks, created_at`,
      [req.userId, name, lookbackWeeks]
    );
    res.json(result.rows[0]);
  })
);

export default router;
