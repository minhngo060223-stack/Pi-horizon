import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './utils/logger';
import { horizonRouter } from './routes/horizon';
import { enhancedRouter } from './routes/enhanced';

const app = express();
app.set('trust proxy', 1);

// CORS
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use(limiter);

// Body parsing
app.use(express.json());

// Request logging
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`);
  next();
});

// Enhanced API routes (cached)
app.use('/api/v1', enhancedRouter);

// Raw Horizon proxy (for full API compatibility)
app.use('/horizon', horizonRouter);

// Root
app.get('/', (_req, res) => {
  res.json({
    name: 'Suban API',
    version: '1.0.0',
    description: 'Horizon API wrapper for Pi Network with caching and rate limiting',
    platform: 'https://suban.org',
    endpoints: {
      summary: '/api/v1/summary',
      account: '/api/v1/accounts/:accountId',
      transactions: '/api/v1/accounts/:accountId/transactions',
      transaction: '/api/v1/transactions/:hash',
      ledgers: '/api/v1/ledgers',
      assets: '/api/v1/assets',
      horizon: '/horizon/*',
    },
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'suban-api', timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ error: 'Internal Server Error' });
});

const server = app.listen(config.port, () => {
  logger.info(`Suban API running on port ${config.port}`);
  logger.info(`Horizon: ${config.horizonUrl}`);
  logger.info(`Rate limit: ${config.rateLimit.maxRequests} req/${config.rateLimit.windowMs / 1000}s`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
