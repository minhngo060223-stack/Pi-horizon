param(
  [string]$RpcUrl = "http://localhost:8000",
  [string]$NetworkPassphrase = "Pi Testnet",
  [Parameter(Mandatory = $true)][string]$SecretKey
)

$ErrorActionPreference = "Stop"

Write-Host "Building contracts..."
cargo build --target wasm32-unknown-unknown --release

$env:SOROBAN_RPC_URL = $RpcUrl
$env:SOROBAN_NETWORK_PASSPHRASE = $NetworkPassphrase
$env:SOROBAN_SECRET_KEY = $SecretKey

$tokenWasm = "token/target/wasm32-unknown-unknown/release/token.wasm"
$poolWasm = "dex_pool/target/wasm32-unknown-unknown/release/dex_pool.wasm"
$routerWasm = "dex_router/target/wasm32-unknown-unknown/release/dex_router.wasm"
$subWasm = "subscription/target/wasm32-unknown-unknown/release/subscription.wasm"

Write-Host "Deploying token..."
$tokenId = soroban contract deploy --wasm $tokenWasm --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase
Write-Host "TOKEN_CONTRACT_ID=$tokenId"

Write-Host "Deploying dex_pool..."
$poolId = soroban contract deploy --wasm $poolWasm --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase
Write-Host "DEX_POOL_CONTRACT_ID=$poolId"

Write-Host "Deploying dex_router..."
$routerId = soroban contract deploy --wasm $routerWasm --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase
Write-Host "DEX_ROUTER_CONTRACT_ID=$routerId"

Write-Host "Deploying subscription..."
$subId = soroban contract deploy --wasm $subWasm --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase
Write-Host "SUBSCRIPTION_CONTRACT_ID=$subId"

