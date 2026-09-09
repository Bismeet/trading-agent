# scripts/stop-all.ps1 — Stops all FabRich services:
# 1. Tauric AI Decision Service (Python FastAPI, port 8000)
# 2. FabRich Trading Engine (Node.js)
# 3. FabRich Web Dashboard (Next.js, port 3000)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$DataDir = Join-Path $RootDir "data"
$ServicesFile = Join-Path $DataDir "services.json"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " Stopping FabRich Apex Trading Bot + Embedded Tauric AI " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 1. Stop saved PIDs from services.json if present
if (Test-Path $ServicesFile) {
    try {
        $services = Get-Content $ServicesFile | ConvertFrom-Json
        if ($services.aiPid) {
            Write-Host "Stopping Tauric AI Service (PID: $($services.aiPid))..." -ForegroundColor Yellow
            Stop-Process -Id $services.aiPid -Force -ErrorAction SilentlyContinue
        }
        if ($services.enginePid) {
            Write-Host "Stopping FabRich Engine (PID: $($services.enginePid))..." -ForegroundColor Yellow
            Stop-Process -Id $services.enginePid -Force -ErrorAction SilentlyContinue
        }
        if ($services.webPid) {
            Write-Host "Stopping Web Dashboard (PID: $($services.webPid))..." -ForegroundColor Yellow
            Stop-Process -Id $services.webPid -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Write-Warning "Could not parse ${ServicesFile}: $_"
    }
    Remove-Item $ServicesFile -Force -ErrorAction SilentlyContinue
}

# 2. Cleanup any processes holding port 8000 (FastAPI) or 3000 (Next.js)
$ports = @(8000, 3000)
foreach ($port in $ports) {
    $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        $pidToKill = $conn.OwningProcess
        if ($pidToKill -and $pidToKill -gt 0) {
            Write-Host "Freeing port $port held by PID $pidToKill..." -ForegroundColor Yellow
            Stop-Process -Id $pidToKill -Force -ErrorAction SilentlyContinue
        }
    }
}

# 3. Cleanup any lingering engine.mjs node processes
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*scripts/v2/engine.mjs*" } |
    ForEach-Object {
        Write-Host "Stopping lingering engine process (PID: $($_.ProcessId))..." -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

# 4. Cleanup any lingering ai/tauric/server.py python processes
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*ai/tauric/server.py*" } |
    ForEach-Object {
        Write-Host "Stopping lingering Tauric AI process (PID: $($_.ProcessId))..." -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }

Write-Host ""
Write-Host "All FabRich and Tauric AI services stopped cleanly." -ForegroundColor Green
