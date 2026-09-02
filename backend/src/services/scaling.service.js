/**
 * Escala una lista de meal_ingredients (con quantity a base_servings) a una
 * cantidad de porciones objetivo. Es una operación pura, sin acceso a DB,
 * para poder reusarla tanto en el endpoint de preview de escalado como en
 * el generador de lista de compras (que escala según servings_planned de
 * cada slot del menú).
 *
 * @param {Array<{ingredient_id: string, quantity: number, unit: string}>} ingredients
 * @param {number} baseServings
 * @param {number} targetServings
 */
export function scaleIngredients(ingredients, baseServings, targetServings) {
  if (!baseServings || baseServings <= 0) {
    throw new Error('base_servings debe ser mayor a 0 para poder escalar');
  }
  const factor = targetServings / baseServings;
  return ingredients.map((ing) => ({
    ...ing,
    quantity: roundQuantity(Number(ing.quantity) * factor),
  }));
}

// Redondeamos a 2 decimales para no arrastrar errores de punto flotante
// en cantidades tipo 0.1 + 0.2.
function roundQuantity(value) {
  return Math.round(value * 100) / 100;
}
