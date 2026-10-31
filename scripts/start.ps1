# Excel -> Jira Bulk Creator Start Script
$ErrorActionPreference = 'Stop'

$PORT = 3000
$HOST_ADDR = '127.0.0.1'
$URL = "http://${HOST_ADDR}:${PORT}"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Starting Excel -> Jira Bulk Creator      " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Check if already running on port 3000
$existingConn = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($existingConn) {
    Write-Host "[Info] App is already running on port $PORT (PID: $($existingConn[0].OwningProcess))." -ForegroundColor Yellow
    Write-Host "Opening browser: $URL" -ForegroundColor Green
    Start-Process $URL
    exit 0
}

# 2. Check node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "[Setup] node_modules not found. Running npm install..." -ForegroundColor Yellow
    npm install
}

# 3. Check production build (.next)
if (-not (Test-Path ".next")) {
    Write-Host "[Build] Production build not found. Running npm run build..." -ForegroundColor Yellow
    npm run build
}

# 4. Start production server in background job
Write-Host "[Start] Launching server on $URL..." -ForegroundColor Green

$serverJob = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm start" -PassThru -WindowStyle Hidden

# Wait a brief moment for the server to bind
Start-Sleep -Seconds 2

# Verify server is listening
$activeConn = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue
if ($activeConn) {
    Write-Host "[Success] Server is live on $URL (Process ID: $($serverJob.Id))" -ForegroundColor Green
    Start-Process $URL
} else {
    Write-Host "[Notice] Server process started. Check $URL shortly." -ForegroundColor Yellow
    Start-Process $URL
}
