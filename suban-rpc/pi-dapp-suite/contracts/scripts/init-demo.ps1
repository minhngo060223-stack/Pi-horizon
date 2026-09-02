param(
  [Parameter(Mandatory = $true)][string]$TokenContractId,
  [Parameter(Mandatory = $true)][string]$PoolContractId,
  [Parameter(Mandatory = $true)][string]$RouterContractId,
  [Parameter(Mandatory = $true)][string]$SubscriptionContractId,
  [Parameter(Mandatory = $true)][string]$AdminAddress,
  [string]$RpcUrl = "http://localhost:8000",
  [string]$NetworkPassphrase = "Pi Testnet"
)

$ErrorActionPreference = "Stop"

Write-Host "Initializing token..."
soroban contract invoke --id $TokenContractId --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase -- init --admin $AdminAddress --name DemoToken --symbol DMO --decimals 7

Write-Host "Initializing dex pool..."
soroban contract invoke --id $PoolContractId --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase -- init --admin $AdminAddress --token_a $TokenContractId --token_b $TokenContractId

Write-Host "Initializing dex router..."
soroban contract invoke --id $RouterContractId --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase -- init --admin $AdminAddress
soroban contract invoke --id $RouterContractId --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase -- register_pool --token_a $TokenContractId --token_b $TokenContractId --pool_contract $PoolContractId

Write-Host "Initializing subscription..."
soroban contract invoke --id $SubscriptionContractId --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase -- init --admin $AdminAddress
soroban contract invoke --id $SubscriptionContractId --source-account default --rpc-url $RpcUrl --network-passphrase $NetworkPassphrase -- create_plan --plan_id 1 --price 1000000 --period_ledgers 100 --receiver $AdminAddress

Write-Host "Demo init complete."

