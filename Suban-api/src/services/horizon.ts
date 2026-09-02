import axios from 'axios';
import { config } from '../config';
import { logger } from '../utils/logger';

const client = axios.create({
  baseURL: config.horizonUrl,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
});

export async function proxyToHorizon(path: string, method: string = 'GET', params?: any, body?: any): Promise<any> {
  try {
    const response = await client({
      method: method.toLowerCase() as any,
      url: path,
      params,
      data: body,
    });
    return response.data;
  } catch (error: any) {
    const status = error.response?.status || 500;
    const message = error.response?.data || error.message;
    logger.error('Horizon proxy error', { path, status, message });
    throw { status, message };
  }
}
