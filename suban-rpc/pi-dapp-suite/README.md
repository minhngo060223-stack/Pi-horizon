# Pi Dapp Suite (Soroban v21–23) — RPC Test + DEX Playground

Standalone repo folder that connects to **Pi RPC** (`PI_RPC_URL`, default `http://localhost:8000`) and provides:

- **Public frontend**: create wallet, fund via faucet, run RPC smoke tests, tokens, swaps, liquidity, subscriptions.
- **Backend faucet**: holds the faucet secret server-side and funds new accounts.
- **Soroban contracts** (protocol 21-era SDK): token, DEX pool+router, subscription service.

> Security: the faucet secret **must never** be exposed to the browser. It is only used by the backend.

## Prereqs

- Node.js 20+
- `pnpm` (recommended via Corepack: `corepack enable`)
- A running `pi-rpc` reachable at `http://localhost:8000` (or set `PI_RPC_URL`)

## Quickstart (no Docker)

From `pi-dapp-suite/`:

```powershell
corepack enable
pnpm install
copy .env.example .env
copy apps/web/.env.example apps/web/.env
pnpm run dev
```

Open:

- Web app: `http://localhost:5173`
- Faucet API: `http://localhost:4000/health`

## Docker (default: faucet + web only)

By default, this Compose stack starts only the **faucet backend** and **web UI**. It assumes **Pi RPC is already running separately** and reachable on the host at `http://localhost:8000`.

This avoids trying to start a second `pi-rpc` container and avoids port conflicts on `8000`.

### 1) Environment file for the faucet service

From `pi-dapp-suite/`:

```powershell
copy .env.example .env
```

Fill in:

```env
NETWORK_PASSPHRASE=Pi Testnet
FAUCET_PUBLIC=G...
FAUCET_SECRET=S...
ADMIN_TOKEN=change-me-to-a-long-random-string
```

The default `docker-compose.yml` overrides the faucet container RPC URL to:

```env
PI_RPC_URL=http://host.docker.internal:8000
```

because `localhost` inside the faucet container is the faucet container itself. If your RPC is somewhere else, set:

```powershell
$env:DOCKER_FAUCET_RPC_URL="http://your-rpc-host:8000"
docker compose up -d --build
```

### 2) Start faucet + web

Still in `pi-dapp-suite/`:

```powershell
docker compose up -d --build
```

This starts:

- `faucet` on `http://localhost:4000`
- `web` on `http://localhost:5173`

It does **not** start `pi-rpc` unless you explicitly enable the `rpc` profile.

Open the same URLs as in [Quickstart (no Docker)](#quickstart-no-docker):

- Web: `http://localhost:5173` (`VITE_*` URLs in compose target your host’s published ports)
- Faucet: `http://localhost:4000/health`

Contract state files `./.contracts-state.json` and `./.contracts.env` are bind-mounted so IDs persist across restarts.

### Notes

- **Browser vs backend**: The web container sets `VITE_PI_RPC_URL` and `VITE_FAUCET_URL` to `http://localhost:8000` and `http://localhost:4000` because the browser runs on your machine; the faucet container uses `http://host.docker.internal:8000` by default to reach the already-running host RPC.

## Docker (optional full stack with bundled RPC)

The `pi-rpc` service remains in `docker-compose.yml`, but it is behind the explicit `rpc` profile. Use it only if you want this Compose project to run RPC too.

First build the RPC image from the repository root (`pi-rpc/`):

```powershell
docker build -t pi-rpc:local -f cmd/stellar-rpc/docker/Dockerfile .
```

Then from `pi-dapp-suite/`:

```powershell
$env:DOCKER_FAUCET_RPC_URL="http://pi-rpc:8000"
docker compose --profile rpc up -d --build
```

Do not use the `rpc` profile if another RPC process/container already owns host port `8000`.

## Docker (legacy split stack file)

If you prefer managing RPC separately (recommended while debugging “DB is empty”), run `pi-rpc` from the repo root and run only faucet+web from this folder.

### 1) Start RPC standalone (repo root)

From the repo root (`pi-rpc/`):

```powershell
docker run -d --name pi-rpc `
  --network pi-net `
  -p 8000:8000 -p 8001:8001 `
  -v "${PWD}/config.pi.toml:/app/config.pi.toml:ro" `
  -v "${PWD}/pi-core.cfg:/app/pi-core.cfg:ro" `
  -v pi_rpc_db:/data `
  -v pi_captive_core:/captive-core `
  pi-rpc:local --config-path /app/config.pi.toml
```

### 2) Start the app stack (this folder)

From `pi-dapp-suite/`:

```powershell
docker compose -f docker-compose.app.yml up -d --build
```

This compose file points the faucet container at `http://host.docker.internal:8000` while keeping the browser URL at `http://localhost:8000`.

## Configure

Copy the example env files and fill in values:

```powershell
copy .env.example .env
copy apps/web/.env.example apps/web/.env
```

Required:

- `PI_RPC_URL` (example `http://localhost:8000`)
- `NETWORK_PASSPHRASE` (`Pi Testnet`)
- `FAUCET_SECRET` (server-side only)
- `FAUCET_PUBLIC`
- `ADMIN_TOKEN` (recommended; required for backend deploy/invoke endpoints)
- `FAUCET_MAX_FEE_STROOPS` (optional; default `1000000`, raise if funding returns `TRY_AGAIN_LATER`)

## Notes

- The frontend only talks to the **faucet backend**; it never receives `FAUCET_SECRET`.
- `pnpm run dev` starts both the faucet backend (port 4000) and the web app (port 5173).
- If `PI_RPC_URL` points to a remote machine, update both `.env` and `apps/web/.env` and restart `pnpm run dev`.

### Web UI persistence (dev only)

The web app saves **wallet secret**, **admin token**, and **contract ID fields** to `localStorage` so a refresh does not wipe your session. This is convenient for local testing and **unsafe for production** (any XSS or shared browser profile can read secrets).

On load it also calls **`GET /contracts/state`** on the faucet so deployed contract IDs from `.contracts-state.json` merge into the UI (server values win when present).

Optional: set **`VITE_ADMIN_TOKEN`** in `apps/web/.env` to match **`ADMIN_TOKEN`** in the faucet `.env` — the value is baked into the frontend bundle; use only on trusted dev machines.

### Faucet classic fees

`/faucet/fund` chooses the transaction **max fee** from Soroban RPC **`getFeeStats().inclusionFee`** (classic inclusion distribution), applies a large safety margin, and falls back to `FAUCET_MAX_FEE_STROOPS` (default `1000000`) if stats are unavailable — this avoids low-fee `TRY_AGAIN_LATER` / `txInsufficientFee` responses when the network’s bid is higher than the legacy `100` stroop floor.

If the destination account **already exists**, the faucet sends a **native payment** instead of `createAccount`.

## Contracts scaffold

Contract workspace is in `contracts/` and includes:

- `token`
- `dex_pool`
- `dex_router`
- `subscription`

Build contracts:

```powershell
cd contracts
cargo build --target wasm32-unknown-unknown --release
```

Deploy helper scripts:

- `contracts/scripts/deploy.ps1`
- `contracts/scripts/init-demo.ps1`

These are scaffold contracts for local RPC and flow testing (not production-audited DEX/token code).

## Deploy and use contracts from the UI

1) Set `ADMIN_TOKEN` in `.env` and restart the faucet backend.
2) In the web UI “Contracts (Soroban)” section:
   - paste the same token into “Admin token” (or use `VITE_ADMIN_TOKEN` in `apps/web/.env`)
   - click **Deploy all (backend)** — the Docker faucet image builds contracts and includes the pinned `soroban` CLI
   - contract IDs are saved server-side; the UI also **auto-loads** them on refresh via `/contracts/state`
3) Use the buttons to call `subscribe`, `is_active`, pool liquidity, and basic token balance.

**Docker:** the faucet image installs `soroban-cli` `21.2.0` and builds the contract WASM artifacts during image build, so deploy-from-UI is available from the container.

## Troubleshooting

| Symptom | Likely cause |
|--------|----------------|
| `txInsufficientFee` from faucet | Older fee floor; current server uses dynamic inclusion fees — restart faucet after updating. |
| `503 soroban CLI unavailable` | Rebuild the faucet image; the Dockerfile now installs pinned `soroban-cli` and copies it into the runtime image. |
| `401 Unauthorized` on deploy | `x-admin-token` must exactly match `ADMIN_TOKEN` in faucet `.env`. |
| `latency (...) since last known ledger closed is too high` from `getHealth` | RPC ingestion / captive-core lag or clock skew — same as core pi-rpc troubleshooting (peers, catchup). |
| Wallet / IDs missing after refresh | Ensure browser storage is enabled; check faucet `/contracts/state` returns your `.contracts-state.json` data. |
