import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import authRoutes from './routes/auth.routes.js';
import profileRoutes from './routes/profiles.routes.js';
import clientRoutes from './routes/clients.routes.js';
import agentRateRoutes from './routes/agentRates.routes.js';
import scheduleRoutes from './routes/schedules.routes.js';
import clockEntryRoutes from './routes/clockEntries.routes.js';
import exceptionRoutes from './routes/exceptions.routes.js';
import overtimeRoutes from './routes/overtime.routes.js';
import holidayRoutes from './routes/holidays.routes.js';
import rulesRoutes from './routes/rules.routes.js';
import normalizationRoutes from './routes/normalization.routes.js';
import preSettlementRoutes from './routes/preSettlements.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import dashboardRoutes from './routes/dashboard.routes.js';
import periodParamsRoutes from './routes/periodParams.routes.js';
import agentChatRoutes from './routes/agent.routes.js';

/**
 * Orígenes autorizados a llamar a la API, separados por coma.
 *
 * Con el front y el back en el mismo dominio esto no hace falta. Deployados
 * por separado —Netlify y Render, por ejemplo— el navegador le exige al back
 * que declare quién puede llamarlo.
 *
 * Sin `CORS_ORIGIN` la API acepta cualquier origen. Alcanza para desarrollo,
 * donde Vite hace de proxy y nunca hay cross-origin, pero en producción hay
 * que configurarlo: mientras quede abierto, un token robado sirve desde
 * cualquier página.
 */
const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const app = express();

// Render y Netlify sirven detrás de un proxy: sin esto `req.ip` es el del
// proxy y los logs pierden el origen real
app.set('trust proxy', 1);

app.use(helmet());
app.use(cors(allowedOrigins.length > 0 ? { origin: allowedOrigins } : {}));
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/clients', clientRoutes);
app.use('/api/agent-rates', agentRateRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/clock-entries', clockEntryRoutes);
app.use('/api/exceptions', exceptionRoutes);
app.use('/api/overtime', overtimeRoutes);
app.use('/api/holidays', holidayRoutes);
app.use('/api/rules', rulesRoutes);
app.use('/api/normalization', normalizationRoutes);
app.use('/api/pre-settlements', preSettlementRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/period-params', periodParamsRoutes);
app.use('/api/agent', agentChatRoutes);

export default app;
