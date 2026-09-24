/**
 * Escrow API routes - backend for the Escrow Viewer React app
 * Queries Horizon and Soroban RPC for escrow contract data.
 */
import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../utils/logger';
import axios from 'axios';
import { rpc } from '@stellar/stellar-sdk';

const router = Router();

function getHorizonUrl(): string {
  return config.network === 'testnet' ? config.horizon.testnet : config.horizon.mainnet;
}

function getRpcUrl(): string {
  return config.network === 'testnet'
    ? (process.env.SOROBAN_RPC_TESTNET_URL || 'https://rpc.testnet.minepi.com')
    : (process.env.SOROBAN_RPC_MAINNET_URL || 'https://rpc.suban.org');
}

/**
 * GET /api/escrow/:escrowId
 * Get escrow contract state from Soroban RPC
 */
router.get('/:escrowId', async (req: Request, res: Response) => {
  try {
    const { escrowId } = req.params;
    const rpcUrl = getRpcUrl();
    const server = new rpc.Server(rpcUrl);

    // Try to get the contract data
    try {
      const ledgerKey = rpc.LedgerKey.contractData({
        contractId: escrowId,
        key: rpc.xdr.LedgerKey.scsvStaticSym([
          rpc.xdr.ScSymbol.scSymbol('Escrow'),
        ]),
      });

      const response = await server.getLedgerEntries([ledgerKey]);
      const entry = response.entries?.[0];

      if (entry) {
        const contractData = entry.val.contractData();
        const data = contractData.val();
        // Try to decode as a struct with status, funder, receiver, milestones
        res.json({
          escrowId,
          status: 'active',
          funder: '',
          receiver: '',
          totalDeposited: '0',
          totalReleased: '0',
          milestones: [],
          raw: data.toXDR('base64'),
        });
        return;
      }
    } catch (e) {
      // Contract data not found or decode error
    }

    // Fallback: return basic info
    res.json({
      escrowId,
      status: 'unknown',
      funder: '',
      receiver: '',
      totalDeposited: '0',
      totalReleased: '0',
      milestones: [],
      message: 'Escrow contract data could not be decoded. The contract may not be deployed or the ID is invalid.',
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error fetching escrow state', { error: errorMessage, escrowId: req.params.escrowId });
    res.status(500).json({
      error: 'Failed to fetch escrow state',
      message: errorMessage,
    });
  }
});

/**
 * GET /api/gateway/events
 * Get contract events from Horizon (compatible with escrow viewer)
 */
router.get('/gateway/events', async (req: Request, res: Response) => {
  try {
    const contract = req.query.contract as string || 'escrow';
    const limit = parseInt(req.query.limit as string) || 50;
    const horizonUrl = getHorizonUrl();

    // Query Horizon for contract events
    const response = await axios.get(`${horizonUrl}/events`, {
      params: {
        type: 'contract',
        limit: Math.min(limit, 100),
        order: 'desc',
      },
      timeout: 10000,
    });

    const events = response.data._embedded?.records || [];

    res.json({
      events: events.map((e: any) => ({
        id: e.id,
        event_type: e.type,
        tx_hash: e.transaction_hash,
        ledger: parseInt(e.ledger || '0'),
        timestamp: e.created_at,
        data: e.value,
      })),
      total: events.length,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Error fetching gateway events', { error: errorMessage });
    res.json({
      events: [],
      total: 0,
      error: errorMessage,
    });
  }
});

export { router as escrowRouter };
