import Anthropic from '@anthropic-ai/sdk';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) client = new Anthropic();
  return client;
}

export function llmFallbackAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM_PROMPT = `Extraes recetas de cocina a partir de texto plano de una página web.
Respondé ÚNICAMENTE con JSON válido, sin texto adicional ni markdown, con esta forma exacta:
{
  "name": string | null,
  "base_servings": number | null,
  "prep_time_minutes": number | null,
  "instructions": string,
  "ingredients": [
    { "raw_text": string, "quantity": number | null, "unit": string | null, "name": string }
  ]
}
Si un dato no está presente en el texto, usá null. "instructions" debe ser un texto con los pasos
numerados separados por saltos de línea. No inventes ingredientes ni cantidades que no estén en el texto.`;

/**
 * Último recurso cuando no hay JSON-LD y el scraping heurístico no encontró
 * nada usable: le pedimos al modelo que estructure el texto visible de la
 * página en nuestro formato de draft. Requiere ANTHROPIC_API_KEY configurada.
 */
export async function structureRecipeWithLlm(visibleText, sourceUrl) {
  const anthropic = getClient();
  if (!anthropic) {
    throw new Error('ANTHROPIC_API_KEY no está configurada: el fallback por LLM no está disponible');
  }

  const response = await anthropic.messages.create({
    model: 'claude-opus-5',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Texto extraído de ${sourceUrl}:\n\n${visibleText}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === 'text');
  if (!textBlock) {
    throw new Error('El modelo no devolvió una respuesta de texto');
  }

  const draft = safeParseJson(textBlock.text);
  if (!draft) {
    throw new Error('El modelo no devolvió JSON válido');
  }

  return {
    name: draft.name || null,
    base_servings: draft.base_servings || null,
    prep_time_minutes: draft.prep_time_minutes || null,
    instructions: draft.instructions || '',
    ingredients: Array.isArray(draft.ingredients) ? draft.ingredients : [],
    image_url: null,
    source_url: sourceUrl,
    parsed_with: 'llm',
  };
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // A veces el modelo envuelve el JSON en ```json ... ``` a pesar de la instrucción.
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}
