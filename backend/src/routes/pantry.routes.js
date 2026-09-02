import { Router } from 'express';
import { body, param } from 'express-validator';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT p.*, i.name AS ingredient_name, i.category, i.default_unit
       FROM pantry_items p
       JOIN ingredients i ON i.id = p.ingredient_id
       WHERE p.user_id = $1
       ORDER BY i.name`,
      [req.userId]
    );
    res.json(result.rows);
  })
);

// Crea o actualiza (upsert) la cantidad de un ingrediente en la despensa.
router.put(
  '/:ingredientId',
  [
    param('ingredientId').isUUID(),
    body('quantity').isFloat({ min: 0 }),
    body('unit').isString().trim().notEmpty(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { ingredientId } = req.params;
    const { quantity, unit } = req.body;

    const ingredient = await query(
      'SELECT id FROM ingredients WHERE id = $1 AND user_id = $2',
      [ingredientId, req.userId]
    );
    if (ingredient.rows.length === 0) {
      throw new NotFoundError('Ingrediente no encontrado');
    }

    const result = await query(
      `INSERT INTO pantry_items (user_id, ingredient_id, quantity, unit, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (user_id, ingredient_id)
       DO UPDATE SET quantity = EXCLUDED.quantity, unit = EXCLUDED.unit, updated_at = now()
       RETURNING *`,
      [req.userId, ingredientId, quantity, unit]
    );
    res.json(result.rows[0]);
  })
);

router.delete(
  '/:ingredientId',
  [param('ingredientId').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await query('DELETE FROM pantry_items WHERE user_id = $1 AND ingredient_id = $2', [
      req.userId,
      req.params.ingredientId,
    ]);
    res.status(204).send();
  })
);

export default router;
