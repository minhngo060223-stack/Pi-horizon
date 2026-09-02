# Suban API

Horizon API wrapper for Pi Network with caching, rate limiting, and enhanced endpoints.

Part of the [Suban Data Platform](https://suban.org).

## Features

- **Caching** — responses cached for configurable TTL (default 5s)
- **Rate limiting** — per-IP request limits (default 100/min)
- **Enhanced endpoints** — summary, account history, asset lookup
- **Full Horizon proxy** — `/horizon/*` forwards to local Horizon node

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /` | API index |
| `GET /health` | Health check |
| `GET /api/v1/summary` | Network summary |
| `GET /api/v1/accounts/:id` | Account details |
| `GET /api/v1/accounts/:id/transactions` | Account transactions |
| `GET /api/v1/transactions/:hash` | Transaction by hash |
| `GET /api/v1/ledgers` | Recent ledgers |
| `GET /api/v1/assets` | Asset list |
| `ALL /horizon/*` | Raw Horizon proxy |

## Docker

```bash
docker build -t suban-api .
docker run -p 4000:4000 suban-api
```
