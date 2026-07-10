$ErrorActionPreference = "Stop"

$SERVER = "root@8.137.8.78"
$REMOTE_DIR = "/opt/updates/"
$SERVER_URL = "http://8.137.8.78:8080/"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $SCRIPT_DIR

$PACKAGE = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$VERSION = $PACKAGE.version
if (-not $VERSION) { Write-Host "ERROR: no version" -ForegroundColor Red; exit 1 }

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Deploy v$VERSION"
Write-Host "========================================" -ForegroundColor Cyan

# Step 1: Build
Write-Host "[1/4] Building..." -ForegroundColor Yellow
npx electron-vite build
if ($LASTEXITCODE -ne 0) { Write-Host "Build failed!" -ForegroundColor Red; exit 1 }
Write-Host "  Build done" -ForegroundColor Green

# Step 2: Package NSIS installer
Write-Host "[2/4] Packaging NSIS installer..." -ForegroundColor Yellow
if (Test-Path dist) { Remove-Item -Recurse -Force dist }
npx electron-builder --win --publish never
if ($LASTEXITCODE -ne 0) { Write-Host "Package failed!" -ForegroundColor Red; exit 1 }
Write-Host "  Package done" -ForegroundColor Green

# Step 3: Prepare release files
Write-Host "[3/4] Preparing release files..." -ForegroundColor Yellow

$SETUP_FILE = Get-ChildItem dist\SubsidySystem*.exe | Select-Object -First 1
if (-not $SETUP_FILE) {
    Write-Host "NSIS installer not found! Files in dist\:" -ForegroundColor Red
    Get-ChildItem dist\*.exe | ForEach-Object { Write-Host $_.Name }
    exit 1
}

$SETUP_NAME = $SETUP_FILE.Name
$RELEASE_DIR = "dist\release"
if (-not (Test-Path $RELEASE_DIR)) { New-Item -ItemType Directory -Path $RELEASE_DIR -Force | Out-Null }

Copy-Item $SETUP_FILE.FullName "$RELEASE_DIR\$SETUP_NAME" -Force
Write-Host "  Setup: $SETUP_NAME"

# Blockmap
$BLOCKMAP = "$SETUP_NAME.blockmap"
if (Test-Path "dist\$BLOCKMAP") {
    Copy-Item "dist\$BLOCKMAP" "$RELEASE_DIR\$BLOCKMAP" -Force
    Write-Host "  blockmap: $BLOCKMAP"
}

# SHA512 (base64)
Write-Host "  Computing SHA512..."
$hashHex = (Get-FileHash -LiteralPath "$RELEASE_DIR\$SETUP_NAME" -Algorithm SHA512).Hash
$hashBytes = for ($i = 0; $i -lt $hashHex.Length; $i += 2) { [Convert]::ToByte($hashHex.Substring($i, 2), 16) }
$SHA512 = [Convert]::ToBase64String($hashBytes)

$EXE_SIZE = (Get-Item "$RELEASE_DIR\$SETUP_NAME").Length
$EXE_SIZE_MB = [math]::Round($EXE_SIZE / 1024 / 1024, 1)
$RELEASE_DATE = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.000Z")

# latest.yml
$YML = @"
version: $VERSION
files:
  - url: $SETUP_NAME
    sha512: $SHA512
    size: $EXE_SIZE
path: $SETUP_NAME
sha512: $SHA512
releaseDate: $RELEASE_DATE
"@
$YML | Out-File -FilePath "$RELEASE_DIR\latest.yml" -Encoding utf8 -NoNewline
Write-Host "  latest.yml generated"

# ── versions.json (版本历史) ──
Write-Host "  Updating versions.json..."

# 读取 changelog.json
$CHANGELOG = @{}
if (Test-Path "changelog.json") {
    try { $CHANGELOG = Get-Content "changelog.json" -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
}

# 读取现有 versions.json
$VERSIONS = @()
if (Test-Path "versions.json") {
    try {
        $data = Get-Content "versions.json" -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($data.versions) { $VERSIONS = [System.Collections.ArrayList]($data.versions) }
    } catch { Write-Host "    WARN: versions.json parse error, creating new" }
}
$VERSIONS = [System.Collections.ArrayList]($VERSIONS)

# 检查当前版本是否已存在
$exist = $VERSIONS | Where-Object { $_.version -eq $VERSION }
if ($exist) {
    Write-Host "    v$VERSION already in list, updating date/size"
    $exist.date = (Get-Date).ToString("yyyy-MM-dd")
    $exist.fileSize = $EXE_SIZE
} else {
    $chInfo = if ($CHANGELOG.$VERSION) { $CHANGELOG.$VERSION } else { @{} }
    $entry = @{
        version = $VERSION
        date    = (Get-Date).ToString("yyyy-MM-dd")
        title   = if ($chInfo.title) { $chInfo.title } else { '' }
        changes = if ($chInfo.changes) { $chInfo.changes } else { @() }
        fileSize = $EXE_SIZE
        downloadUrl = ''
    }
    $VERSIONS.Insert(0, $entry)
    Write-Host "    v$VERSION added to versions.json"
}

$VERSIONS_JSON = @{ versions = $VERSIONS } | ConvertTo-Json -Depth 5
$VERSIONS_JSON | Out-File -FilePath "versions.json" -Encoding utf8 -NoNewline

Copy-Item "versions.json" "$RELEASE_DIR\versions.json" -Force
Write-Host "  versions.json copied"

# app-update.yml for win-unpacked
if (Test-Path "dist\win-unpacked") {
    Copy-Item "$RELEASE_DIR\latest.yml" "dist\win-unpacked\resources\app-update.yml" -Force
}

# Step 4: Upload
Write-Host "[4/4] Uploading to server..." -ForegroundColor Yellow
scp -r dist\release\* $SERVER`:$REMOTE_DIR
if ($LASTEXITCODE -ne 0) {
    Write-Host "  WARNING: Upload failed, check SSH connection" -ForegroundColor Yellow
} else {
    Write-Host "  Upload OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Deploy v$VERSION done! ($EXE_SIZE_MB MB)" -ForegroundColor Green
Write-Host "  $SERVER_URL" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
