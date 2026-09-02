# MenuApp — Planificador de menús semanales

Aplicación web personal para cargar recetas, generar automáticamente un menú
semanal rotativo (evitando repetir comidas muy seguido, respetando
restricciones y priorizando lo mejor calificado) y armar la lista de compras
consolidada a partir de ese menú, descontando lo que ya hay en la despensa.

## Stack

- **Backend:** Node.js + Express + PostgreSQL (SQL crudo vía `pg`, sin ORM)
- **Frontend:** React 18 + Vite + React Router
- **Auth:** JWT (registro/login con `bcryptjs` + `jsonwebtoken`)
- **Importación de recetas:** `cheerio` para JSON-LD/scraping heurístico, con
  fallback opcional a la API de Anthropic para estructurar recetas sin datos
  estructurados.

## Estructura del repo

```
db/schema.sql          Esquema completo de PostgreSQL (tablas, enums, índices)
backend/                API REST (Express)
  src/routes/            Un archivo por recurso (auth, meals, ingredients, ...)
  src/services/          Lógica de negocio: generador de menú, lista de compras,
                          parser de recetas, escalado de porciones
  src/db/migrate.js      Aplica db/schema.sql contra DATABASE_URL
frontend/                SPA en React (Vite)
  src/pages/              Una página por vista
  src/api/client.js       Cliente HTTP fino con manejo de JWT
```

## 1. Requisitos

- Node.js 18+
- PostgreSQL 14+ corriendo localmente (o accesible por `DATABASE_URL`)

## 2. Backend

```bash
cd backend
cp .env.example .env
# Editar .env: DATABASE_URL, JWT_SECRET (obligatorios).
# ANTHROPIC_API_KEY es opcional (fallback de importación de recetas).

npm install
npm run migrate     # crea las tablas en la base indicada por DATABASE_URL
npm run dev          # http://localhost:4000, con reinicio automático (node --watch)
```

Chequeo rápido: `curl http://localhost:4000/health` debe devolver `{"status":"ok"}`.

### Variables de entorno (`backend/.env`)

| Variable | Descripción |
|---|---|
| `PORT` | Puerto del servidor (default 4000) |
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `JWT_SECRET` | Secreto para firmar los JWT — **cambiar en producción** |
| `JWT_EXPIRES_IN` | Vigencia del token (default `7d`) |
| `CORS_ORIGIN` | Origen permitido para CORS (URL del frontend) |
| `ANTHROPIC_API_KEY` | Opcional. Si está seteada, habilita el fallback por LLM en la importación de recetas |

## 3. Frontend

```bash
cd frontend
cp .env.example .env   # por defecto ya apunta a /api (proxeado por Vite)
npm install
npm run dev             # http://localhost:5173
```

En desarrollo, Vite proxea `/api/*` hacia `http://localhost:4000` (configurable
con `VITE_API_PROXY_TARGET`), así que no hace falta configurar CORS a mano
para desarrollo local.

## 4. Uso típico

1. Registrarte (`/register`) e iniciar sesión.
2. Cargar algunas comidas en **Comidas** (manualmente o importando desde un
   link en **Importar receta**) — necesitás al menos un par de opciones por
   tipo de comida para que el generador tenga margen de variedad real.
3. Opcional: cargar tu **Despensa** y tus **Preferencias** (alergias, "no me
   gusta", límites por tag, cuántas semanas no repetir una comida).
4. En **Menú semanal**, elegir una semana y generar el menú. Podés fijar
   comidas puntuales (🔒), pedir una alternativa para un solo día, o
   regenerar toda la semana (respeta lo fijado).
5. Confirmar la semana una vez que estés conforme (esto la registra en el
   historial de uso, para que no se repita pronto).
6. En **Listas de compras**, generar la lista a partir de una o más semanas
   ya generadas — se descuenta la despensa automáticamente y se agrupa por
   categoría. Podés marcar ítems comprados y exportarla como texto.

## 5. El algoritmo de rotación, en resumen

Para cada slot vacío del menú:

1. **Filtros duros:** se excluyen comidas con ingredientes marcados como
   alergia, las que ya se usaron esa misma semana, y las que harían superar
   un límite de tag (ej. "carne roja ≤ 2/semana").
2. **Ventana de "no repetir":** se excluyen además las comidas usadas en las
   últimas *N* semanas (configurable en Preferencias). Si con eso el pool
   queda vacío, se relaja esa ventana de a una semana hasta encontrar al
   menos una opción — nunca se salta una alergia.
3. **Sorteo ponderado:** entre las candidatas que pasan los filtros, se elige
   con un sorteo pesado por rating (las mejor calificadas pesan más, pero
   nunca se descartan del todo las demás) y por cuánto hace que no se usan
   (recency) — así se prioriza calidad sin perder variedad.
4. **Sobras:** si la comida elegida rinde más porciones de las necesarias
   para ese slot, se ofrece como candidata (con más o menos peso según
   `leftover_affinity`) para el mismo slot del día siguiente, en vez de
   gastar otra receta.
5. Los slots fijados manualmente (🔒) nunca se tocan al regenerar, pero sí
   cuentan para los límites de tag de esa semana.

Detalle completo, incluyendo el pseudocódigo, en
`backend/src/services/menuGenerator.service.js` (está fuertemente
comentado).

## 6. Decisiones de diseño y limitaciones conocidas

Quedaron documentadas acá porque son cosas que conviene tener presentes al
seguir desarrollando, no bugs pendientes de una implementación incompleta:

- **Unidades de medida:** una receta puede usar una unidad distinta a la
  `default_unit` del ingrediente (ej. "2 dientes de ajo" vs. el ingrediente
  "Ajo" que se compra en gramos). Para que la lista de compras sume bien,
  hay que cargar una conversión (`POST /ingredients/:id/unit-conversions`).
  Si falta, el ítem queda en su propia unidad y la lista de compras avisa
  con un warning en vez de sumar cantidades que no son comparables.
- **Precisión de precios:** `estimated_price` es `numeric(10,2)`, es decir 2
  decimales. Para ingredientes muy baratos por unidad (ej. $0.005/g) esto
  redondea de forma visible al guardar el ingrediente. Si esto importa en la
  práctica, migrar esa columna a más decimales es un cambio de una línea en
  `db/schema.sql`.
- **Catálogo chico = slots vacíos:** con pocas recetas cargadas por tipo de
  comida, el generador va a dejar slots sin asignar (con un warning
  explicando por qué) en vez de repetir una comida en la misma semana o
  saltarse una restricción. Es el comportamiento esperado — la solución es
  cargar más recetas, no relajar más el algoritmo.
- **Bloqueo de bots en la importación de recetas:** muchos sitios de recetas
  devuelven 403 a pedidos sin navegador real (Cloudflare, etc.). El importador
  lo reporta como error claro en vez de fallar silenciosamente; no hay forma
  de evitarlo sin un navegador headless, que quedó fuera de alcance del MVP.
  Los sitios que sí exponen JSON-LD `schema.org/Recipe` (la mayoría de los
  blogs de cocina más chicos, y muchos medios grandes) funcionan bien.
- **`servings_needed` por slot:** el generador asume 2 porciones necesarias
  por comida si no se especifica (parámetro `servings_needed` al generar),
  ya que no hay un campo de "tamaño del hogar" en el modelo actual. Es lo que
  determina cuándo una receta "rinde de más" y se ofrece como sobra.

## 7. Verificación realizada

- **Backend:** smoke test de punta a punta contra PostgreSQL real (no
  mockeado) cubriendo auth, CRUD de ingredientes/comidas/despensa/
  restricciones, escalado de porciones, generación y confirmación de menú
  (incluyendo bloqueo, alternativa por día, y detección de sobras), y
  generación de lista de compras con descuento de despensa y agrupación por
  categoría. Además, tests unitarios puntuales del parser de recetas
  (JSON-LD, heurístico, parseo de cantidades en texto libre).
- **Frontend:** recorrido end-to-end en navegador real (Playwright/Chromium)
  cubriendo registro, alta de comida con creación rápida de ingrediente,
  generación y confirmación de menú, fijado y alternativa de slots, generación
  de lista de compras, marcado de comprado, exportación como texto, y manejo
  de errores en la importación de recetas.
- Durante esa verificación aparecieron y se corrigieron varios bugs reales
  (no cosméticos): tipos de Postgres sin castear en `COALESCE` para columnas
  `enum`/`array`/`numeric` que rompían la creación de ingredientes y comidas,
  y un bug de manejo de fechas (`node-pg` devuelve columnas `date` como
  objetos `Date`, no strings) que hacía que el filtro de "no repetir en las
  últimas N semanas" descartara candidatas por error.

## 8. Próximos pasos sugeridos (fuera de alcance de este MVP)

- Info nutricional automática (hoy es un campo `jsonb` libre, sin cálculo).
- Exportar/compartir la lista de compras como link público, no solo texto.
- Vista de historial de gasto semana a semana (los datos ya se guardan en
  `shopping_lists.total_estimated_cost`, falta solo el gráfico).
- Tabla `ingredient_unit_conversions` con sugerencias automáticas por nombre
  de unidad común, para no tener que cargarlas todas a mano.
