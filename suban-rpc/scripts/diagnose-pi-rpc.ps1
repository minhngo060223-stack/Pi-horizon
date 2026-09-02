param(
  [string]$ComposeFile = "pi-dapp-suite/docker-compose.yml",
  [string]$Service = "pi-rpc",
  [int]$Tail = 250
)

$ErrorActionPreference = "Continue"

function Section($Name) {
  Write-Host ""
  Write-Host "==== $Name ===="
}

function Run($Title, [string[]]$Command) {
  Section $Title
  Write-Host ("> " + ($Command -join " "))
  & $Command[0] @($Command[1..($Command.Length - 1)])
}

if (!(Test-Path $ComposeFile)) {
  Write-Error "Compose file not found: $ComposeFile"
  Write-Host "Run this from the repo root, or pass -ComposeFile C:\path\to\pi-dapp-suite\docker-compose.yml"
  exit 1
}

$compose = @("docker", "compose", "-f", $ComposeFile)

Run "Compose Services" ($compose + @("ps"))

Section "Container ID"
$containerId = & docker compose -f $ComposeFile ps -q $Service
if (!$containerId) {
  Write-Error "No container found for service '$Service'. Is the compose project running?"
  exit 1
}
Write-Host $containerId

Run "Container Inspect" @(
  "docker", "inspect", $containerId,
  "--format", "Name={{.Name}} State={{.State.Status}} Health={{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} RestartCount={{.RestartCount}}"
)

Run "Recent Logs" ($compose + @("logs", "--tail=$Tail", $Service))

Run "Filtered Logs" ($compose + @("logs", "--tail=$Tail", $Service))
Section "Filtered Matches"
& docker compose -f $ComposeFile logs --tail=$Tail $Service |
  Select-String -Pattern "Ingesting ledger|could not run ingestion|Asking peers|Herder|SCP|peer|error|fatal|catchup|PrepareRange" -CaseSensitive:$false

Section "RPC getHealth"
$healthPayload = '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":{}}'
try {
  Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://localhost:8000/" -ContentType "application/json" -Body $healthPayload |
    Select-Object -ExpandProperty Content
} catch {
  Write-Host $_.Exception.Message
}

Section "Admin Metrics Latest Ledger"
try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:8001/metrics" |
    Select-Object -ExpandProperty Content |
    Select-String -Pattern "soroban_rpc_ingest_local_latest_ledger"
} catch {
  Write-Host $_.Exception.Message
}

Section "Inside Container: Host Gateway And Pi Node Port"
& docker exec $containerId sh -lc "echo host lookup:; getent hosts host.docker.internal || true; echo pi node tcp test:; (timeout 3 sh -c '</dev/tcp/host.docker.internal/31402' && echo OPEN) || echo CLOSED_OR_UNSUPPORTED; echo captive core info:; wget -qO- http://localhost:11626/info 2>/dev/null || curl -fsS http://localhost:11626/info || true"

Section "Inside Container: RPC DB Ledger Rows"
& docker exec $containerId sh -lc "if command -v sqlite3 >/dev/null 2>&1; then sqlite3 /data/pi-rpc.sqlite 'select count(*) as ledger_close_meta_rows from ledger_close_meta;'; else ls -lh /data; echo 'sqlite3 not installed in container'; fi"
