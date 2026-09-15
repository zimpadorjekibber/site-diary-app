# scripts/set-signing-secrets.ps1
#
# Pushes the four Android signing secrets to GitHub — but only after checking the
# password actually opens the keystore.
#
# Why the check: `gh secret set` asks for a value once, with no confirmation, so a
# single typo silently produces a secret that looks fine and fails two minutes
# into CI with "keystore password was incorrect". Verifying locally turns that
# into an instant, obvious error.
#
# Run:
#     powershell -ExecutionPolicy Bypass -File scripts\set-signing-secrets.ps1
#
# The password is only ever held in memory and in an environment variable, and is
# piped straight to `gh`. It is never written to disk or placed on a command line.

$ErrorActionPreference = 'Stop'

$Repo     = 'zimpadorjekibber/site-diary-app'
$Alias    = 'sitediary'
$Keystore = Join-Path $HOME 'release.jks'
$B64      = Join-Path $HOME 'release.jks.b64'

function Find-Keytool {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += (Join-Path $env:JAVA_HOME 'bin\keytool.exe') }
    $candidates += (Get-Command keytool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source)
    $candidates += Get-ChildItem 'C:\Program Files\Java\*\bin\keytool.exe' -ErrorAction SilentlyContinue |
                   Select-Object -ExpandProperty FullName
    $candidates += Get-ChildItem 'C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe' -ErrorAction SilentlyContinue |
                   Select-Object -ExpandProperty FullName
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

Write-Host ''
Write-Host '=== Signing secrets GitHub par bhejein ===' -ForegroundColor Cyan
Write-Host ''

foreach ($f in @($Keystore, $B64)) {
    if (-not (Test-Path $f)) {
        Write-Host ("Nahi mili: {0}" -f $f) -ForegroundColor Red
        Write-Host 'Pehle scripts\create-keystore.ps1 chalayein.' -ForegroundColor Red
        exit 1
    }
}

$keytool = Find-Keytool
if (-not $keytool) { Write-Host 'keytool.exe nahi mila.' -ForegroundColor Red; exit 1 }

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host 'gh (GitHub CLI) nahi mila.' -ForegroundColor Red; exit 1
}

# --- Ask, then prove the password is right before sending it anywhere ---
Write-Host 'Wahi password daalein jo keystore banate waqt banaya tha.' -ForegroundColor Cyan
Write-Host 'Typing screen par nahi dikhegi - yeh normal hai.' -ForegroundColor DarkGray
Write-Host ''

$attempt = 0
while ($true) {
    $attempt++
    if ($attempt -gt 3) {
        Write-Host ''
        Write-Host 'Teen baar galat. Agar password yaad nahi hai to nayi key banani padegi:' -ForegroundColor Red
        Write-Host '  powershell -ExecutionPolicy Bypass -File scripts\create-keystore.ps1' -ForegroundColor Red
        exit 1
    }

    $sec = Read-Host 'Keystore password' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

    if ([string]::IsNullOrEmpty($plain)) { Write-Host 'Khaali password.' -ForegroundColor Red; continue }

    $env:SD_VERIFY_PASS = $plain
    $out = & $keytool -list -keystore $Keystore -alias $Alias '-storepass:env' 'SD_VERIFY_PASS' 2>&1 | Out-String
    $ok  = ($LASTEXITCODE -eq 0)
    Remove-Item Env:\SD_VERIFY_PASS -ErrorAction SilentlyContinue

    if ($ok -and $out -match $Alias) {
        Write-Host 'Password sahi hai - keystore khul gaya.' -ForegroundColor Green
        break
    }

    Write-Host ("Password galat. ({0}/3)" -f $attempt) -ForegroundColor Red
    $plain = $null
}

# --- Send all four. Passwords go through stdin, never a command-line argument. ---
Write-Host ''
Write-Host 'GitHub par bhej raha hoon...' -ForegroundColor Cyan

$failed = $false

# PowerShell has no '<' input redirection, so pipe the file in instead.
Get-Content $B64 -Raw | & gh secret set RELEASE_KEYSTORE_BASE64 --repo $Repo
if ($LASTEXITCODE -ne 0) { $failed = $true }

& gh secret set RELEASE_KEY_ALIAS --repo $Repo --body $Alias
if ($LASTEXITCODE -ne 0) { $failed = $true }

foreach ($secretName in @('RELEASE_STORE_PASSWORD', 'RELEASE_KEY_PASSWORD')) {
    $plain | & gh secret set $secretName --repo $Repo
    if ($LASTEXITCODE -ne 0) { $failed = $true }
}

$plain = $null
[GC]::Collect()

if ($failed) {
    Write-Host ''
    Write-Host 'Kuch secrets nahi bheje ja sake. Upar ka error dekhein.' -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host '=== Chaaron secrets bhej diye ===' -ForegroundColor Green
& gh secret list --repo $Repo
Write-Host ''
Write-Host 'Ab build chalayein:' -ForegroundColor Cyan
Write-Host ('  gh workflow run "Build Android APK" --repo {0} --ref main' -f $Repo)
Write-Host ''
