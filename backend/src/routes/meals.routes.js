import { Router } from 'express';
import { body, param, query as queryValidator } from 'express-validator';
import { query, withTransaction } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';
import { scaleIngredients } from '../services/scaling.service.js';

const router = Router();
router.use(requireAuth);

const MEAL_TYPES = ['desayuno', 'almuerzo', 'cena', 'snack'];

async function getOwnedMeal(userId, id) {
  const result = await query('SELECT * FROM meals WHERE id = $1 AND user_id = $2', [id, userId]);
  if (result.rows.length === 0) {
    throw new NotFoundError('Comida no encontrada');
  }
  return result.rows[0];
}

async function getMealIngredients(mealId) {
  const result = await query(
    `SELECT mi.id, mi.ingredient_id, mi.quantity, mi.unit, mi.notes, mi.is_optional,
            i.name AS ingredient_name, i.default_unit, i.category
     FROM meal_ingredients mi
     JOIN ingredients i ON i.id = mi.ingredient_id
     WHERE mi.meal_id = $1
     ORDER BY i.name`,
    [mealId]
  );
  return result.rows;
}

// Reemplaza por completo la lista de ingredientes de una comida dentro de una transacción.
async function replaceMealIngredients(client, mealId, ingredients) {
  await client.query('DELETE FROM meal_ingredients WHERE meal_id = $1', [mealId]);
  for (const ing of ingredients) {
    await client.query(
      `INSERT INTO meal_ingredients (meal_id, ingredient_id, quantity, unit, notes, is_optional)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, false))`,
      [mealId, ing.ingredient_id, ing.quantity, ing.unit, ing.notes || null, ing.is_optional]
    );
  }
}

const ingredientItemValidators = [
  body('ingredients').isArray({ min: 0 }),
  body('ingredients.*.ingredient_id').isUUID(),
  body('ingredients.*.quantity').isFloat({ gt: 0 }),
  body('ingredients.*.unit').isString().trim().notEmpty(),
  body('ingredients.*.notes').optional({ nullable: true }).isString(),
  body('ingredients.*.is_optional').optional().isBoolean(),
];

// GET /api/meals?type=&tag=&search=
router.get(
  '/',
  [
    queryValidator('type').optional().isIn(MEAL_TYPES),
    queryValidator('tag').optional().isString().trim(),
    queryValidator('search').optional().isString().trim(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { type, tag, search } = req.query;
    const conditions = ['user_id = $1', 'is_active = true'];
    const params = [req.userId];

    if (type) {
      params.push(type);
      conditions.push(`meal_type = $${params.length}`);
    }
    if (tag) {
      params.push(tag);
      conditions.push(`$${params.length} = ANY(tags)`);
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`lower(name) LIKE $${params.length}`);
    }

    const result = await query(
      `SELECT * FROM meals WHERE ${conditions.join(' AND ')} ORDER BY name ASC`,
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
    const meal = await getOwnedMeal(req.userId, req.params.id);
    const ingredients = await getMealIngredients(meal.id);
    res.json({ ...meal, ingredients });
  })
);

// Preview de escalado de porciones: no persiste nada.
router.get(
  '/:id/scale',
  [param('id').isUUID(), queryValidator('servings').isFloat({ gt: 0 })],
  validate,
  asyncHandler(async (req, res) => {
    const meal = await getOwnedMeal(req.userId, req.params.id);
    const ingredients = await getMealIngredients(meal.id);
    const targetServings = Number(req.query.servings);
    const scaled = scaleIngredients(ingredients, Number(meal.base_servings), targetServings);
    res.json({
      meal_id: meal.id,
      base_servings: Number(meal.base_servings),
      target_servings: targetServings,
      ingredients: scaled,
    });
  })
);

router.post(
  '/',
  [
    body('name').isString().trim().notEmpty().isLength({ max: 200 }),
    body('meal_type').isIn(MEAL_TYPES),
    body('tags').optional().isArray(),
    body('tags.*').optional().isString().trim(),
    body('prep_time_minutes').optional().isInt({ min: 0 }),
    body('base_servings').optional().isFloat({ gt: 0 }),
    body('instructions').optional().isString(),
    body('source_url').optional({ nullable: true }).isURL(),
    body('nutrition').optional().isObject(),
    ...ingredientItemValidators,
  ],
  validate,
  asyncHandler(async (req, res) => {
    const {
      name, meal_type: mealType, tags, prep_time_minutes: prepTime,
      base_servings: baseServings, instructions, source_url: sourceUrl,
      nutrition, ingredients,
    } = req.body;

    const meal = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO meals (user_id, name, meal_type, tags, prep_time_minutes, base_servings, instructions, source_url, nutrition)
         VALUES ($1, $2, $3, COALESCE($4::text[], '{}'), $5, COALESCE($6, 1), $7, $8, $9)
         RETURNING *`,
        [req.userId, name, mealType, tags, prepTime, baseServings, instructions, sourceUrl, nutrition]
      );
      const created = result.rows[0];
      if (ingredients && ingredients.length > 0) {
        await replaceMealIngredients(client, created.id, ingredients);
      }
      return created;
    });

    const savedIngredients = await getMealIngredients(meal.id);
    res.status(201).json({ ...meal, ingredients: savedIngredients });
  })
);

router.put(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().isString().trim().notEmpty().isLength({ max: 200 }),
    body('meal_type').optional().isIn(MEAL_TYPES),
    body('tags').optional().isArray(),
    body('tags.*').optional().isString().trim(),
    body('prep_time_minutes').optional().isInt({ min: 0 }),
    body('base_servings').optional().isFloat({ gt: 0 }),
    body('instructions').optional().isString(),
    body('source_url').optional({ nullable: true }).isURL(),
    body('nutrition').optional().isObject(),
    body('ingredients').optional().isArray(),
    body('ingredients.*.ingredient_id').optional().isUUID(),
    body('ingredients.*.quantity').optional().isFloat({ gt: 0 }),
    body('ingredients.*.unit').optional().isString().trim().notEmpty(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    await getOwnedMeal(req.userId, req.params.id);
    const {
      name, meal_type: mealType, tags, prep_time_minutes: prepTime,
      base_servings: baseServings, instructions, source_url: sourceUrl,
      nutrition, ingredients,
    } = req.body;

    const meal = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE meals SET
           name = COALESCE($3, name),
           meal_type = COALESCE($4::meal_type, meal_type),
           tags = COALESCE($5, tags),
           prep_time_minutes = COALESCE($6, prep_time_minutes),
           base_servings = COALESCE($7, base_servings),
           instructions = COALESCE($8, instructions),
           source_url = COALESCE($9, source_url),
           nutrition = COALESCE($10, nutrition)
         WHERE id = $1 AND user_id = $2
         RETURNING *`,
        [req.params.id, req.userId, name, mealType, tags, prepTime, baseServings, instructions, sourceUrl, nutrition]
      );
      if (ingredients) {
        await replaceMealIngredients(client, req.params.id, ingredients);
      }
      return result.rows[0];
    });

    const savedIngredients = await getMealIngredients(meal.id);
    res.json({ ...meal, ingredients: savedIngredients });
  })
);

router.delete(
  '/:id',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await getOwnedMeal(req.userId, req.params.id);
    // Soft-delete: preferimos no borrar comidas con historial de uso.
    await query('UPDATE meals SET is_active = false WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
    res.status(204).send();
  })
);

// Calificar una comida cocinada (registra un evento en el historial).
router.post(
  '/:id/ratings',
  [
    param('id').isUUID(),
    body('rating').isInt({ min: 1, max: 5 }),
    body('used_date').optional().isISO8601(),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const meal = await getOwnedMeal(req.userId, req.params.id);
    const { rating, used_date: usedDate } = req.body;

    const result = await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO meal_usage_history (user_id, meal_id, used_date, rating, rated_at)
         VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, now())
         RETURNING *`,
        [req.userId, meal.id, usedDate, rating]
      );
      await client.query(
        `UPDATE meals SET
           avg_rating = (SELECT AVG(rating)::numeric(3,2) FROM meal_usage_history WHERE meal_id = $1 AND rating IS NOT NULL),
           times_cooked = (SELECT COUNT(*) FROM meal_usage_history WHERE meal_id = $1)
         WHERE id = $1`,
        [meal.id]
      );
      return inserted.rows[0];
    });

    res.status(201).json(result);
  })
);

router.get(
  '/:id/history',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await getOwnedMeal(req.userId, req.params.id);
    const result = await query(
      `SELECT * FROM meal_usage_history WHERE meal_id = $1 AND user_id = $2 ORDER BY used_date DESC`,
      [req.params.id, req.userId]
    );
    res.json(result.rows);
  })
);

export default router;
