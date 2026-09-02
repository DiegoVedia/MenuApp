import { Router } from 'express';
import { body, param } from 'express-validator';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(requireAuth);

const RESTRICTION_TYPES = ['alergia', 'no_me_gusta', 'evitar'];

// --- Restricciones por ingrediente (alergias, no me gusta, evitar) ---
router.get(
  '/ingredients',
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT r.*, i.name AS ingredient_name
       FROM user_ingredient_restrictions r
       JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.user_id = $1
       ORDER BY i.name`,
      [req.userId]
    );
    res.json(result.rows);
  })
);

router.post(
  '/ingredients',
  [
    body('ingredient_id').isUUID(),
    body('type').isIn(RESTRICTION_TYPES),
    body('is_hard').optional().isBoolean(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { ingredient_id: ingredientId, type, is_hard: isHard } = req.body;
    const result = await query(
      `INSERT INTO user_ingredient_restrictions (user_id, ingredient_id, type, is_hard)
       VALUES ($1, $2, $3, COALESCE($4, true))
       ON CONFLICT (user_id, ingredient_id) DO UPDATE SET type = EXCLUDED.type, is_hard = EXCLUDED.is_hard
       RETURNING *`,
      [req.userId, ingredientId, type, isHard]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.delete(
  '/ingredients/:ingredientId',
  [param('ingredientId').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await query('DELETE FROM user_ingredient_restrictions WHERE user_id = $1 AND ingredient_id = $2', [
      req.userId,
      req.params.ingredientId,
    ]);
    res.status(204).send();
  })
);

// --- Límites por tag (ej: "carne_roja" <= 2 veces por semana) ---
router.get(
  '/tag-limits',
  asyncHandler(async (req, res) => {
    const result = await query(
      'SELECT * FROM user_tag_limits WHERE user_id = $1 ORDER BY tag',
      [req.userId]
    );
    res.json(result.rows);
  })
);

router.post(
  '/tag-limits',
  [
    body('tag').isString().trim().notEmpty().isLength({ max: 100 }),
    body('max_per_week').isInt({ min: 0, max: 50 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { tag, max_per_week: maxPerWeek } = req.body;
    const result = await query(
      `INSERT INTO user_tag_limits (user_id, tag, max_per_week)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, tag) DO UPDATE SET max_per_week = EXCLUDED.max_per_week
       RETURNING *`,
      [req.userId, tag.toLowerCase(), maxPerWeek]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.delete(
  '/tag-limits/:id',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await query('DELETE FROM user_tag_limits WHERE user_id = $1 AND id = $2', [req.userId, req.params.id]);
    res.status(204).send();
  })
);

export default router;
