/**
 * Generador de menú semanal rotativo.
 *
 * Ver la explicación completa del algoritmo en el chat de diseño (fase 1).
 * Resumen:
 *  1. Los slots con is_locked=true nunca se tocan, pero cuentan para los
 *     límites de tags de la semana.
 *  2. Para cada slot vacío se arma un pool de comidas candidatas: mismo
 *     meal_type, sin restricciones duras (alergias), sin exceder límites de
 *     tag, y no usadas en las últimas `lookback_weeks` semanas — con
 *     relajación progresiva de esa ventana si el pool queda vacío.
 *  3. Si el día anterior dejó "sobras" (una comida cuyo base_servings superó
 *     lo necesario), se agrega como candidato especial, compitiendo con el
 *     resto según `leftover_affinity`.
 *  4. Se elige un candidato con sorteo ponderado por rating + qué tan hace
 *     que no se usa (recency) — no es un simple argmax, para no perder
 *     variedad.
 */

const DAY_COUNT = 7;
const DEFAULT_LOOKBACK_WEEKS = 3;
const DEFAULT_LEFTOVER_AFFINITY = 0.6;
const DEFAULT_SERVINGS_NEEDED = 2; // porciones necesarias por slot, si no se especifica

export const DEFAULT_SLOT_PLAN = ['desayuno', 'almuerzo', 'cena'].flatMap((slotType) =>
  Array.from({ length: DAY_COUNT }, (_, day) => ({ day_of_week: day, slot_type: slotType }))
);

// ---------- utilidades puras (testeables sin DB) ----------

export function ratingFactor(avgRating) {
  const rating = avgRating != null ? Number(avgRating) : 3; // sin historial => punto medio
  return 1 + rating / 5; // 1.2 .. 2.0
}

export function recencyFactor(weeksSinceLastUsed, lookbackWeeks) {
  if (weeksSinceLastUsed == null) return 1.5; // nunca usada
  const denom = Math.max(lookbackWeeks, 1);
  return Math.max(0.2, Math.min(weeksSinceLastUsed / denom, 1.5));
}

export function candidateScore(meal, weeksSinceLastUsed, lookbackWeeks) {
  return ratingFactor(meal.avg_rating) * recencyFactor(weeksSinceLastUsed, lookbackWeeks);
}

/**
 * Sorteo ponderado (roulette wheel). candidates: [{ weight, ...payload }]
 */
export function weightedRandomPick(candidates, rng = Math.random) {
  const total = candidates.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return candidates[0] || null;
  let threshold = rng() * total;
  for (const candidate of candidates) {
    threshold -= candidate.weight;
    if (threshold <= 0) return candidate;
  }
  return candidates[candidates.length - 1];
}

// node-pg devuelve las columnas `date` como objetos Date (no strings), así
// que toda fecha que pueda venir de la DB se normaliza a 'YYYY-MM-DD' antes
// de operar con ella.
function toDateOnlyString(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = new Date(`${toDateOnlyString(dateStr)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weeksBetween(fromDateStr, toDateStr) {
  const from = new Date(`${toDateOnlyString(fromDateStr)}T00:00:00Z`);
  const to = new Date(`${toDateOnlyString(toDateStr)}T00:00:00Z`);
  return Math.floor((to - from) / (7 * 24 * 60 * 60 * 1000));
}

// ---------- acceso a datos ----------

async function loadUser(client, userId) {
  const result = await client.query('SELECT lookback_weeks FROM users WHERE id = $1', [userId]);
  return result.rows[0];
}

async function loadCandidateMeals(client, userId, mealType) {
  const result = await client.query(
    `SELECT id, name, meal_type, tags, base_servings, avg_rating
     FROM meals
     WHERE user_id = $1 AND meal_type = $2 AND is_active = true`,
    [userId, mealType]
  );
  return result.rows;
}

async function loadHardRestrictedMealIds(client, userId) {
  const result = await client.query(
    `SELECT DISTINCT mi.meal_id
     FROM meal_ingredients mi
     JOIN user_ingredient_restrictions r ON r.ingredient_id = mi.ingredient_id
     WHERE r.user_id = $1 AND r.is_hard = true`,
    [userId]
  );
  return new Set(result.rows.map((r) => r.meal_id));
}

async function loadTagLimits(client, userId) {
  const result = await client.query('SELECT tag, max_per_week FROM user_tag_limits WHERE user_id = $1', [
    userId,
  ]);
  const map = new Map();
  for (const row of result.rows) map.set(row.tag, row.max_per_week);
  return map;
}

async function loadLastUsedDates(client, userId) {
  const result = await client.query(
    `SELECT meal_id, MAX(used_date) AS last_used
     FROM meal_usage_history
     WHERE user_id = $1
     GROUP BY meal_id`,
    [userId]
  );
  const map = new Map();
  for (const row of result.rows) map.set(row.meal_id, row.last_used);
  return map;
}

async function loadExistingSlots(client, menuWeekId) {
  const result = await client.query(
    `SELECT ms.*, m.name AS meal_name, m.base_servings AS meal_base_servings, m.tags AS meal_tags
     FROM menu_slots ms
     LEFT JOIN meals m ON m.id = ms.meal_id
     WHERE ms.menu_week_id = $1`,
    [menuWeekId]
  );
  return result.rows;
}

async function upsertMenuWeek(client, userId, weekStartDate) {
  const result = await client.query(
    `INSERT INTO menu_weeks (user_id, week_start_date)
     VALUES ($1, $2)
     ON CONFLICT (user_id, week_start_date) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId, weekStartDate]
  );
  return result.rows[0];
}

// ---------- lógica principal ----------

/**
 * Arma el pool de candidatos para un slot puntual, aplicando filtros duros
 * y relajación progresiva de la ventana de "no repetir".
 */
function buildCandidatePool({
  meals, hardRestrictedIds, tagCounts, tagLimits, lastUsedDates, weekStartDate, dayOfWeek,
  lookbackWeeks, excludeMealIds,
}) {
  const targetDate = addDays(weekStartDate, dayOfWeek);

  const passesTagLimits = (meal) =>
    (meal.tags || []).every((tag) => {
      const limit = tagLimits.get(tag);
      if (limit == null) return true;
      return (tagCounts.get(tag) || 0) < limit;
    });

  const base = meals.filter(
    (m) => !hardRestrictedIds.has(m.id) && !excludeMealIds.has(m.id) && passesTagLimits(m)
  );

  // Relajación progresiva de la ventana de "no repetir en las últimas N semanas"
  for (let window = lookbackWeeks; window >= 0; window -= 1) {
    const pool = base.filter((m) => {
      const lastUsed = lastUsedDates.get(m.id);
      if (!lastUsed) return true;
      const weeksSince = weeksBetween(lastUsed, targetDate);
      return weeksSince >= window;
    });
    if (pool.length > 0) {
      return { pool, relaxedWindow: window < lookbackWeeks ? window : null };
    }
  }
  return { pool: [], relaxedWindow: null };
}

function scoreCandidates(pool, lastUsedDates, weekStartDate, dayOfWeek, lookbackWeeks) {
  const targetDate = addDays(weekStartDate, dayOfWeek);
  return pool.map((meal) => {
    const lastUsed = lastUsedDates.get(meal.id);
    const weeksSince = lastUsed ? weeksBetween(lastUsed, targetDate) : null;
    return { meal, weight: candidateScore(meal, weeksSince, lookbackWeeks) };
  });
}

/**
 * Genera (o regenera) los slots no bloqueados de una semana.
 *
 * @param {object} client - cliente pg (dentro de una transacción)
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.weekStartDate - fecha del lunes, 'YYYY-MM-DD'
 * @param {Array<{day_of_week:number, slot_type:string}>} params.slotPlan - qué slots llenar
 * @param {number} [params.lookbackWeeks]
 * @param {number} [params.leftoverAffinity] - 0..1
 * @param {number} [params.servingsNeeded] - porciones necesarias por slot (para detectar sobras)
 */
export async function generateMenuWeek(client, params) {
  const {
    userId, weekStartDate, slotPlan = DEFAULT_SLOT_PLAN,
    leftoverAffinity = DEFAULT_LEFTOVER_AFFINITY, servingsNeeded = DEFAULT_SERVINGS_NEEDED,
  } = params;

  const user = await loadUser(client, userId);
  const lookbackWeeks = params.lookbackWeeks ?? user?.lookback_weeks ?? DEFAULT_LOOKBACK_WEEKS;

  const menuWeek = await upsertMenuWeek(client, userId, weekStartDate);
  const existingSlots = await loadExistingSlots(client, menuWeek.id);
  const existingBySlotKey = new Map(existingSlots.map((s) => [`${s.day_of_week}:${s.slot_type}`, s]));

  const hardRestrictedIds = await loadHardRestrictedMealIds(client, userId);
  const tagLimits = await loadTagLimits(client, userId);
  const lastUsedDates = await loadLastUsedDates(client, userId);

  const mealsByType = new Map();
  const mealsById = new Map();
  for (const slot of slotPlan) {
    if (!mealsByType.has(slot.slot_type)) {
      const meals = await loadCandidateMeals(client, userId, slot.slot_type);
      mealsByType.set(slot.slot_type, meals);
      for (const m of meals) mealsById.set(m.id, m);
    }
  }

  // Tags ya comprometidos esta semana por slots bloqueados (cuentan igual)
  const tagCounts = new Map();
  const usedThisWeek = new Set();
  for (const slot of existingSlots) {
    if (slot.is_locked && slot.meal_id) {
      usedThisWeek.add(slot.meal_id);
      for (const tag of slot.meal_tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }

  const warnings = [];
  const resultSlots = [];
  // Ordenamos por día para poder ofrecer sobras del día anterior
  const orderedPlan = [...slotPlan].sort((a, b) => a.day_of_week - b.day_of_week);
  const leftoverBySlotType = new Map(); // slot_type -> { meal, dayAssigned, remainingServings }

  for (const { day_of_week: dayOfWeek, slot_type: slotType } of orderedPlan) {
    const key = `${dayOfWeek}:${slotType}`;
    const existing = existingBySlotKey.get(key);

    if (existing && existing.is_locked) {
      resultSlots.push(existing);
      continue;
    }

    const meals = mealsByType.get(slotType) || [];
    const excludeMealIds = new Set(usedThisWeek);

    const { pool, relaxedWindow } = buildCandidatePool({
      meals, hardRestrictedIds, tagCounts, tagLimits, lastUsedDates,
      weekStartDate, dayOfWeek, lookbackWeeks, excludeMealIds,
    });

    const scored = scoreCandidates(pool, lastUsedDates, weekStartDate, dayOfWeek, lookbackWeeks);

    // Candidato "sobra" del día anterior, para el mismo tipo de slot
    const leftover = leftoverBySlotType.get(slotType);
    const candidates = scored.map((c) => ({ type: 'meal', meal: c.meal, weight: c.weight }));
    if (leftover && leftover.dayAssigned === dayOfWeek - 1 && leftoverAffinity > 0) {
      const avgWeight = candidates.length > 0
        ? candidates.reduce((s, c) => s + c.weight, 0) / candidates.length
        : 1;
      candidates.push({ type: 'leftover', meal: leftover.meal, weight: avgWeight * leftoverAffinity * 2 });
    }

    if (candidates.length === 0) {
      warnings.push(
        `No hay comidas disponibles para "${slotType}" el día ${dayOfWeek + 1} (cargá más recetas o ajustá restricciones).`
      );
      resultSlots.push(await upsertSlot(client, menuWeek.id, dayOfWeek, slotType, {
        mealId: null, isLeftover: false, sourceSlotId: null, servingsPlanned: servingsNeeded,
      }));
      continue;
    }

    if (relaxedWindow != null) {
      warnings.push(
        `Pocas opciones para "${slotType}" el día ${dayOfWeek + 1}: se permitió repetir una comida usada hace menos de ${lookbackWeeks} semanas.`
      );
    }

    const picked = weightedRandomPick(candidates);
    usedThisWeek.add(picked.meal.id);
    for (const tag of picked.meal.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);

    const isLeftover = picked.type === 'leftover';
    const savedSlot = await upsertSlot(client, menuWeek.id, dayOfWeek, slotType, {
      mealId: picked.meal.id,
      isLeftover,
      sourceSlotId: isLeftover ? existingBySlotKey.get(`${dayOfWeek - 1}:${slotType}`)?.id || null : null,
      servingsPlanned: servingsNeeded,
    });
    resultSlots.push(savedSlot);

    // ¿Esta comida rinde de más? Ofrecerla como sobra para mañana (mismo slot_type).
    if (!isLeftover && Number(picked.meal.base_servings) - servingsNeeded >= servingsNeeded) {
      leftoverBySlotType.set(slotType, { meal: picked.meal, dayAssigned: dayOfWeek });
    } else {
      leftoverBySlotType.delete(slotType);
    }
  }

  return { menuWeek, slots: resultSlots, warnings };
}

async function upsertSlot(client, menuWeekId, dayOfWeek, slotType, { mealId, isLeftover, sourceSlotId, servingsPlanned }) {
  const result = await client.query(
    `INSERT INTO menu_slots (menu_week_id, day_of_week, slot_type, meal_id, is_leftover, source_slot_id, servings_planned)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (menu_week_id, day_of_week, slot_type)
     DO UPDATE SET meal_id = EXCLUDED.meal_id, is_leftover = EXCLUDED.is_leftover,
                    source_slot_id = EXCLUDED.source_slot_id, servings_planned = EXCLUDED.servings_planned
     RETURNING *`,
    [menuWeekId, dayOfWeek, slotType, mealId, isLeftover, sourceSlotId, servingsPlanned]
  );
  return result.rows[0];
}

/**
 * Regenera un único slot (día puntual), sin tocar el resto de la semana.
 * Excluye explícitamente la comida actualmente asignada para garantizar variedad.
 */
export async function regenerateSlot(client, { userId, weekStartDate, dayOfWeek, slotType, lookbackWeeks: lookbackOverride }) {
  const user = await loadUser(client, userId);
  const lookbackWeeks = lookbackOverride ?? user?.lookback_weeks ?? DEFAULT_LOOKBACK_WEEKS;

  const menuWeek = await upsertMenuWeek(client, userId, weekStartDate);
  const existingSlots = await loadExistingSlots(client, menuWeek.id);
  const current = existingSlots.find((s) => s.day_of_week === dayOfWeek && s.slot_type === slotType);
  if (current?.is_locked) {
    throw Object.assign(new Error('El slot está bloqueado (fijado manualmente)'), { statusCode: 409 });
  }

  const hardRestrictedIds = await loadHardRestrictedMealIds(client, userId);
  const tagLimits = await loadTagLimits(client, userId);
  const lastUsedDates = await loadLastUsedDates(client, userId);
  const meals = await loadCandidateMeals(client, userId, slotType);

  const tagCounts = new Map();
  const excludeMealIds = new Set();
  for (const slot of existingSlots) {
    if (slot.meal_id && slot.id !== current?.id) {
      for (const tag of slot.meal_tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
  }
  if (current?.meal_id) excludeMealIds.add(current.meal_id);

  const { pool } = buildCandidatePool({
    meals, hardRestrictedIds, tagCounts, tagLimits, lastUsedDates,
    weekStartDate, dayOfWeek, lookbackWeeks, excludeMealIds,
  });

  if (pool.length === 0) {
    throw Object.assign(new Error('No hay otra comida disponible para ofrecer como alternativa'), {
      statusCode: 409,
    });
  }

  const scored = scoreCandidates(pool, lastUsedDates, weekStartDate, dayOfWeek, lookbackWeeks);
  const picked = weightedRandomPick(scored.map((c) => ({ meal: c.meal, weight: c.weight })));

  const savedSlot = await upsertSlot(client, menuWeek.id, dayOfWeek, slotType, {
    mealId: picked.meal.id, isLeftover: false, sourceSlotId: null,
    servingsPlanned: current?.servings_planned || DEFAULT_SERVINGS_NEEDED,
  });
  return savedSlot;
}

/**
 * Confirma la semana: la marca como 'confirmed' y registra en el historial
 * de uso cada slot con comida asignada (si todavía no tenía un registro).
 */
export async function confirmMenuWeek(client, { userId, weekStartDate }) {
  const weekResult = await client.query(
    'SELECT * FROM menu_weeks WHERE user_id = $1 AND week_start_date = $2',
    [userId, weekStartDate]
  );
  const menuWeek = weekResult.rows[0];
  if (!menuWeek) {
    throw Object.assign(new Error('No existe un menú para esa semana'), { statusCode: 404 });
  }

  const slots = await loadExistingSlots(client, menuWeek.id);
  for (const slot of slots) {
    if (!slot.meal_id) continue;
    const already = await client.query('SELECT id FROM meal_usage_history WHERE menu_slot_id = $1', [slot.id]);
    if (already.rows.length > 0) continue;

    const usedDate = addDays(weekStartDate, slot.day_of_week);
    await client.query(
      `INSERT INTO meal_usage_history (user_id, meal_id, menu_slot_id, used_date)
       VALUES ($1, $2, $3, $4)`,
      [userId, slot.meal_id, slot.id, usedDate]
    );
  }

  await client.query("UPDATE menu_weeks SET status = 'confirmed' WHERE id = $1", [menuWeek.id]);
  return { ...menuWeek, status: 'confirmed' };
}
