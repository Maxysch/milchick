import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

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

// Routes will be added here as we build each module
// app.use('/api/auth', authRoutes);
// app.use('/api/profiles', profileRoutes);
// app.use('/api/clients', clientRoutes);
// app.use('/api/schedules', scheduleRoutes);
// app.use('/api/clock-entries', clockEntryRoutes);
// app.use('/api/exceptions', exceptionRoutes);
// app.use('/api/overtime', overtimeRoutes);
// app.use('/api/holidays', holidayRoutes);
// app.use('/api/agent-rates', agentRateRoutes);
// app.use('/api/normalization', normalizationRoutes);
// app.use('/api/pre-settlements', preSettlementRoutes);
// app.use('/api/settlement-rules', settlementRuleRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Milchick backend running on port ${PORT}`);
});
