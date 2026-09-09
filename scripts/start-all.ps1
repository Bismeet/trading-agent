# scripts/start-all.ps1 — Starts all FabRich services locally:
# 1. Tauric AI Decision Service (Python FastAPI, port 8000)
# 2. FabRich Trading Engine (Node.js 30s cycle)
# 3. FabRich Web Dashboard (Next.js, port 3000)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

Set-Location $RootDir

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " Starting FabRich Apex Trading Bot + Embedded Tauric AI " -ForegroundColor Cyan
Write-Host "=======================================================" -ForegroundColor Cyan

# 1. Start Tauric AI Service (FastAPI)
$PythonPath = Join-Path $RootDir ".venv\Scripts\python.exe"
if (-not (Test-Path $PythonPath)) {
    $PythonPath = "python"
}

$LogDir = Join-Path $RootDir "logs"
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir | Out-Null }

Write-Host "[1/3] Starting Tauric AI Decision Service on http://127.0.0.1:8000..." -ForegroundColor Green
$aiProc = Start-Process -FilePath $PythonPath `
    -ArgumentList "ai/tauric/server.py" `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput (Join-Path $LogDir "ai.log") `
    -RedirectStandardError (Join-Path $LogDir "ai_err.log") `
    -PassThru

# 2. Start FabRich Engine
Write-Host "[2/3] Starting FabRich Trading Engine..." -ForegroundColor Green
$engineProc = Start-Process -FilePath "node" `
    -ArgumentList "scripts/v2/engine.mjs" `
    -WorkingDirectory $RootDir `
    -RedirectStandardOutput (Join-Path $LogDir "engine.log") `
    -RedirectStandardError (Join-Path $LogDir "engine_err.log") `
    -PassThru

# 3. Start Next.js Frontend
Write-Host "[3/3] Starting FabRich Next.js Web Dashboard on http://localhost:3000..." -ForegroundColor Green
$webDir = Join-Path $RootDir "web"
$webProc = Start-Process -FilePath "npm.cmd" `
    -ArgumentList "run dev" `
    -WorkingDirectory $webDir `
    -RedirectStandardOutput (Join-Path $LogDir "web.log") `
    -RedirectStandardError (Join-Path $LogDir "web_err.log") `
    -PassThru

# Save PIDs to data/services.json for clean stop
$PidsObj = @{
    aiPid = $aiProc.Id
    enginePid = $engineProc.Id
    webPid = $webProc.Id
    startedAt = (Get-Date).ToString("o")
}
$DataDir = Join-Path $RootDir "data"
if (-not (Test-Path $DataDir)) { New-Item -ItemType Directory -Path $DataDir | Out-Null }
$PidsObj | ConvertTo-Json | Set-Content (Join-Path $DataDir "services.json")

Write-Host ""
Write-Host "All FabRich services launched successfully!" -ForegroundColor Green
Write-Host "  - AI Service:   http://127.0.0.1:8000 (Docs: http://127.0.0.1:8000/docs)" -ForegroundColor Yellow
Write-Host "  - Web UI:       http://localhost:3000" -ForegroundColor Yellow
Write-Host "  - Engine PID:   $($engineProc.Id)" -ForegroundColor Yellow
Write-Host "To stop all services, run: .\scripts\stop-all.ps1 or npm run stop:all" -ForegroundColor Cyan
