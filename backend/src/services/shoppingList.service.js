import { scaleIngredients } from './scaling.service.js';

/**
 * Genera una lista de compras consolidada a partir de una o más semanas de
 * menú ya generadas:
 *  1. Recorre los slots de esas semanas (ignorando los que son "sobra",
 *     porque no implican cocinar/comprar de nuevo: reutilizan lo ya hecho).
 *  2. Escala los ingredientes de cada comida a las porciones planificadas
 *     del slot.
 *  3. Convierte a la unidad por defecto del ingrediente cuando hay una
 *     conversión cargada (ingredient_unit_conversions); si no la hay y la
 *     unidad de la receta difiere de la del ingrediente, deja esa cantidad
 *     en su propia unidad y lo marca con advertencia para revisión manual.
 *  4. Suma cantidades repetidas, descuenta despensa, agrupa por categoría.
 */
export async function buildShoppingListData(client, { userId, weekStartDates }) {
  const warnings = [];

  const weeksResult = await client.query(
    `SELECT * FROM menu_weeks WHERE user_id = $1 AND week_start_date = ANY($2::date[])`,
    [userId, weekStartDates]
  );
  const menuWeeks = weeksResult.rows;
  if (menuWeeks.length === 0) {
    const err = new Error('No se encontraron menús generados para esas semanas');
    err.statusCode = 404;
    throw err;
  }
  const foundDates = new Set(menuWeeks.map((w) => w.week_start_date));
  for (const d of weekStartDates) {
    if (!foundDates.has(d)) warnings.push(`No hay menú generado para la semana del ${d}; se omitió.`);
  }

  const menuWeekIds = menuWeeks.map((w) => w.id);
  const slotsResult = await client.query(
    `SELECT * FROM menu_slots WHERE menu_week_id = ANY($1::uuid[]) AND meal_id IS NOT NULL AND is_leftover = false`,
    [menuWeekIds]
  );
  const slots = slotsResult.rows;

  // Acumulador: key = `${ingredient_id}:${unit}` -> { ingredient_id, unit, quantity }
  const accumulator = new Map();
  const conversionCache = new Map(); // ingredient_id -> [{from_unit, factor}]
  const ingredientCache = new Map(); // ingredient_id -> row

  for (const slot of slots) {
    const mealResult = await client.query('SELECT * FROM meals WHERE id = $1', [slot.meal_id]);
    const meal = mealResult.rows[0];
    if (!meal) continue;

    const ingredientsResult = await client.query(
      'SELECT * FROM meal_ingredients WHERE meal_id = $1',
      [meal.id]
    );
    const scaled = scaleIngredients(
      ingredientsResult.rows,
      Number(meal.base_servings),
      Number(slot.servings_planned)
    );

    for (const item of scaled) {
      if (!ingredientCache.has(item.ingredient_id)) {
        const ingResult = await client.query('SELECT * FROM ingredients WHERE id = $1', [item.ingredient_id]);
        ingredientCache.set(item.ingredient_id, ingResult.rows[0]);
      }
      const ingredient = ingredientCache.get(item.ingredient_id);
      if (!ingredient) continue;

      let quantity = Number(item.quantity);
      let unit = item.unit;

      if (unit !== ingredient.default_unit) {
        if (!conversionCache.has(item.ingredient_id)) {
          const convResult = await client.query(
            'SELECT from_unit, factor FROM ingredient_unit_conversions WHERE ingredient_id = $1',
            [item.ingredient_id]
          );
          conversionCache.set(item.ingredient_id, convResult.rows);
        }
        const conversion = conversionCache
          .get(item.ingredient_id)
          .find((c) => c.from_unit === unit);

        if (conversion) {
          quantity = quantity * Number(conversion.factor);
          unit = ingredient.default_unit;
        } else {
          warnings.push(
            `"${ingredient.name}" tiene cantidades en unidades distintas ("${unit}" vs "${ingredient.default_unit}") sin conversión cargada: revisá la lista manualmente.`
          );
        }
      }

      const key = `${item.ingredient_id}:${unit}`;
      const existing = accumulator.get(key);
      if (existing) {
        existing.quantity += quantity;
      } else {
        accumulator.set(key, { ingredient, unit, quantity });
      }
    }
  }

  const pantryResult = await client.query('SELECT * FROM pantry_items WHERE user_id = $1', [userId]);
  const pantryByIngredientUnit = new Map(
    pantryResult.rows.map((p) => [`${p.ingredient_id}:${p.unit}`, Number(p.quantity)])
  );

  const items = [];
  let totalCost = 0;

  for (const { ingredient, unit, quantity } of accumulator.values()) {
    const inPantry = pantryByIngredientUnit.get(`${ingredient.id}:${unit}`) || 0;
    const toBuy = Math.max(0, roundQuantity(quantity) - inPantry);
    const estimatedPrice = ingredient.estimated_price != null ? Number(ingredient.estimated_price) * toBuy : null;
    if (estimatedPrice != null) totalCost += estimatedPrice;

    items.push({
      ingredient_id: ingredient.id,
      ingredient_name: ingredient.name,
      category: ingredient.category,
      unit,
      quantity_needed: roundQuantity(quantity),
      quantity_in_pantry: inPantry,
      quantity_to_buy: roundQuantity(toBuy),
      estimated_price: estimatedPrice != null ? roundQuantity(estimatedPrice) : null,
    });
  }

  items.sort((a, b) => a.category.localeCompare(b.category) || a.ingredient_name.localeCompare(b.ingredient_name));

  return { menuWeeks, items, totalCost: roundQuantity(totalCost), warnings };
}

function roundQuantity(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Agrupa los items de una lista de compras por categoría, para la vista
 * "agrupado por verdulería / carnicería / almacén / ...".
 */
export function groupItemsByCategory(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }
  return Array.from(groups.entries()).map(([category, categoryItems]) => ({ category, items: categoryItems }));
}

/**
 * Genera una versión de texto simple, copiable, de la lista (para compartir).
 */
export function shoppingListToText(shoppingList, items) {
  const lines = [`Lista de compras: ${shoppingList.name || shoppingList.start_date + ' a ' + shoppingList.end_date}`, ''];
  for (const group of groupItemsByCategory(items)) {
    lines.push(`## ${group.category.toUpperCase()}`);
    for (const item of group.items) {
      const box = item.is_purchased ? '[x]' : '[ ]';
      const qty = `${item.quantity_to_buy} ${item.unit}`;
      lines.push(`${box} ${item.ingredient_name} — ${qty}`);
    }
    lines.push('');
  }
  if (shoppingList.total_estimated_cost != null) {
    lines.push(`Costo estimado total: $${shoppingList.total_estimated_cost}`);
  }
  return lines.join('\n');
}
