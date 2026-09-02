# Contracts (Soroban 21.x)

This workspace contains RPC-test-oriented contract scaffolds for Pi-compatible Soroban flows:

- `token`: minimal fungible token logic (init, mint, transfer, approve, transfer_from)
- `dex_pool`: constant-product pool state machine (add/remove liquidity, quote, swap)
- `dex_router`: pool registry and swap/quote forwarding to pools
- `subscription`: basic subscription plans and active-status checks

## Build

```bash
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
```

WASM artifacts are produced under each crate target path, for example:

- `token/target/wasm32-unknown-unknown/release/token.wasm`

## CLI recommendation

Pin Soroban CLI to protocol-21-era tooling:

```bash
cargo install --locked soroban-cli --version 21.2.0
```

## Deploy (PowerShell)

```powershell
.\scripts\deploy.ps1 -RpcUrl "http://localhost:8000" -NetworkPassphrase "Pi Testnet" -SecretKey "<your-secret>"
```

If you see errors like `DB is empty`, the RPC node is not fully initialized yet (history catchup/ingestion). Wait until `getHealth` is ready before deploying/invoking contracts.

Then initialize demo state:

```powershell
.\scripts\init-demo.ps1 `
  -TokenContractId "<token_id>" `
  -PoolContractId "<pool_id>" `
  -RouterContractId "<router_id>" `
  -SubscriptionContractId "<subscription_id>" `
  -AdminAddress "<G...>" `
  -RpcUrl "http://localhost:8000" `
  -NetworkPassphrase "Pi Testnet"
```
