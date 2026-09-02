import { Router } from 'express';
import { body } from 'express-validator';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import {
  fetchRecipeHtml,
  extractJsonLdRecipe,
  jsonLdToDraft,
  heuristicScrape,
  extractVisibleText,
} from '../services/recipeParser.service.js';
import { llmFallbackAvailable, structureRecipeWithLlm } from '../services/recipeLlm.service.js';

const router = Router();
router.use(requireAuth);

/**
 * POST /api/recipe-import/preview
 * Body: { url }
 * No persiste nada: devuelve un "draft" editable para que el usuario lo
 * revise/corrija antes de mandarlo a POST /api/meals.
 *
 * Estrategia (en orden de confiabilidad):
 *   1. JSON-LD schema.org/Recipe (más confiable)
 *   2. Scraping heurístico de patrones comunes (clases/ids "ingredient(e)"...)
 *   3. Si el heurístico no encontró nada y hay ANTHROPIC_API_KEY: LLM sobre el texto visible
 */
router.post(
  '/preview',
  [body('url').isURL({ require_protocol: true })],
  validate,
  asyncHandler(async (req, res) => {
    const { url } = req.body;
    const warnings = [];

    const html = await fetchRecipeHtml(url);

    let draft;
    const jsonLdRecipe = extractJsonLdRecipe(html);
    if (jsonLdRecipe) {
      draft = jsonLdToDraft(jsonLdRecipe, url);
      if (draft.ingredients.length === 0) {
        warnings.push('Se encontró JSON-LD tipo Recipe pero sin lista de ingredientes.');
      }
    } else {
      warnings.push('La página no tiene datos estructurados (JSON-LD). Se usó scraping heurístico.');
      draft = heuristicScrape(html);

      if (draft.ingredients.length === 0 && llmFallbackAvailable()) {
        warnings.push('El scraping heurístico no encontró ingredientes. Se usó el modelo de lenguaje como respaldo.');
        const visibleText = extractVisibleText(html);
        draft = await structureRecipeWithLlm(visibleText, url);
      } else if (draft.ingredients.length === 0) {
        warnings.push(
          'No se pudieron detectar ingredientes automáticamente. Completá la receta manualmente, o configurá ANTHROPIC_API_KEY para habilitar el respaldo por LLM.'
        );
      }
    }

    draft.ingredients = await matchIngredients(req.userId, draft.ingredients);
    if (!draft.base_servings) {
      warnings.push('No se detectaron las porciones base: revisá/completá el campo antes de guardar.');
    }

    res.json({ ...draft, warnings });
  })
);

/**
 * Para cada ingrediente parseado, intenta encontrar un ingrediente ya
 * cargado por el usuario (match exacto por nombre normalizado, luego
 * aproximado por substring) para pre-completar la vista previa. Si no
 * encuentra nada, el campo matched_ingredient_id queda null y el frontend
 * ofrece crear un ingrediente nuevo con ese nombre.
 */
async function matchIngredients(userId, ingredients) {
  if (ingredients.length === 0) return ingredients;

  const existing = await query('SELECT id, name, normalized_name FROM ingredients WHERE user_id = $1', [
    userId,
  ]);

  return ingredients.map((ing) => {
    const normalized = (ing.name || '').toLowerCase().trim();
    let match = existing.rows.find((row) => row.normalized_name === normalized);
    if (!match && normalized) {
      match = existing.rows.find(
        (row) => row.normalized_name.includes(normalized) || normalized.includes(row.normalized_name)
      );
    }
    return {
      ...ing,
      matched_ingredient_id: match ? match.id : null,
      matched_ingredient_name: match ? match.name : null,
    };
  });
}

export default router;
