# scripts/create-keystore.ps1
#
# Creates the Android release signing key, one time.
#
# Why a script instead of a one-liner: keytool's own prompts do not handle
# backspace in the Windows console, and pasting a long multi-line command into
# PowerShell mangles the arguments. Here every value is collected by PowerShell
# (where editing works normally) and passed to keytool as an argument array, so
# nothing goes through a second round of command-line parsing.
#
# Run from anywhere:
#     powershell -ExecutionPolicy Bypass -File scripts\create-keystore.ps1
#
# The password is never written to disk, never placed on the command line (it is
# handed to keytool through an environment variable), and never committed —
# *.jks and keystore.properties are gitignored.

$ErrorActionPreference = 'Stop'

function Find-Keytool {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
    $candidates += (Get-Command keytool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    $candidates += Get-ChildItem 'C:\Program Files\Java\*\bin\keytool.exe' -ErrorAction SilentlyContinue |
                   Select-Object -ExpandProperty FullName
    $candidates += Get-ChildItem 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe' -ErrorAction SilentlyContinue |
                   Select-Object -ExpandProperty FullName
    $candidates += Get-ChildItem 'C:\Program Files\Eclipse Adoptium\*\bin\keytool.exe' -ErrorAction SilentlyContinue |
                   Select-Object -ExpandProperty FullName

    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

Write-Host ''
Write-Host '=== Android release key banayein ===' -ForegroundColor Cyan
Write-Host ''

$keytool = Find-Keytool
if (-not $keytool) {
    Write-Host 'keytool.exe nahi mila. Java ya Android Studio install karein.' -ForegroundColor Red
    exit 1
}
Write-Host ("keytool mila: {0}" -f $keytool) -ForegroundColor DarkGray

$keystorePath = Join-Path $HOME 'release.jks'
if (Test-Path $keystorePath) {
    Write-Host ''
    Write-Host ("SAAVDHAN: {0} pehle se maujood hai." -f $keystorePath) -ForegroundColor Yellow
    Write-Host 'Ise badalne par purane app ka update kabhi nahi bhej payenge.' -ForegroundColor Yellow
    $ans = Read-Host 'Purani file rakhein aur band karein? (Y/n)'
    if ($ans -ne 'n' -and $ans -ne 'N') {
        Write-Host 'Kuch nahi badla gaya.' -ForegroundColor Green
        exit 0
    }
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Move-Item $keystorePath "$keystorePath.$stamp.bak"
    Write-Host ("Purani file yahan rakh di: {0}.{1}.bak" -f $keystorePath, $stamp) -ForegroundColor DarkGray
}

# --- Identity shown in the certificate. Cosmetic; signing works regardless. ---
$name  = Read-Host 'Aapka naam          [Zimpa Dorje]'
if ([string]::IsNullOrWhiteSpace($name))  { $name  = 'Zimpa Dorje' }
$org   = Read-Host 'Sanstha / app naam  [Shram Site Diary]'
if ([string]::IsNullOrWhiteSpace($org))   { $org   = 'Shram Site Diary' }
$city  = Read-Host 'Sheher              [Kaza]'
if ([string]::IsNullOrWhiteSpace($city))  { $city  = 'Kaza' }
$state = Read-Host 'Rajya               [Himachal Pradesh]'
if ([string]::IsNullOrWhiteSpace($state)) { $state = 'Himachal Pradesh' }

$dname = "CN=$name, O=$org, L=$city, ST=$state, C=IN"

# --- Password. Read-Host handles backspace properly, keytool's own prompt does not. ---
Write-Host ''
Write-Host 'Ab naya password banayein (kam se kam 6 akshar).' -ForegroundColor Cyan
Write-Host 'Typing screen par nahi dikhegi - yeh normal hai.' -ForegroundColor DarkGray
Write-Host 'ISE SAMBHAAL KAR RAKHEN: kho gaya to app ka update kabhi nahi bhej payenge.' -ForegroundColor Yellow

while ($true) {
    $p1 = Read-Host 'Password      ' -AsSecureString
    $p2 = Read-Host 'Dobara likhein' -AsSecureString

    $b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p1)
    $b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($p2)
    $plain1 = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b1)
    $plain2 = [Runtime.InteropServices.Marshal]::PtrToStringAuto($b2)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2)

    if ($plain1 -ne $plain2)      { Write-Host 'Dono password alag hain. Phir se.' -ForegroundColor Red; continue }
    if ($plain1.Length -lt 6)     { Write-Host 'Kam se kam 6 akshar chahiye. Phir se.' -ForegroundColor Red; continue }
    break
}

$env:SD_KEYSTORE_PASS = $plain1
$plain1 = $null; $plain2 = $null

# Argument array: PowerShell hands each element to keytool as-is, so spaces and
# commas inside -dname cannot be re-split.
$ktArgs = @(
    '-genkeypair',
    '-v',
    '-keystore',  $keystorePath,
    '-alias',     'sitediary',
    '-keyalg',    'RSA',
    '-keysize',   '2048',
    '-validity',  '10000',
    '-dname',     $dname,
    '-storepass:env', 'SD_KEYSTORE_PASS',
    '-keypass:env',   'SD_KEYSTORE_PASS'
)

Write-Host ''
& $keytool @ktArgs
$exit = $LASTEXITCODE

if ($exit -ne 0 -or -not (Test-Path $keystorePath)) {
    Remove-Item Env:\SD_KEYSTORE_PASS -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host 'Key nahi ban payi. Upar ka error dekhein.' -ForegroundColor Red
    exit 1
}

# --- Verify the key really is in there before claiming success. ---
$listOut = & $keytool -list -keystore $keystorePath '-storepass:env' 'SD_KEYSTORE_PASS' 2>&1 | Out-String
Remove-Item Env:\SD_KEYSTORE_PASS -ErrorAction SilentlyContinue

if ($listOut -notmatch 'sitediary') {
    Write-Host 'Key file to bani, par usme "sitediary" alias nahi mila.' -ForegroundColor Red
    exit 1
}

# --- base64 for the GitHub secret, straight to the clipboard ---
$b64Path = Join-Path $HOME 'release.jks.b64'
[Convert]::ToBase64String([IO.File]::ReadAllBytes($keystorePath)) | Set-Content -Encoding ascii $b64Path
Get-Content $b64Path -Raw | Set-Clipboard

Write-Host ''
Write-Host '=== Ho gaya ===' -ForegroundColor Green
Write-Host ("Key file : {0}" -f $keystorePath)
Write-Host ("Base64   : {0}" -f $b64Path)
Write-Host ''
Write-Host 'Base64 clipboard me copy ho chuka hai.' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Ab GitHub par jayein:' -ForegroundColor Cyan
Write-Host '  Settings -> Secrets and variables -> Actions -> New repository secret'
Write-Host ''
Write-Host '  RELEASE_KEYSTORE_BASE64  = Ctrl+V (clipboard me hai)'
Write-Host '  RELEASE_STORE_PASSWORD   = jo password abhi banaya'
Write-Host '  RELEASE_KEY_ALIAS        = sitediary'
Write-Host '  RELEASE_KEY_PASSWORD     = wahi password'
Write-Host ''
Write-Host 'Iske baad release.jks aur uske password ka backup zaroor rakhein.' -ForegroundColor Yellow
Write-Host 'Android me "password bhool gaye" wala koi rasta nahi hota.' -ForegroundColor Yellow
Write-Host ''
