# Excel -> Jira Bulk Creator Stop Script
$PORT = 3000

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Stopping Excel -> Jira Bulk Creator       " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$conns = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue

if (-not $conns) {
    Write-Host "[Info] No active server process found on port $PORT." -ForegroundColor Yellow
    exit 0
}

$pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique

foreach ($procId in $pids) {
    try {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            Write-Host "[Stop] Terminating process $procId ($($proc.ProcessName))..." -ForegroundColor Yellow
            Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        }
    } catch {
        # ignore
    }
}

Start-Sleep -Seconds 1
$remaining = Get-NetTCPConnection -LocalPort $PORT -ErrorAction SilentlyContinue

if (-not $remaining) {
    Write-Host "[Success] Server on port $PORT has been stopped." -ForegroundColor Green
} else {
    Write-Host "[Warning] Port $PORT may still have active connections." -ForegroundColor Red
}
