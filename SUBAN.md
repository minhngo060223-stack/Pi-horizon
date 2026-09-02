# Suban Data Platform

A comprehensive data platform for the Pi Network, providing blockchain APIs, price feeds, and on-chain analytics.

**Website:** https://suban.org

## Architecture

```
                         Internet
                            │
                    ┌───────┴───────┐
                    │  Cloudflared  │
                    │    Tunnel     │
                    └───────┬───────┘
                            │
                    ┌───────┴───────┐
                    │    Caddy      │
                    │  (SSL/Proxy)  │
                    └───────┬───────┘
                            │
            ┌───────────────┼───────────────┐
            │               │               │
    ┌───────┴───────┐ ┌────┴────┐ ┌────────┴────────┐
    │   Suban API   │ │ Suban   │ │  Suban          │
    │   :4000       │ │ Oracle  │ │  Controller     │
    │               │ │ :3000   │ │  (Price+Chain)  │
    └───────┬───────┘ └────┬────┘ └────────┬────────┘
            │               │               │
            └───────┬───────┘               │
                    │                       │
            ┌───────┴───────┐       ┌───────┴───────┐
            │  Pi Mainnet   │       │  Exchanges    │
            │  Horizon      │       │  MEXC/CG/OKX  │
            │  :41401       │       │  Bitget       │
            └───────────────┘       └───────────────┘
```

## Services

| Service | Port | Domain | Description |
|---------|------|--------|-------------|
| **Pi Horizon (Mainnet)** | 41401 | horizon.suban.org | Mainnet Horizon REST API |
| **Pi Horizon (Testnet)** | 31401 | testnet.suban.org | Testnet Horizon REST API |
| **Pi RPC (Mainnet)** | 41403 | rpc.suban.org | Mainnet JSON-RPC (transactions, smart contracts) |
| **Pi RPC (Testnet)** | 31403 | testrpc.suban.org | Testnet JSON-RPC |
| **Suban Controller** | 3000 | oracle.suban.org | Price oracle (MEXC, CoinGecko, OKX, Bitget) + on-chain analytics |
| **Suban API** | 4000 | - | Horizon wrapper with caching, rate limiting, enhanced endpoints |
| **Caddy** | 80/443 | *.suban.org | Internal reverse proxy |
| **Cloudflared** | - | - | Cloudflare tunnel (exposes to internet) |

## Quick Start

### 1. Start Pi Node (required)
```bash
docker compose -f docker-compose.pi-mainnet-node.yml up -d
# Wait for core to sync, then:
docker exec pi-mainnet supervisorctl start horizon rpc
```

### 2. Start Suban Services
```bash
cd docker
docker compose -f docker-compose.suban.yml up -d
```

### 3. Verify
```bash
# Check all services
docker compose -f docker-compose.suban.yml ps

# Test API
curl http://localhost:4000/health

# Test Oracle
curl http://localhost:3000/api/v1/price

# Test Horizon proxy
curl http://localhost:4000/api/v1/summary
```

## API Endpoints

### Suban API (port 4000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | API index |
| `/health` | GET | Health check |
| `/api/v1/summary` | GET | Network summary (ledger, tx count) |
| `/api/v1/accounts/:id` | GET | Account details |
| `/api/v1/accounts/:id/transactions` | GET | Account transaction history |
| `/api/v1/transactions/:hash` | GET | Transaction by hash |
| `/api/v1/ledgers` | GET | Recent ledgers |
| `/api/v1/assets` | GET | Asset list |
| `/horizon/*` | ALL | Raw Horizon proxy (full API) |

### Suban Controller / Oracle (port 3000)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Service index |
| `/api/v1/price` | GET | Aggregated Pi price (MEXC, CoinGecko, OKX, Bitget) |
| `/api/v1/sources` | GET | Price source health/status |
| `/api/v1/health` | GET | Health check |
| `/api/v1/chain/stats` | GET | Network statistics |
| `/api/v1/chain/ledgers` | GET | Latest ledgers |
| `/api/v1/chain/accounts` | GET | Top accounts |
| `/api/v1/chain/accounts/:id` | GET | Account on-chain info |
| `/api/v1/chain/transactions` | GET | Recent transactions |
| `/data/pi-price` | GET | Pi price (piscan.io format) |
| `/data/mainnet-supply` | GET | Supply statistics |
| `/horizon/*` | ALL | Horizon proxy |

### Suban RPC (port 8000)

JSON-RPC 2.0 interface for smart contracts:

```bash
# Health check
curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

# Get latest ledger
curl -X POST http://localhost:8000/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'
```

**Note:** RPC uses POST requests only. Does not work in browsers.

## Domain Configuration

### Cloudflared Tunnel (Recommended)
```bash
# Set your tunnel token
export TUNNEL_TOKEN=your-cloudflare-token

# Run cloudflared
docker run -d --name cloudflared \
  --network docker_suban-net \
  -e TUNNEL_TOKEN=$TUNNEL_TOKEN \
  cloudflared:latest tunnel run
```

### DNS Records (Cloudflare)
Create CNAME records pointing to your tunnel:
- `api.suban.org` → `<tunnel-id>.cfargotunnel.com`
- `oracle.suban.org` → `<tunnel-id>.cfargotunnel.com`
- `rpc.suban.org` → `<tunnel-id>.cfargotunnel.com`
- `horizon.suban.org` → `<tunnel-id>.cfargotunnel.com`

### Direct Access (without Cloudflare)
If running without Cloudflare, Caddy handles automatic HTTPS:
```bash
# Edit docker/Caddyfile with your domain
# Then start:
docker compose -f docker-compose.suban.yml up -d
```

## Environment Variables

### Suban Controller (.env)
```bash
PORT=3000
NODE_ENV=production
NETWORK=mainnet
HORIZON_MAINNET_URL=http://pi-mainnet:8000
HORIZON_TESTNET_URL=http://localhost:31401
CACHE_TTL_SECONDS=10
CHAIN_DATA_CACHE_TTL=30
```

### Suban API (.env)
```bash
PORT=4000
NODE_ENV=production
HORIZON_URL=http://pi-mainnet:8000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
CACHE_TTL_SECONDS=5
```

## Price Sources

The Suban Controller aggregates Pi price from 4 exchanges:

| Exchange | Weight | API | Status |
|----------|--------|-----|--------|
| MEXC | 3.0x | `api.mexc.com` | Active |
| CoinGecko | 1.5x | `api.coingecko.com` | Active |
| OKX | 2.0x | `www.okx.com` | Active |
| Bitget | 2.0x | `api.bitget.com` | Active |

All sources are free (no API keys required). Total cost: $0/month.

## Development

### Build from source
```bash
# Suban API
cd Suban-api
npm install
npm run dev

# Suban Controller
cd suban-controller
pnpm install
pnpm dev

# Suban RPC
cd suban-rpc
make build
```

### Run with Docker
```bash
docker compose -f docker-compose.suban.yml up -d
docker compose -f docker-compose.suban.yml logs -f
```

## Project Structure

```
Pi-horizon/
├── Suban-api/              # Horizon API wrapper (Node.js)
├── suban-controller/       # Data oracle (Node.js)
├── suban-rpc/              # JSON-RPC server (Go+Rust)
├── docker/
│   ├── docker-compose.suban.yml   # Full Suban stack
│   ├── docker-compose.pi-mainnet-node.yml
│   ├── Caddyfile                  # Reverse proxy config
│   └── cloudflared/               # Cloudflare tunnel config
├── pi-rpc/                 # Original RPC (source for suban-rpc)
└── Zyrachain-oracle-nodejs/ # Original oracle (source for suban-controller)
```
