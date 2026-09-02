import * as cheerio from 'cheerio';
import { BadRequestError } from '../utils/errors.js';

const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; MenuAppRecipeImporter/1.0; +https://example.com/bot)';

/**
 * Descarga el HTML de una URL de receta, con timeout y manejo de errores
 * de red / bloqueo / sitios caídos.
 */
export async function fetchRecipeHtml(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestError('La URL no es válida');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestError('Solo se admiten URLs http(s)');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(parsed.toString(), {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new BadRequestError('El sitio tardó demasiado en responder (timeout)');
    }
    throw new BadRequestError(`No se pudo acceder a la URL: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new BadRequestError(
      `El sitio respondió con error ${response.status}. Puede estar caído o bloqueando bots.`
    );
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    throw new BadRequestError('La URL no devolvió una página HTML');
  }

  const html = await response.text();
  if (!html || html.length < 200) {
    throw new BadRequestError(
      'La página devolvió muy poco contenido (posiblemente requiere JavaScript para renderizar)'
    );
  }
  return html;
}

// ==========================================================
// JSON-LD (schema.org Recipe) — la fuente más confiable
// ==========================================================

/**
 * Busca y devuelve el primer objeto Recipe encontrado dentro de los
 * bloques <script type="application/ld+json"> de la página, contemplando
 * @graph y arrays anidados.
 */
export function extractJsonLdRecipe(html) {
  const $ = cheerio.load(html);
  const blocks = $('script[type="application/ld+json"]');

  for (const el of blocks.toArray()) {
    const raw = $(el).contents().text();
    if (!raw) continue;

    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      continue; // JSON-LD mal formado en esta página: seguimos con el próximo bloque
    }

    const recipe = findRecipeNode(json);
    if (recipe) return recipe;
  }
  return null;
}

function findRecipeNode(node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecipeNode(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;

  if (isRecipeType(node['@type'])) return node;
  if (node['@graph']) return findRecipeNode(node['@graph']);
  return null;
}

function isRecipeType(type) {
  if (!type) return false;
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => String(t).toLowerCase() === 'recipe');
}

/**
 * Convierte un nodo Recipe de JSON-LD a nuestro formato de "draft" de comida.
 */
export function jsonLdToDraft(recipe, sourceUrl) {
  const ingredients = normalizeToArray(recipe.recipeIngredient || recipe.ingredients).map(
    (line) => ({ raw_text: String(line).trim(), ...parseIngredientLine(String(line)) })
  );

  const instructions = extractInstructions(recipe.recipeInstructions);
  const servings = parseYield(recipe.recipeYield);
  const prepMinutes = computeTotalMinutes(recipe);

  return {
    name: cleanText(recipe.name) || null,
    base_servings: servings,
    prep_time_minutes: prepMinutes,
    instructions,
    ingredients,
    image_url: extractImage(recipe.image),
    source_url: sourceUrl,
    parsed_with: 'json-ld',
  };
}

// "Tiempo de preparación" = tiempo total (preparación + cocción). Preferimos
// totalTime si está; si no, sumamos prepTime + cookTime (cualquiera de los
// dos puede faltar) en vez de descartar uno a favor del otro.
function computeTotalMinutes(recipe) {
  const total = parseIsoDuration(recipe.totalTime);
  if (total != null) return total;

  const prep = parseIsoDuration(recipe.prepTime);
  const cook = parseIsoDuration(recipe.cookTime);
  if (prep == null && cook == null) return null;
  return (prep || 0) + (cook || 0);
}

function normalizeToArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function extractInstructions(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') return cleanText(raw);

  const steps = normalizeToArray(raw).flatMap((step) => {
    if (typeof step === 'string') return [cleanText(step)];
    if (step && step['@type'] === 'HowToSection') {
      return normalizeToArray(step.itemListElement).map((s) => cleanText(s.text || s.name || ''));
    }
    if (step && typeof step === 'object') return [cleanText(step.text || step.name || '')];
    return [];
  });

  return steps
    .filter(Boolean)
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');
}

function extractImage(image) {
  if (!image) return null;
  if (typeof image === 'string') return image;
  if (Array.isArray(image)) return extractImage(image[0]);
  if (typeof image === 'object') return image.url || null;
  return null;
}

function parseYield(recipeYield) {
  if (!recipeYield) return null;
  const value = Array.isArray(recipeYield) ? recipeYield[0] : recipeYield;
  const match = String(value).match(/(\d+(\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

/**
 * Convierte una duración ISO 8601 (ej: "PT30M", "PT1H15M") a minutos.
 */
export function parseIsoDuration(duration) {
  if (!duration) return null;
  const match = String(duration).match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/);
  if (!match) return null;
  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const total = days * 24 * 60 + hours * 60 + minutes;
  return total > 0 ? total : null;
}

function cleanText(text) {
  return String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ==========================================================
// Parseo heurístico de una línea de ingrediente en texto libre
// ("2 tazas de harina", "1/2 kg de pollo", "3 huevos")
// ==========================================================

const UNICODE_FRACTIONS = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const KNOWN_UNITS = [
  'g', 'gr', 'gramos', 'kg', 'kilo', 'kilos', 'ml', 'mililitros', 'l', 'litro', 'litros',
  'taza', 'tazas', 'cucharada', 'cucharadas', 'cucharadita', 'cucharaditas',
  'unidad', 'unidades', 'diente', 'dientes', 'pizca', 'rodaja', 'rodajas',
  'lata', 'latas', 'paquete', 'paquetes', 'cup', 'cups', 'tbsp', 'tsp', 'oz', 'lb',
];

/**
 * Heurística best-effort: separa "cantidad", "unidad" y "nombre" de una línea
 * de ingrediente en texto libre. No es infalible — por eso el resultado
 * siempre pasa por una vista previa editable antes de guardarse.
 */
export function parseIngredientLine(line) {
  let text = line.trim();

  // Reemplazar fracciones unicode por su equivalente decimal
  for (const [symbol, value] of Object.entries(UNICODE_FRACTIONS)) {
    text = text.replace(symbol, ` ${value} `);
  }
  text = text.replace(/\s+/g, ' ').trim();

  // "1 1/2" o "1/2" al inicio
  const mixedFractionMatch = text.match(/^(\d+)\s+(\d+)\/(\d+)\s*/);
  const simpleFractionMatch = !mixedFractionMatch && text.match(/^(\d+)\/(\d+)\s*/);
  const decimalMatch =
    !mixedFractionMatch && !simpleFractionMatch && text.match(/^(\d+([.,]\d+)?)\s*(-\s*\d+([.,]\d+)?)?\s*/);

  let quantity = null;
  let rest = text;

  if (mixedFractionMatch) {
    quantity = Number(mixedFractionMatch[1]) + Number(mixedFractionMatch[2]) / Number(mixedFractionMatch[3]);
    rest = text.slice(mixedFractionMatch[0].length);
  } else if (simpleFractionMatch) {
    quantity = Number(simpleFractionMatch[1]) / Number(simpleFractionMatch[2]);
    rest = text.slice(simpleFractionMatch[0].length);
  } else if (decimalMatch && decimalMatch[1]) {
    quantity = Number(decimalMatch[1].replace(',', '.'));
    rest = text.slice(decimalMatch[0].length);
  }

  rest = rest.trim();

  // Unidad: primera palabra si matchea el diccionario conocido
  let unit = null;
  const firstWordMatch = rest.match(/^([a-záéíóúñ]+)\.?\s+/i);
  if (firstWordMatch) {
    const candidate = firstWordMatch[1].toLowerCase();
    if (KNOWN_UNITS.includes(candidate)) {
      unit = candidate;
      rest = rest.slice(firstWordMatch[0].length).trim();
    }
  }

  // "de harina" -> "harina"
  rest = rest.replace(/^de\s+/i, '').trim();

  return {
    quantity,
    unit: unit || (quantity ? 'unidad' : null),
    name: rest || text,
  };
}

// ==========================================================
// Fallback heurístico de scraping sin JSON-LD
// ==========================================================

const INGREDIENT_HINTS = /ingredient|ingrediente/i;
const STEP_HINTS = /instruction|direction|preparaci[oó]n|paso|step|method/i;

/**
 * Cuando no hay JSON-LD, busca patrones comunes: contenedores cuya clase/id
 * mencionen "ingredient(e)" y listas <li> dentro, y análogamente para pasos.
 * Es un heurístico de último recurso — su resultado casi siempre necesita
 * corrección manual en la vista previa.
 */
export function heuristicScrape(html) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer').remove();

  const name = cleanText($('h1').first().text()) || cleanText($('title').first().text());

  const ingredientLines = collectListItemsNear($, INGREDIENT_HINTS);
  const stepLines = collectListItemsNear($, STEP_HINTS);

  const ingredients = ingredientLines.map((line) => ({
    raw_text: line,
    ...parseIngredientLine(line),
  }));

  return {
    name: name || null,
    base_servings: null,
    prep_time_minutes: null,
    instructions: stepLines.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    ingredients,
    image_url: $('meta[property="og:image"]').attr('content') || null,
    parsed_with: 'heuristic',
    confidence: ingredients.length > 0 ? 'low' : 'very_low',
  };
}

function collectListItemsNear($, hintRegex) {
  const seen = new Set();
  const results = [];

  $('[class], [id]').each((_, el) => {
    const attrs = `${$(el).attr('class') || ''} ${$(el).attr('id') || ''}`;
    if (!hintRegex.test(attrs)) return;

    $(el)
      .find('li')
      .each((__, li) => {
        const text = cleanText($(li).text());
        if (text && text.length > 1 && text.length < 300 && !seen.has(text)) {
          seen.add(text);
          results.push(text);
        }
      });
  });

  return results;
}

/**
 * Extrae texto visible "plano" de la página (para mandarlo como último
 * recurso a un LLM que lo estructure). Se recorta a un tamaño razonable.
 */
export function extractVisibleText(html, maxChars = 8000) {
  const $ = cheerio.load(html);
  $('script, style, nav, header, footer, svg, noscript').remove();
  const text = cleanText($('body').text());
  return text.slice(0, maxChars);
}
