import NodeCache from 'node-cache';
import { config } from '../config';

export const cache = new NodeCache({
  stdTTL: config.cacheTTL,
  checkperiod: config.cacheTTL * 0.2,
});

export function getCached<T>(key: string): T | undefined {
  return cache.get<T>(key);
}

export function setCache(key: string, data: any, ttl?: number): void {
  cache.set(key, data, ttl || config.cacheTTL);
}
