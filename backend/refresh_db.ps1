<#
.SYNOPSIS
  Refresh the database: drop, recreate, migrate, and seed.

.USAGE
  .\refresh_db.ps1
#>

$root = $PSScriptRoot

Write-Host ""
Write-Host "  DB Refresh" -ForegroundColor Cyan
Write-Host "  ───────────────────────────────" -ForegroundColor DarkGray

# 1. Terminate existing connections
Write-Host ""
Write-Host "  [1/4] Terminating database connections..." -ForegroundColor Yellow
psql -U postgres -h localhost -c "SELECT pg_terminate_backend(pg_stat_activity.pid) FROM pg_stat_activity WHERE pg_stat_activity.datname = 'kyc' AND pid <> pg_backend_pid();" 2>&1 | Out-Null

# 2. Drop and recreate database
Write-Host "  [2/4] Dropping and recreating kyc database..." -ForegroundColor Yellow
psql -U postgres -h localhost -c "DROP DATABASE IF EXISTS kyc;" -c "CREATE DATABASE kyc;" 2>&1 | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Database recreated" -ForegroundColor Green
} else {
    Write-Host "  ✗ Failed to recreate database" -ForegroundColor Red
    exit 1
}

# 3. Activate venv and run migrations
Write-Host "  [3/4] Running migrations..." -ForegroundColor Yellow
& "$root\.venv\Scripts\activate.ps1"
alembic upgrade head
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Migrations applied" -ForegroundColor Green
} else {
    Write-Host "  ✗ Migrations failed" -ForegroundColor Red
    exit 1
}

# 4. Seed database
Write-Host "  [4/4] Seeding database..." -ForegroundColor Yellow
python seeds/run_seeds.py
if ($LASTEXITCODE -eq 0) {
    Write-Host "  ✓ Database seeded" -ForegroundColor Green
} else {
    Write-Host "  ✗ Seeding failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  ✓ DB refresh complete" -ForegroundColor Green
Write-Host ""
