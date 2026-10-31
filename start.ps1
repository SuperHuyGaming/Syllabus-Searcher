# Starts GMU Syllabus Searcher on this PC and opens it in the browser.
#   Right-click -> "Run with PowerShell", or in a terminal:  .\start.ps1
#   Add -Scrape to (re)load syllabi:                          .\start.ps1 -Scrape
param([switch]$Scrape)

Set-Location $PSScriptRoot

# 1. Make sure Docker Desktop is running.
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Starting Docker Desktop..."
    $desktop = @(
        "$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe",
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $desktop) { Write-Error "Docker Desktop isn't installed. Get it from docker.com."; exit 1 }
    Start-Process $desktop
    do { Start-Sleep 3; docker info *> $null } until ($LASTEXITCODE -eq 0)
}

# 2. Build and start the containers.
Write-Host "Starting the app (the first run downloads images and takes a few minutes)..."
docker compose up -d --build
if ($LASTEXITCODE -ne 0) { exit 1 }

# 3. Load syllabi on the first run, or when asked.
$courses = (Invoke-RestMethod http://localhost:8080/api/courses -ErrorAction SilentlyContinue).courses
if ($Scrape -or -not $courses) {
    Write-Host "Loading GMU CS syllabi. This takes 10-20 minutes the first time..."
    docker compose run --rm scraper --since "Fall 2022"
}

Write-Host "Running at http://localhost:8080  (stop with: docker compose down)"
Start-Process "http://localhost:8080"
