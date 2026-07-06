$ErrorActionPreference = "Stop"

$SERVER = "root@8.137.8.78"
$REMOTE_DIR = "/opt/updates/"
$SERVER_URL = "http://8.137.8.78:8080/"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

$PACKAGE = Get-Content "package.json" -Raw | ConvertFrom-Json
$VERSION = $PACKAGE.version
if (-not $VERSION) { Write-Host "ERROR: no version" -ForegroundColor Red; exit 1 }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deploy v$VERSION"
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Build
Write-Host "[1/3] Building..." -ForegroundColor Yellow
npx electron-vite build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }
Write-Host "Build done" -ForegroundColor Green

# Step 2: Package
Write-Host "[2/3] Packaging..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
npx electron-builder --dir --win
if ($LASTEXITCODE -ne 0) { Write-Host "Package failed!" -ForegroundColor Red; exit 1 }
Write-Host "Package done" -ForegroundColor Green

# Step 3: Generate latest.yml
Write-Host "[3/3] Generating latest.yml..." -ForegroundColor Yellow

$APP_EXE = "农户补贴管理系统.exe"
$RELEASE_DIR = "dist\release"
if (-not (Test-Path $RELEASE_DIR)) { New-Item -ItemType Directory -Path $RELEASE_DIR -Force | Out-Null }

$SOURCE_EXE = "dist\win-unpacked\$APP_EXE"
if (-not (Test-Path $SOURCE_EXE)) {
    Write-Host "EXE not found, listing dist\win-unpacked\:" -ForegroundColor Red
    Get-ChildItem dist\win-unpacked\*.exe | ForEach-Object { Write-Host $_.Name }
    exit 1
}

Copy-Item $SOURCE_EXE "$RELEASE_DIR\$APP_EXE" -Force
$EXE_SIZE = (Get-Item "$RELEASE_DIR\$APP_EXE").Length
$EXE_SIZE_MB = [math]::Round($EXE_SIZE / 1024 / 1024, 1)
$RELEASE_DATE = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.000Z")

# Write latest.yml line by line
$YML_PATH = "$RELEASE_DIR\latest.yml"
"version: $VERSION" | Out-File -FilePath $YML_PATH -Encoding utf8
"files:" | Out-File -FilePath $YML_PATH -Append -Encoding utf8
"  - url: $APP_EXE" | Out-File -FilePath $YML_PATH -Append -Encoding utf8
"    sha512: SKIP" | Out-File -FilePath $YML_PATH -Append -Encoding utf8
"    size: $EXE_SIZE" | Out-File -FilePath $YML_PATH -Append -Encoding utf8
"path: $APP_EXE" | Out-File -FilePath $YML_PATH -Append -Encoding utf8
"sha512: SKIP" | Out-File -FilePath $YML_PATH -Append -Encoding utf8
"releaseDate: $RELEASE_DATE" | Out-File -FilePath $YML_PATH -Append -Encoding utf8

Write-Host ""
Write-Host "Done!" -ForegroundColor Green
Write-Host "  $APP_EXE - ${EXE_SIZE_MB}MB"
Write-Host "  latest.yml - version $VERSION"
Write-Host ""
Write-Host "Upload manually:" -ForegroundColor Yellow
Write-Host "  scp dist\release\* $SERVER`:$REMOTE_DIR"
Write-Host "Verify:" -ForegroundColor Yellow
Write-Host "  curl $SERVER_URL`latest.yml"
