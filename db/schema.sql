-- ==========================================================
-- MenuApp - Esquema de base de datos (PostgreSQL)
-- ==========================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- ==========================================================
-- USUARIOS
-- ==========================================================
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  name          text,
  lookback_weeks integer NOT NULL DEFAULT 3, -- default del algoritmo de rotación
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- INGREDIENTES
-- ==========================================================
CREATE TYPE ingredient_category AS ENUM (
  'verduleria', 'carniceria', 'almacen', 'lacteos',
  'panaderia', 'congelados', 'bebidas', 'limpieza', 'otros'
);

CREATE TABLE IF NOT EXISTS ingredients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (lower(trim(name))) STORED,
  default_unit    text NOT NULL,
  category        ingredient_category NOT NULL DEFAULT 'otros',
  estimated_price numeric(10,2),
  price_updated_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, normalized_name)
);

-- Conversión de unidades usadas en recetas -> default_unit del ingrediente
-- (ej: 1 "diente" de ajo = 5 "g")
CREATE TABLE IF NOT EXISTS ingredient_unit_conversions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  from_unit     text NOT NULL,
  factor        numeric(12,4) NOT NULL, -- cantidad_en_default_unit = cantidad_en_from_unit * factor
  UNIQUE (ingredient_id, from_unit)
);

-- ==========================================================
-- COMIDAS (RECETAS)
-- ==========================================================
CREATE TYPE meal_type AS ENUM ('desayuno', 'almuerzo', 'cena', 'snack');

CREATE TABLE IF NOT EXISTS meals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  meal_type        meal_type NOT NULL,
  tags             text[] NOT NULL DEFAULT '{}',
  prep_time_minutes integer,
  base_servings    numeric(5,2) NOT NULL DEFAULT 1,
  instructions     text,
  source_url       text,
  nutrition        jsonb,
  avg_rating       numeric(3,2),
  times_cooked     integer NOT NULL DEFAULT 0,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meals_user_type ON meals(user_id, meal_type) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_meals_tags ON meals USING gin(tags);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_meals_updated_at ON meals;
CREATE TRIGGER trg_meals_updated_at BEFORE UPDATE ON meals
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ==========================================================
-- INGREDIENTES POR COMIDA (cantidades a base_servings)
-- ==========================================================
CREATE TABLE IF NOT EXISTS meal_ingredients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meal_id       uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  quantity      numeric(10,2) NOT NULL,
  unit          text NOT NULL,
  notes         text,
  is_optional   boolean NOT NULL DEFAULT false,
  UNIQUE (meal_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_meal_ingredients_ingredient ON meal_ingredients(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_meal_ingredients_meal ON meal_ingredients(meal_id);

-- ==========================================================
-- DESPENSA
-- ==========================================================
CREATE TABLE IF NOT EXISTS pantry_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  quantity      numeric(10,2) NOT NULL DEFAULT 0,
  unit          text NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, ingredient_id)
);

-- ==========================================================
-- RESTRICCIONES / PREFERENCIAS
-- ==========================================================
CREATE TYPE restriction_type AS ENUM ('alergia', 'no_me_gusta', 'evitar');

CREATE TABLE IF NOT EXISTS user_ingredient_restrictions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  type          restriction_type NOT NULL,
  is_hard       boolean NOT NULL DEFAULT true, -- true = filtro duro; false = penaliza el score pero no excluye
  UNIQUE (user_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS user_tag_limits (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag          text NOT NULL,
  max_per_week integer NOT NULL,
  UNIQUE (user_id, tag)
);

-- ==========================================================
-- MENÚ SEMANAL
-- ==========================================================
CREATE TABLE IF NOT EXISTS menu_weeks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start_date date NOT NULL,
  status          text NOT NULL DEFAULT 'draft', -- draft | confirmed
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_start_date)
);

CREATE TABLE IF NOT EXISTS menu_slots (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_week_id   uuid NOT NULL REFERENCES menu_weeks(id) ON DELETE CASCADE,
  day_of_week    smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=lunes
  slot_type      meal_type NOT NULL,
  meal_id        uuid REFERENCES meals(id) ON DELETE SET NULL,
  servings_planned numeric(5,2) NOT NULL DEFAULT 1,
  is_locked      boolean NOT NULL DEFAULT false,
  is_leftover    boolean NOT NULL DEFAULT false,
  source_slot_id uuid REFERENCES menu_slots(id) ON DELETE SET NULL,
  UNIQUE (menu_week_id, day_of_week, slot_type)
);
CREATE INDEX IF NOT EXISTS idx_menu_slots_meal ON menu_slots(meal_id);
CREATE INDEX IF NOT EXISTS idx_menu_slots_week ON menu_slots(menu_week_id);

-- ==========================================================
-- HISTORIAL DE USO + RATING
-- ==========================================================
CREATE TABLE IF NOT EXISTS meal_usage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  meal_id       uuid NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
  menu_slot_id  uuid REFERENCES menu_slots(id) ON DELETE SET NULL,
  used_date     date NOT NULL,
  rating        smallint CHECK (rating BETWEEN 1 AND 5),
  rated_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_usage_meal_date ON meal_usage_history(user_id, meal_id, used_date DESC);

-- ==========================================================
-- LISTA DE COMPRAS
-- ==========================================================
CREATE TABLE IF NOT EXISTS shopping_lists (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          text,
  period_type   text NOT NULL DEFAULT 'weekly', -- weekly | monthly | custom
  start_date    date NOT NULL,
  end_date      date NOT NULL,
  total_estimated_cost numeric(10,2),
  generated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shopping_list_sources (
  shopping_list_id uuid NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  menu_week_id     uuid NOT NULL REFERENCES menu_weeks(id) ON DELETE CASCADE,
  PRIMARY KEY (shopping_list_id, menu_week_id)
);

CREATE TABLE IF NOT EXISTS shopping_list_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id  uuid NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  ingredient_id     uuid NOT NULL REFERENCES ingredients(id) ON DELETE RESTRICT,
  category          ingredient_category NOT NULL,
  quantity_needed   numeric(10,2) NOT NULL,
  quantity_in_pantry numeric(10,2) NOT NULL DEFAULT 0,
  quantity_to_buy   numeric(10,2) NOT NULL,
  unit              text NOT NULL,
  estimated_price   numeric(10,2),
  is_purchased      boolean NOT NULL DEFAULT false,
  purchased_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_shopping_items_list ON shopping_list_items(shopping_list_id);
