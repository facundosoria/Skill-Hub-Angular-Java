#!/usr/bin/env pwsh
# Isolated local smoke for the infra monitoring feature.
#
# Brings up a dedicated compose project (skillhub-infra-local) with its own DB
# volume and loopback ports, drives a fake Eureka/actuator source through
# UP -> failure -> recovery and checks the public API:
#   * unauthenticated /api/infra/state is rejected
#   * session login works (first registered user is admin)
#   * authenticated /api/infra/state lists the expected services and reflects state
#   * the existing catalogue read (/api/skills) still works
#
# It never touches the normal stack (localhost:8087), never uses production
# secrets and tears down only its own project. Pass -Keep to leave it running.
param(
  [switch]$Keep
)
$ErrorActionPreference = 'Stop'

$project = 'skillhub-infra-local'
$webUrl = 'http://localhost:18089'
$fixtureUrl = 'http://localhost:18090'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $env:TEMP ("skillhub-infra-smoke-" + [guid]::NewGuid().ToString('N') + ".env")

function New-Hex([int]$bytes) {
  -join (1..$bytes | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
}

function Write-Step($message) { Write-Host "==> $message" }

function Wait-For([scriptblock]$probe, [int]$timeoutSeconds, [string]$what) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try { if (& $probe) { return $true } } catch { }
    Start-Sleep -Seconds 3
  }
  throw "Timed out waiting for $what"
}

$compose = @(
  'docker', 'compose', '-p', $project,
  '--env-file', $envFile,
  '-f', (Join-Path $root 'docker-compose.yml'),
  '-f', (Join-Path $root 'docker-compose.infra-smoke.yml')
)

function Invoke-Compose([string[]]$ComposeArgs) {
  $full = $compose + $ComposeArgs
  & $full[0] $full[1..($full.Length - 1)]
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed ($LASTEXITCODE)" }
}

try {
  Write-Step "Checking Docker"
  docker info --format '{{.ServerVersion}}' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Docker engine is not available' }

  Write-Step "Writing ephemeral env (random secrets, no production values)"
  @(
    'POSTGRES_USER=skillhub',
    'POSTGRES_DB=skillhub',
    "POSTGRES_PASSWORD=$(New-Hex 18)",
    "SESSION_SECRET=$(New-Hex 40)",
    "HYDRA_DB_PASSWORD=$(New-Hex 24)",
    "HYDRA_SYSTEM_SECRET=$(New-Hex 32)",
    "PUBLIC_BASE_URL=$webUrl",
    'COOKIE_SECURE=false',
    'HYDRA_DEV_MODE=auto',
    'WEB_PORT=18089',
    'PGDATA_VOLUME_NAME=skillhub-infra-local-pgdata'
  ) | Set-Content -LiteralPath $envFile -Encoding ascii

  Write-Step "Building and starting $project (ports 18089 web, 15433 db, 18445 hydra, 18090 fixture)"
  Invoke-Compose @('up', '-d', '--build')

  Write-Step 'Waiting for the web/API to become healthy'
  Wait-For { (Invoke-WebRequest -Uri "$webUrl/api/health" -SkipHttpErrorCheck).StatusCode -eq 200 } 420 'web health'

  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

  Write-Step 'Unauthenticated /api/infra/state must be rejected'
  $unauth = Invoke-WebRequest -Uri "$webUrl/api/infra/state" -SkipHttpErrorCheck
  if ($unauth.StatusCode -ne 401) { throw "expected 401, got $($unauth.StatusCode)" }

  Write-Step 'Registering the first user (becomes admin) and logging in'
  $register = Invoke-RestMethod -Method Post -Uri "$webUrl/api/auth/register" -WebSession $session `
    -ContentType 'application/json' `
    -Body (@{ username = 'smokeadmin'; password = 'unlargopassword'; team = 'Backoffice' } | ConvertTo-Json)
  if (-not $register.user) { throw 'registration did not return a user' }

  Write-Step 'Authenticated /api/infra/state lists the expected services'
  $state = Invoke-RestMethod -Method Get -Uri "$webUrl/api/infra/state" -WebSession $session
  if (-not $state.enabled) { throw 'infra monitoring is not enabled in the smoke stack' }
  $names = @($state.services | ForEach-Object { $_.name })
  foreach ($expected in @('users-service', 'api-gateway', 'llm-service', 'sandbox-service')) {
    if ($names -notcontains $expected) { throw "expected service missing: $expected" }
  }

  Write-Step 'Existing catalogue read still works'
  $skills = Invoke-WebRequest -Uri "$webUrl/api/skills" -WebSession $session -SkipHttpErrorCheck
  if ($skills.StatusCode -ne 200) { throw "GET /api/skills returned $($skills.StatusCode)" }

  function Get-ServiceState([string]$name) {
    $s = Invoke-RestMethod -Method Get -Uri "$webUrl/api/infra/state" -WebSession $session
    ($s.services | Where-Object { $_.name -eq $name } | Select-Object -First 1).state
  }

  Write-Step 'Fixture UP -> users-service should reach UP'
  Invoke-RestMethod -Uri "$fixtureUrl/_control?mode=up" | Out-Null
  Wait-For { (Get-ServiceState 'users-service') -eq 'UP' } 90 'users-service UP'
  Write-Host '    users-service = UP'

  Write-Step 'Fixture failure -> users-service should reach DOWN (threshold 2)'
  Invoke-RestMethod -Uri "$fixtureUrl/_control?mode=down" | Out-Null
  Wait-For { (Get-ServiceState 'users-service') -eq 'DOWN' } 120 'users-service DOWN'
  Write-Host '    users-service = DOWN'

  Write-Step 'Fixture recovery -> users-service should return to UP'
  Invoke-RestMethod -Uri "$fixtureUrl/_control?mode=up" | Out-Null
  Wait-For { (Get-ServiceState 'users-service') -eq 'UP' } 90 'users-service recovery'

  Write-Host ''
  Write-Host 'SMOKE PASS'
  Write-Host "  project : $project"
  Write-Host "  web     : $webUrl"
  Write-Host "  fixture : $fixtureUrl"
  Write-Host "  cleanup : docker compose -p $project down -v"
}
finally {
  if (-not $Keep) {
    Write-Step "Tearing down only the $project project"
    $full = $compose + @('down', '-v')
    & $full[0] $full[1..($full.Length - 1)] 2>$null | Out-Null
  } else {
    Write-Host "Leaving $project running; clean up with: docker compose -p $project down -v"
  }
  if (Test-Path -LiteralPath $envFile) { Remove-Item -LiteralPath $envFile -Force }
}
