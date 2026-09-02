import { Router } from 'express';
import { body, param } from 'express-validator';
import { query, withTransaction } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { NotFoundError, ConflictError, BadRequestError } from '../utils/errors.js';
import {
  DEFAULT_SLOT_PLAN, generateMenuWeek, regenerateSlot, confirmMenuWeek,
} from '../services/menuGenerator.service.js';

const router = Router();
router.use(requireAuth);

const MEAL_TYPES = ['desayuno', 'almuerzo', 'cena', 'snack'];

async function fetchWeekWithSlots(userId, weekStartDate) {
  const weekResult = await query(
    'SELECT * FROM menu_weeks WHERE user_id = $1 AND week_start_date = $2',
    [userId, weekStartDate]
  );
  const menuWeek = weekResult.rows[0];
  if (!menuWeek) return null;

  const slotsResult = await query(
    `SELECT ms.*, m.name AS meal_name, m.meal_type AS meal_meal_type, m.tags AS meal_tags,
            m.base_servings AS meal_base_servings, m.prep_time_minutes AS meal_prep_time_minutes
     FROM menu_slots ms
     LEFT JOIN meals m ON m.id = ms.meal_id
     WHERE ms.menu_week_id = $1
     ORDER BY ms.day_of_week, ms.slot_type`,
    [menuWeek.id]
  );
  return { ...menuWeek, slots: slotsResult.rows };
}

router.get(
  '/weeks/:weekStartDate',
  [param('weekStartDate').isISO8601()],
  validate,
  asyncHandler(async (req, res) => {
    const week = await fetchWeekWithSlots(req.userId, req.params.weekStartDate);
    if (!week) {
      throw new NotFoundError('Todavía no se generó un menú para esa semana');
    }
    res.json(week);
  })
);

router.post(
  '/weeks/:weekStartDate/generate',
  [
    param('weekStartDate').isISO8601(),
    body('slot_plan').optional().isArray(),
    body('slot_plan.*.day_of_week').optional().isInt({ min: 0, max: 6 }),
    body('slot_plan.*.slot_type').optional().isIn(MEAL_TYPES),
    body('lookback_weeks').optional().isInt({ min: 0, max: 52 }),
    body('leftover_affinity').optional().isFloat({ min: 0, max: 1 }),
    body('servings_needed').optional().isFloat({ gt: 0 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { weekStartDate } = req.params;
    const {
      slot_plan: slotPlan, lookback_weeks: lookbackWeeks,
      leftover_affinity: leftoverAffinity, servings_needed: servingsNeeded,
    } = req.body;

    const { menuWeek, slots, warnings } = await withTransaction((client) =>
      generateMenuWeek(client, {
        userId: req.userId,
        weekStartDate,
        slotPlan: slotPlan && slotPlan.length > 0 ? slotPlan : DEFAULT_SLOT_PLAN,
        lookbackWeeks,
        leftoverAffinity,
        servingsNeeded,
      })
    );

    const full = await fetchWeekWithSlots(req.userId, weekStartDate);
    res.json({ ...full, menu_week_id: menuWeek.id, warnings });
  })
);

router.post(
  '/weeks/:weekStartDate/confirm',
  [param('weekStartDate').isISO8601()],
  validate,
  asyncHandler(async (req, res) => {
    try {
      const menuWeek = await withTransaction((client) =>
        confirmMenuWeek(client, { userId: req.userId, weekStartDate: req.params.weekStartDate })
      );
      res.json(menuWeek);
    } catch (err) {
      if (err.statusCode) throw new NotFoundError(err.message);
      throw err;
    }
  })
);

// Fija/desbloquea manualmente una comida en un slot, o ajusta sus porciones.
router.patch(
  '/slots/:slotId',
  [
    param('slotId').isUUID(),
    body('meal_id').optional({ nullable: true }).isUUID(),
    body('is_locked').optional().isBoolean(),
    body('servings_planned').optional().isFloat({ gt: 0 }),
  ],
  validate,
  asyncHandler(async (req, res) => {
    const slotResult = await query(
      `SELECT ms.* FROM menu_slots ms
       JOIN menu_weeks mw ON mw.id = ms.menu_week_id
       WHERE ms.id = $1 AND mw.user_id = $2`,
      [req.params.slotId, req.userId]
    );
    if (slotResult.rows.length === 0) {
      throw new NotFoundError('Slot no encontrado');
    }

    const { meal_id: mealId, is_locked: isLocked, servings_planned: servingsPlanned } = req.body;

    if (mealId) {
      const mealCheck = await query('SELECT id FROM meals WHERE id = $1 AND user_id = $2', [mealId, req.userId]);
      if (mealCheck.rows.length === 0) {
        throw new BadRequestError('La comida indicada no existe o no te pertenece');
      }
    }

    const result = await query(
      `UPDATE menu_slots SET
         meal_id = COALESCE($2, meal_id),
         is_locked = COALESCE($3, is_locked),
         servings_planned = COALESCE($4, servings_planned),
         is_leftover = CASE WHEN $2 IS NOT NULL THEN false ELSE is_leftover END,
         source_slot_id = CASE WHEN $2 IS NOT NULL THEN NULL ELSE source_slot_id END
       WHERE id = $1
       RETURNING *`,
      [req.params.slotId, mealId, isLocked, servingsPlanned]
    );
    res.json(result.rows[0]);
  })
);

// Pide una alternativa para un slot puntual, sin regenerar toda la semana.
router.post(
  '/slots/:slotId/alternative',
  [param('slotId').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const slotResult = await query(
      `SELECT ms.*, mw.week_start_date, mw.user_id
       FROM menu_slots ms
       JOIN menu_weeks mw ON mw.id = ms.menu_week_id
       WHERE ms.id = $1 AND mw.user_id = $2`,
      [req.params.slotId, req.userId]
    );
    const slot = slotResult.rows[0];
    if (!slot) {
      throw new NotFoundError('Slot no encontrado');
    }

    try {
      const updated = await withTransaction((client) =>
        regenerateSlot(client, {
          userId: req.userId,
          weekStartDate: slot.week_start_date,
          dayOfWeek: slot.day_of_week,
          slotType: slot.slot_type,
        })
      );
      res.json(updated);
    } catch (err) {
      if (err.statusCode) throw new ConflictError(err.message);
      throw err;
    }
  })
);

export default router;
