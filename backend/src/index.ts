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

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

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

app.listen(PORT, () => {
  console.log(`🚀 Milchick backend running on port ${PORT}`);
});
