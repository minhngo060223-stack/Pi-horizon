# Suban Data Platform

A comprehensive data platform for the Pi Network, providing blockchain APIs, price feeds, on-chain analytics, and **cross-chain PUSD stablecoin bridging** to Arc (Circle's EVM L1).

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
    │   Suban API   │ │ Suban   │ │  Bridge         │
    │   :4000       │ │ Oracle  │ │  Relayer        │
    │               │ │ :3000   │ │  (Stellar↔Arc)  │
    └───────┬───────┘ └────┬────┘ └────────┬────────┘
            │               │               │
            └───────┬───────┘               │
                    │                       │
            ┌───────┴───────┐       ┌───────┴───────┐
            │  Pi Network   │       │  Arc (EVM)    │
            │  Horizon      │       │  PUSD Token   │
            │  :41401       │       │  ArcBridge    │
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
| **Bridge Relayer** | - | - | Cross-chain PUSD bridge (Stellar ↔ Arc) |
| **Event Indexer** | 3002 | - | On-chain event indexer (SQLite + HTTP API) |
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

# Test Bridge Relayer
docker logs suban-bridge-relayer --tail 50
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

## Cross-Chain PUSD Bridge

### Overview

PUSD is a USD-pegged stablecoin bridged between Pi Network (Stellar) and Arc (Circle's EVM L1).

### Deployed Contracts

| Chain | Contract | Address |
|-------|----------|---------|
| **Pi Testnet** | Bridge Burn-Mint v2 | `CAM33E3NNPHO5OGNU6YVMUJYIVFLHDCRB7P3IXET4EDZHYVYM2JAX54S` |
| **Pi Testnet** | PUSD Token | `CAPDFYOFXSQTVCZ7KPUACHVNMOO3TWLSLHTPQ3H64EBJVRFMAWIBEUAY` |
| **Arc Testnet** | ArcBridge | `0x765c4AdF71CFA7f1e9F6358Ca25A8216DC70B409` |
| **Arc Testnet** | PUSDToken (ERC-20) | `0x7534400f6F725326D5668d85d76b7bA0029aFEd8` |

### Bridge Flow (E2E Verified)

```
User (Pi Testnet)                    Relayer                    Arc Testnet
      │                                │                           │
      │── burn_pusd(100 PUSD) ────────>│                           │
      │   (PUSD locked in bridge)      │                           │
      │                                │── Detect burn event ─────>│
      │                                │── Calculate 1% fee ──────>│
      │                                │── Sign cross-chain msg ──>│
      │                                │── mintPusd(99 PUSD) ─────>│
      │                                │   ✓ TX confirmed!        │
      │<──── 99 PUSD on Arc ──────────│                           │
```

**Verified TX:** `0x305e6f4881956134cecbce76f174d29f900f1a1e78e5e037e6753527b3cd4e4d`

### Configuration

```bash
# Bridge fee: 1% (90% relayer / 10% protocol)
# Minimum fee: 1 PUSD
# Circuit breaker: 1,000,000 PUSD per window
# Polling: Stellar 5s, Arc 2s
```

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
- `suban.org` → `<tunnel-id>.cfargotunnel.com`
- `www.suban.org` → `<tunnel-id>.cfargotunnel.com`
- `rpc.suban.org` → `<tunnel-id>.cfargotunnel.com`
- `testnet.suban.org` → `<tunnel-id>.cfargotunnel.com`
- `testrpc.suban.org` → `<tunnel-id>.cfargotunnel.com`
- `oracle.suban.org` → `<tunnel-id>.cfargotunnel.com`
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

### Bridge Relayer (.env)
```bash
# Stellar/Pi Testnet
STELLAR_RPC_URL=https://rpc.testnet.minepi.com
STELLAR_HORIZON_URL=https://api.testnet.minepi.com
STELLAR_NETWORK_PASSPHRASE=Pi Testnet
STELLAR_BRIDGE_CONTRACT=CAM33E3NNPHO5OGNU6YVMUJYIVFLHDCRB7P3IXET4EDZHYVYM2JAX54S
STELLAR_PUSD_TOKEN=CAPDFYOFXSQTVCZ7KPUACHVNMOO3TWLSLHTPQ3H64EBJVRFMAWIBEUAY

# Arc Testnet
ARC_RPC_URL=https://rpc.testnet.arc.io
ARC_CHAIN_ID=5042002
ARC_BRIDGE_CONTRACT=0x765c4AdF71CFA7f1e9F6358Ca25A8216DC70B409
ARC_PUSD_TOKEN=0x7534400f6F725326D5668d85d76b7bA0029aFEd8

# Fee Configuration
BRIDGE_FEE_PERCENTAGE=0.5
BRIDGE_MINIMUM_FEE=1
BRIDGE_PROTOCOL_SHARE=0.1

# Circuit Breaker
CIRCUIT_BREAKER_MAX_VOLUME=1000000
CIRCUIT_BREAKER_AUTO_PAUSE=true

# Polling Intervals (ms)
STELLAR_POLL_INTERVAL=5000
ARC_POLL_INTERVAL=2000
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
├── Suban/                  # Smart contracts + relayer (submodule)
│   ├── contracts/
│   │   ├── arc-bridge/     # Arc/EVM contracts (Solidity)
│   │   ├── bridge-burn-mint/  # Stellar bridge (Rust/Soroban)
│   │   ├── pusd-token/     # PUSD stablecoin
│   │   ├── wpi-token/      # Wrapped Pi
│   │   └── ...             # 20+ more contracts
│   └── services/
│       ├── bridge-relayer/ # Cross-chain bridge relayer
│       └── event-indexer/  # On-chain event indexer
├── docker/
│   ├── docker-compose.suban.yml   # Full Suban stack
│   ├── docker-compose.pi-mainnet-node.yml
│   ├── Caddyfile                  # Reverse proxy config
│   └── cloudflared/               # Cloudflare tunnel config
├── docs/
│   ├── PROJECT-REPORT.md    # Comprehensive project report
│   └── API-REFERENCE.md     # API documentation
├── pi-rpc/                 # Original RPC (source for suban-rpc)
└── Zyrachain-oracle-nodejs/ # Original oracle (source for suban-controller)
```

## Documentation

| Document | Description |
|----------|-------------|
| [PROJECT-REPORT.md](docs/PROJECT-REPORT.md) | Comprehensive project report |
| [API-REFERENCE.md](docs/API-REFERENCE.md) | Complete API documentation |
| [SUBAN.md](SUBAN.md) | This file - Architecture overview |
| [DEVELOPER.md](Suban/docs/DEVELOPER.md) | Suban protocol developer docs |
| [PHASE2-BRIDGE-DESIGN.md](Suban/docs/PHASE2-BRIDGE-DESIGN.md) | Bridge architecture design |
| [INCIDENT-RUNBOOK.md](Suban/docs/INCIDENT-RUNBOOK.md) | Incident response procedures |
| [AUDIT-PROGRAM.md](Suban/docs/AUDIT-PROGRAM.md) | Security audit program |

## License

MIT
