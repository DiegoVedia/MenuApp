import { Router } from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const CATEGORIES = [
  'verduleria', 'carniceria', 'almacen', 'lacteos',
  'panaderia', 'congelados', 'bebidas', 'limpieza', 'otros',
];

async function getOwnedIngredient(userId, id) {
  const result = await query(
    'SELECT * FROM ingredients WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Ingrediente no encontrado');
  }
  return result.rows[0];
}

// GET /api/ingredients?search=&category=
router.get(
  '/',
  [
    queryValidator('search').optional().isString().trim(),
    queryValidator('category').optional().isIn(CATEGORIES),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { search, category } = req.query;
    const conditions = ['user_id = $1'];
    const params = [req.userId];

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`normalized_name LIKE $${params.length}`);
    }
    if (category) {
      params.push(category);
      conditions.push(`category = $${params.length}`);
    }

    const result = await query(
      `SELECT * FROM ingredients WHERE ${conditions.join(' AND ')} ORDER BY name ASC`,
      params
    );
    res.json(result.rows);
  })
);

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const ingredient = await getOwnedIngredient(req.userId, req.params.id);
    const conversions = await query(
      'SELECT id, from_unit, factor FROM ingredient_unit_conversions WHERE ingredient_id = $1',
      [ingredient.id]
    );
    res.json({ ...ingredient, unit_conversions: conversions.rows });
  })
);

router.post(
  '/',
  [
    body('name').isString().trim().notEmpty().isLength({ max: 200 }),
    body('default_unit').isString().trim().notEmpty().isLength({ max: 50 }),
    body('category').optional().isIn(CATEGORIES),
    body('estimated_price').optional().isFloat({ min: 0 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { name, default_unit: defaultUnit, category, estimated_price: estimatedPrice } = req.body;
    const result = await query(
      `INSERT INTO ingredients (user_id, name, default_unit, category, estimated_price, price_updated_at)
       VALUES ($1, $2, $3, COALESCE($4::ingredient_category, 'otros'), $5::numeric, CASE WHEN $5::numeric IS NOT NULL THEN now() END)
       RETURNING *`,
      [req.userId, name, defaultUnit, category, estimatedPrice]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 200 }),
    body('default_unit').optional().isString().trim().notEmpty().isLength({ max: 50 }),
    body('category').optional().isIn(CATEGORIES),
    body('estimated_price').optional().isFloat({ min: 0 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    await getOwnedIngredient(req.userId, req.params.id);
    const { name, default_unit: defaultUnit, category, estimated_price: estimatedPrice } = req.body;
    const result = await query(
      `UPDATE ingredients SET
         name = COALESCE($3, name),
         default_unit = COALESCE($4, default_unit),
         category = COALESCE($5::ingredient_category, category),
         estimated_price = COALESCE($6::numeric, estimated_price),
         price_updated_at = CASE WHEN $6::numeric IS NOT NULL THEN now() ELSE price_updated_at END
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.id, req.userId, name, defaultUnit, category, estimatedPrice]
    );
    res.json(result.rows[0]);
  })
);

router.delete(
  '/:id',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await getOwnedIngredient(req.userId, req.params.id);
    await query('DELETE FROM ingredients WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.status(204).send();
  })
);

// --- Conversiones de unidad (ej: 1 diente = 5 g) ---
router.post(
  '/:id/unit-conversions',
  [
    param('id').isUUID(),
    body('from_unit').isString().trim().notEmpty().isLength({ max: 50 }),
    body('factor').isFloat({ gt: 0 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    await getOwnedIngredient(req.userId, req.params.id);
    const { from_unit: fromUnit, factor } = req.body;
    const result = await query(
      `INSERT INTO ingredient_unit_conversions (ingredient_id, from_unit, factor)
       VALUES ($1, $2, $3)
       ON CONFLICT (ingredient_id, from_unit) DO UPDATE SET factor = EXCLUDED.factor
       RETURNING *`,
      [req.params.id, fromUnit, factor]
    );
    res.status(201).json(result.rows[0]);
  })
);

router.delete(
  '/:id/unit-conversions/:conversionId',
  [param('id').isUUID(), param('conversionId').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await getOwnedIngredient(req.userId, req.params.id);
    await query(
      'DELETE FROM ingredient_unit_conversions WHERE id = $1 AND ingredient_id = $2',
      [req.params.conversionId, req.params.id]
    );
    res.status(204).send();
  })
);

export default router;
