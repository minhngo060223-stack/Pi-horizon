import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  horizonUrl: process.env.HORIZON_URL || 'http://localhost:41401',
  network: process.env.NETWORK || 'mainnet',
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
  cacheTTL: parseInt(process.env.CACHE_TTL_SECONDS || '5', 10),
};
