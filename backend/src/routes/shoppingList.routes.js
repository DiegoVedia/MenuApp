import { Router } from 'express';
import { body, param } from 'express-validator';
import { query, withTransaction } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError } from '../utils/errors.js';
import { buildShoppingListData, groupItemsByCategory, shoppingListToText } from '../services/shoppingList.service.js';

const router = Router();
router.use(requireAuth);

async function getOwnedList(userId, id) {
  const result = await query('SELECT * FROM shopping_lists WHERE id = $1 AND user_id = $2', [id, userId]);
  if (result.rows.length === 0) throw new NotFoundError('Lista de compras no encontrada');
  return result.rows[0];
}

async function getListItems(listId) {
  const result = await query('SELECT * FROM shopping_list_items WHERE shopping_list_id = $1', [listId]);
  return result.rows;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const result = await query(
      'SELECT * FROM shopping_lists WHERE user_id = $1 ORDER BY generated_at DESC',
      [req.userId]
    );
    res.json(result.rows);
  })
);

router.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const list = await getOwnedList(req.userId, req.params.id);
    const items = await getListItems(list.id);
    res.json({ ...list, groups: groupItemsByCategory(items) });
  })
);

router.get(
  '/:id/export',
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const list = await getOwnedList(req.userId, req.params.id);
    const items = await getListItems(list.id);
    res.type('text/plain').send(shoppingListToText(list, items));
  })
);

// Genera (y persiste) una lista de compras a partir de una o más semanas de menú.
router.post(
  '/',
  [
    body('week_start_dates').isArray({ min: 1 }),
    body('week_start_dates.*').isISO8601(),
    body('period_type').optional().isIn(['weekly', 'monthly', 'custom']),
    body('name').optional().isString().trim().isLength({ max: 200 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { week_start_dates: weekStartDates, period_type: periodType, name } = req.body;
    const sortedDates = [...weekStartDates].sort();

    let result;
    try {
      result = await withTransaction(async (client) => {
      const { menuWeeks, items, totalCost, warnings } = await buildShoppingListData(client, {
        userId: req.userId,
        weekStartDates: sortedDates,
      });

      const startDate = sortedDates[0];
      const endDate = addDays(sortedDates[sortedDates.length - 1], 6);

      const listResult = await client.query(
        `INSERT INTO shopping_lists (user_id, name, period_type, start_date, end_date, total_estimated_cost)
         VALUES ($1, $2, COALESCE($3, 'weekly'), $4, $5, $6)
         RETURNING *`,
        [req.userId, name, periodType, startDate, endDate, totalCost]
      );
      const shoppingList = listResult.rows[0];

      for (const week of menuWeeks) {
        await client.query(
          'INSERT INTO shopping_list_sources (shopping_list_id, menu_week_id) VALUES ($1, $2)',
          [shoppingList.id, week.id]
        );
      }

      const savedItems = [];
      for (const item of items) {
        const inserted = await client.query(
          `INSERT INTO shopping_list_items
             (shopping_list_id, ingredient_id, category, quantity_needed, quantity_in_pantry, quantity_to_buy, unit, estimated_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            shoppingList.id, item.ingredient_id, item.category, item.quantity_needed,
            item.quantity_in_pantry, item.quantity_to_buy, item.unit, item.estimated_price,
          ]
        );
        savedItems.push(inserted.rows[0]);
      }

        return { shoppingList, items: savedItems, warnings };
      });
    } catch (err) {
      if (err.statusCode) throw new NotFoundError(err.message);
      throw err;
    }

    res.status(201).json({
      ...result.shoppingList,
      groups: groupItemsByCategory(result.items),
      warnings: result.warnings,
    });
  })
);

router.patch(
  '/items/:itemId',
  [
    param('itemId').isUUID(),
    body('is_purchased').optional().isBoolean(),
    body('quantity_to_buy').optional().isFloat({ min: 0 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { is_purchased: isPurchased, quantity_to_buy: quantityToBuy } = req.body;
    const result = await query(
      `UPDATE shopping_list_items si SET
         is_purchased = COALESCE($3, si.is_purchased),
         purchased_at = CASE WHEN $3 = true THEN now() WHEN $3 = false THEN NULL ELSE si.purchased_at END,
         quantity_to_buy = COALESCE($4, si.quantity_to_buy)
       FROM shopping_lists sl
       WHERE si.id = $1 AND si.shopping_list_id = sl.id AND sl.user_id = $2
       RETURNING si.*`,
      [req.params.itemId, req.userId, isPurchased, quantityToBuy]
    );
    if (result.rows.length === 0) throw new NotFoundError('Ítem no encontrado');
    res.json(result.rows[0]);
  })
);

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default router;
