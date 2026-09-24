/**
 * Arc chain routes - EVM-compatible JSON-RPC proxy
 * Arc is Circle's stablecoin-native L1 with USDC-denominated gas and native CCTP.
 */
import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import axios from 'axios';
import { getCached, setCache } from '../services/cache';

const router = Router();

/**
 * GET /arc/health
 * Check Arc RPC connectivity
 */
router.get('/health', async (_req: Request, res: Response) => {
  if (!config.arcRpcUrl) {
    return res.json({
      status: 'not_configured',
      message: 'Arc RPC URL not configured. Set ARC_RPC_URL environment variable.',
    });
  }

  try {
    const response = await axios.post(config.arcRpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }, { timeout: 5000 });

    const blockNumber = parseInt(response.data.result, 16);

    res.json({
      status: 'healthy',
      chain: config.arcNetworkName,
      chain_id: config.arcChainId,
      rpc_url: config.arcRpcUrl.replace(/\/\/.*@/, '//***@'), // mask credentials
      latest_block: blockNumber,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

/**
 * GET /arc/block-number
 * Get latest Arc block number
 */
router.get('/block-number', async (_req: Request, res: Response) => {
  if (!config.arcRpcUrl) {
    return res.status(503).json({ error: 'Arc RPC not configured' });
  }

  try {
    const cacheKey = 'arc:block-number';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const response = await axios.post(config.arcRpcUrl, {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1,
    }, { timeout: 5000 });

    const result = {
      block_number: parseInt(response.data.result, 16),
      chain: config.arcNetworkName,
      chain_id: config.arcChainId,
    };

    setCache(cacheKey, result, 2);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /arc/rpc
 * Proxy raw JSON-RPC requests to Arc
 */
router.post('/rpc', async (req: Request, res: Response) => {
  if (!config.arcRpcUrl) {
    return res.status(503).json({ error: 'Arc RPC not configured' });
  }

  try {
    const response = await axios.post(config.arcRpcUrl, req.body, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });

    res.json(response.data);
  } catch (error: any) {
    const status = error.response?.status || 500;
    const data = error.response?.data || { error: error.message };
    res.status(status).json(data);
  }
});

export { router as arcRouter };
