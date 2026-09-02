import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import 'dotenv/config';

import authRoutes from './routes/auth.routes.js';
import ingredientsRoutes from './routes/ingredients.routes.js';
import mealsRoutes from './routes/meals.routes.js';
import pantryRoutes from './routes/pantry.routes.js';
import restrictionsRoutes from './routes/restrictions.routes.js';
import recipeImportRoutes from './routes/recipeImport.routes.js';
import menuRoutes from './routes/menu.routes.js';
import shoppingListRoutes from './routes/shoppingList.routes.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(morgan(process.env.NODE_ENV === 'test' ? 'silent' : 'dev'));

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/ingredients', ingredientsRoutes);
  app.use('/api/meals', mealsRoutes);
  app.use('/api/pantry', pantryRoutes);
  app.use('/api/restrictions', restrictionsRoutes);
  app.use('/api/recipe-import', recipeImportRoutes);
  app.use('/api/menu', menuRoutes);
  app.use('/api/shopping-lists', shoppingListRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
