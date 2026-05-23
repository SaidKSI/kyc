<#
.SYNOPSIS
  Start all KYC dev servers. Logs output to files. Ctrl+C stops everything.

  Logs:
    backend/api.log     — FastAPI (uvicorn)
    backend/worker.log  — Celery worker
    frontend/dev.log    — Next.js

  Tail a log in another terminal:
    Get-Content backend\api.log -Wait
#>

$root = $PSScriptRoot

$apiLog    = "$root\backend\logs\api.log"
$workerLog = "$root\backend\logs\worker.log"
$webLog    = "$root\frontend\logs\dev.log"

# Ensure log directories exist
New-Item -ItemType Directory -Force -Path "$root\backend\logs"  | Out-Null
New-Item -ItemType Directory -Force -Path "$root\frontend\logs" | Out-Null

# Clear all log files
Remove-Item $apiLog, $workerLog, $webLog -Force -ErrorAction SilentlyContinue

# Kill any existing processes on ports 8000, 3000, and cleanup stale processes
Write-Host ""
Write-Host "  Checking for existing servers..." -ForegroundColor Gray

$ports = @(8000, 3000)
foreach ($port in $ports) {
    $procs = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
             Where-Object { $_.State -eq "Listen" }

    if ($procs) {
        foreach ($proc in $procs) {
            $pid = $proc.OwningProcess
            $name = (Get-Process -Id $pid -ErrorAction SilentlyContinue).Name
            Write-Host "  [INFO] Port $port already in use (PID $pid, $name). Killing..." -ForegroundColor Yellow
            taskkill /F /T /PID $pid 2>&1 | Out-Null
            Start-Sleep -Milliseconds 500
        }
    }
}

# Kill any lingering uvicorn/celery/node processes
$staleProcs = Get-Process -Name "uvicorn", "celery", "node" -ErrorAction SilentlyContinue
if ($staleProcs) {
    Write-Host "  [INFO] Found stale processes, cleaning up..." -ForegroundColor Yellow
    $staleProcs | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

# Overwrite logs with a fresh header each run
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$stamp] === KYC API server starting ===" | Out-File $apiLog    -Encoding utf8 -Force
"[$stamp] === KYC Celery worker starting ===" | Out-File $workerLog -Encoding utf8 -Force
"[$stamp] === KYC Frontend starting ===" | Out-File $webLog    -Encoding utf8 -Force

Write-Host ""
Write-Host "  KYC Dev Servers" -ForegroundColor Cyan
Write-Host "  ───────────────────────────────────" -ForegroundColor DarkGray

# FastAPI — uvicorn
$api = Start-Process "cmd.exe" -PassThru -WindowStyle Hidden -ArgumentList @(
    "/c",
    "cd /d `"$root\backend`" && set PYTHONUNBUFFERED=1 && `".venv\Scripts\uvicorn.exe`" main:app --reload --port 8000 >> `"$apiLog`" 2>&1"
)

# Celery worker
$worker = Start-Process "cmd.exe" -PassThru -WindowStyle Hidden -ArgumentList @(
    "/c",
    "cd /d `"$root\backend`" && set PYTHONUNBUFFERED=1 && `".venv\Scripts\celery.exe`" -A workers.celery_app worker --loglevel=info --concurrency=2 --pool=solo >> `"$workerLog`" 2>&1"
)

# Next.js frontend
$web = Start-Process "cmd.exe" -PassThru -WindowStyle Hidden -ArgumentList @(
    "/c",
    "cd /d `"$root\frontend`" && npm run dev >> `"$webLog`" 2>&1"
)

Write-Host ""
Write-Host "  [api]    http://localhost:8000   →  backend\logs\api.log" -ForegroundColor Blue
Write-Host "  [docs]   http://localhost:8000/docs" -ForegroundColor DarkBlue
Write-Host "  [worker] (background)            →  backend\logs\worker.log" -ForegroundColor Yellow
Write-Host "  [web]    http://localhost:3000   →  frontend\logs\dev.log" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Tail logs:  Get-Content backend\logs\api.log -Wait" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Press Ctrl+C to stop all servers." -ForegroundColor DarkGray
Write-Host ""

$procIds = @($api.Id, $worker.Id, $web.Id)

try {
    while ($true) {
        Start-Sleep -Seconds 5

        $labels = @("api", "worker", "web")
        $procs  = @($api, $worker, $web)
        for ($i = 0; $i -lt $procs.Count; $i++) {
            $p = $procs[$i]
            # Refresh exit status
            $p.Refresh()
            if ($p.HasExited) {
                Write-Host "  [WARN] $($labels[$i]) exited (code $($p.ExitCode)). Check log." -ForegroundColor Red
            }
        }
    }
} finally {
    Write-Host ""
    Write-Host "  Stopping all servers..." -ForegroundColor Yellow
    foreach ($id in $procIds) {
        # /T kills the whole process tree (cmd + child uvicorn/celery/node)
        & taskkill /F /T /PID $id 2>&1 | Out-Null
    }
    Write-Host "  Done." -ForegroundColor Green
    Write-Host ""
}
