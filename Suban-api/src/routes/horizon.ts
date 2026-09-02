import { Router, Request, Response } from 'express';
import { proxyToHorizon } from '../services/horizon';
import { getCached, setCache } from '../services/cache';

const router = Router();

// Proxy all Horizon requests with caching
router.all('/*', async (req: Request, res: Response) => {
  try {
    const path = req.path;
    const cacheKey = `${req.method}:${path}:${JSON.stringify(req.query)}`;

    // Try cache for GET requests
    if (req.method === 'GET') {
      const cached = getCached(cacheKey);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }
    }

    const data = await proxyToHorizon(path, req.method, req.query, req.body);

    // Cache GET responses
    if (req.method === 'GET') {
      setCache(cacheKey, data);
      res.set('X-Cache', 'MISS');
    }

    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({
      error: 'Horizon API error',
      message: error.message,
    });
  }
});

export { router as horizonRouter };
