/**
 * Contract search routes.
 *
 * This Pi Horizon build exposes no contract-state endpoints (/contracts/:id 404s,
 * /accounts/:contractId 400s) and silently ignores the effects type and contract
 * filters. Contract discovery therefore has to be built by paging the effects
 * ledger and grouping client-side. Scans are bounded and cached because the yield
 * is low relative to the number of pages.
 */
import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import axios from 'axios';

const router: Router = Router();

type Network = 'mainnet' | 'testnet';

const HORIZON_URLS: Record<Network, string> = {
  mainnet: process.env.HORIZON_MAINNET_URL || 'http://pi-mainnet:8000',
  testnet: process.env.HORIZON_TESTNET_URL || 'http://pi-testnet:8000',
};

const PAGE_SIZE = 200;
const MAX_PAGES = 10;
const CACHE_TTL_MS = 60_000;

interface ContractRecord {
  contractId: string;
  effectCount: number;
  lastActivity: string;
  effectTypes: Record<string, number>;
}

interface CacheEntry {
  expires: number;
  contracts: ContractRecord[];
  scannedEffects: number;
}

const cache = new Map<Network, CacheEntry>();

function isNetwork(value: unknown): value is Network {
  return value === 'mainnet' || value === 'testnet';
}

function resolveNetwork(req: Request): Network {
  const requested = req.query.network ?? req.params.network;
  return isNetwork(requested) ? requested : 'mainnet';
}

function horizonUrl(network: Network): string {
  return HORIZON_URLS[network];
}

/**
 * Page through recent effects and group contract activity.
 * Bounded by MAX_PAGES so a single request cannot run unbounded.
 */
async function scanContracts(network: Network): Promise<CacheEntry> {
  const cached = cache.get(network);
  if (cached && cached.expires > Date.now()) {
    return cached;
  }

  const base = horizonUrl(network);
  const byContract = new Map<string, ContractRecord>();
  let cursor = '';
  let scanned = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url: string = `${base}/effects?limit=${PAGE_SIZE}&order=desc${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

    let payload: any;
    try {
      const response = await axios.get(url, { timeout: 15000 });
      payload = response.data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'unknown';
      logger.warn('Contract scan page failed', { network, page, error: message });
      break;
    }

    const records: any[] = payload?._embedded?.records ?? [];
    if (records.length === 0) break;

    for (const effect of records) {
      scanned++;
      const contractId: string | undefined = effect.contract;
      if (!contractId) continue;

      // This Horizon build omits ledger and transaction_hash on effects, so
      // created_at is the only reliable recency signal available.
      const createdAt: string = effect.created_at ?? '';

      const existing = byContract.get(contractId);
      if (existing) {
        existing.effectCount++;
        existing.effectTypes[effect.type] = (existing.effectTypes[effect.type] ?? 0) + 1;
        if (createdAt && (!existing.lastActivity || createdAt > existing.lastActivity)) {
          existing.lastActivity = createdAt;
        }
      } else {
        byContract.set(contractId, {
          contractId,
          effectCount: 1,
          lastActivity: createdAt,
          effectTypes: { [effect.type]: 1 },
        });
      }
    }

    const nextHref: string | undefined = payload?._links?.next?.href;
    if (!nextHref) break;
    const match = nextHref.match(/cursor=([^&]+)/);
    cursor = match ? decodeURIComponent(match[1]) : '';
    if (!cursor) break;
  }

  const entry: CacheEntry = {
    expires: Date.now() + CACHE_TTL_MS,
    contracts: [...byContract.values()].sort((a, b) => b.effectCount - a.effectCount),
    scannedEffects: scanned,
  };
  cache.set(network, entry);
  return entry;
}

/**
 * GET /api/contracts
 * List contracts seen in the recent-effects window.
 * Optional ?q= filters by contract id substring.
 */
router.get('/contracts', async (req: Request, res: Response) => {
  const network = resolveNetwork(req);
  try {
    const entry = await scanContracts(network);
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toUpperCase() : '';

    const contracts = query
      ? entry.contracts.filter((c) => c.contractId.includes(query))
      : entry.contracts;

    res.json({
      network,
      query: query || null,
      total: contracts.length,
      contracts,
      window: {
        effectsScanned: entry.scannedEffects,
        pages: MAX_PAGES,
      },
      note:
        'Derived from recent effects. This Horizon build has no contract index, so results cover only the scanned window.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Contract search failed', { error: message, network });
    res.status(500).json({ error: 'Contract search failed', message });
  }
});

/**
 * GET /api/contracts/:contractId
 * Look up one contract. Reports whether it was observed in the scanned window.
 */
router.get('/contracts/:contractId', async (req: Request, res: Response) => {
  const network = resolveNetwork(req);
  const contractId = (req.params.contractId || '').trim().toUpperCase();

  if (!/^C[A-Z2-7]{55}$/.test(contractId)) {
    res.status(400).json({
      error: 'Invalid contract ID',
      message: 'A Stellar contract ID is a C followed by 55 base32 characters.',
    });
    return;
  }

  try {
    const entry = await scanContracts(network);
    const record = entry.contracts.find((c) => c.contractId === contractId);

    res.json({
      network,
      contractId,
      found: Boolean(record),
      contract: record ?? null,
      window: {
        effectsScanned: entry.scannedEffects,
      },
      note: record
        ? undefined
        : 'No activity for this contract inside the scanned effects window. It may still exist on-chain with no recent effects.',
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Contract lookup failed', { error: message, network, contractId });
    res.status(500).json({ error: 'Contract lookup failed', message });
  }
});

export { router as contractsRouter };
