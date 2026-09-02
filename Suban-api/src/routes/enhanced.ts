import { Router, Request, Response } from 'express';
import { proxyToHorizon } from '../services/horizon';
import { getCached, setCache } from '../services/cache';

const router = Router();

// Network summary
router.get('/summary', async (_req: Request, res: Response) => {
  try {
    const cacheKey = 'summary';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const [ledgerRes, accountsRes] = await Promise.all([
      proxyToHorizon('/ledgers?order=desc&limit=1'),
      proxyToHorizon('/accounts?order=desc&limit=1'),
    ]);

    const latestLedger = ledgerRes._embedded.records[0];
    const summary = {
      latest_ledger: latestLedger.sequence,
      ledger_close_time: latestLedger.closed_at,
      transaction_count: latestLedger.transaction_count,
      operation_count: latestLedger.operation_count,
      network: process.env.NETWORK || 'mainnet',
    };

    setCache(cacheKey, summary, 10);
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Account details
router.get('/accounts/:accountId', async (req: Request, res: Response) => {
  try {
    const cacheKey = `account:${req.params.accountId}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const data = await proxyToHorizon(`/accounts/${req.params.accountId}`);
    setCache(cacheKey, data, 15);
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Account transactions
router.get('/accounts/:accountId/transactions', async (req: Request, res: Response) => {
  try {
    const data = await proxyToHorizon(`/accounts/${req.params.accountId}/transactions`, 'GET', req.query);
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Transaction by hash
router.get('/transactions/:hash', async (req: Request, res: Response) => {
  try {
    const cacheKey = `tx:${req.params.hash}`;
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const data = await proxyToHorizon(`/transactions/${req.params.hash}`);
    setCache(cacheKey, data, 30);
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Recent ledgers
router.get('/ledgers', async (req: Request, res: Response) => {
  try {
    const data = await proxyToHorizon('/ledgers', 'GET', req.query);
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

// Assets
router.get('/assets', async (req: Request, res: Response) => {
  try {
    const data = await proxyToHorizon('/assets', 'GET', req.query);
    res.json(data);
  } catch (error: any) {
    res.status(error.status || 500).json({ error: error.message });
  }
});

export { router as enhancedRouter };
