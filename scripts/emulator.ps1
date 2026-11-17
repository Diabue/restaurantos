param(
    [switch]$Build,
    [switch]$NoWindow,
    [ValidateRange(5554, 5680)][int]$Port = 5558
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$localSdk = Join-Path $repo '.local/android-sdk'
$sdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif (Test-Path $localSdk) { $localSdk } else { Join-Path $env:LOCALAPPDATA 'Android/Sdk' }
$sdk = (Resolve-Path -LiteralPath $sdk).Path
$env:ANDROID_HOME = $sdk
if (-not $env:JAVA_HOME) {
    $java21 = Get-ChildItem -LiteralPath 'C:/Program Files/Eclipse Adoptium' -Directory -Filter 'jdk-21*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($java21) { $env:JAVA_HOME = $java21.FullName }
}
$env:ANDROID_AVD_HOME = (New-Item -ItemType Directory -Force (Join-Path $repo '.local/avd')).FullName
$avd = 'RestaurantOS_Tablet'
$device = "emulator-$Port"
$adb = Join-Path $sdk 'platform-tools/adb.exe'
$emulator = Join-Path $sdk 'emulator/emulator.exe'
$avdManager = Join-Path $sdk 'cmdline-tools/latest/bin/avdmanager.bat'
$apk = Join-Path $repo 'android/app/build/outputs/apk/debug/app-debug.apk'
if ($Port % 2 -ne 0) { throw 'Port emulatora musi być parzysty.' }
if (-not ((Test-Path -LiteralPath $adb) -and (Test-Path -LiteralPath $emulator))) { throw 'Zainstaluj Android Emulator i Android SDK Platform-Tools.' }
if ($Build -or -not (Test-Path -LiteralPath $apk)) {
    & (Join-Path $repo 'android/gradlew.bat') -p (Join-Path $repo 'android') assembleDebug
    if ($LASTEXITCODE -ne 0) { throw 'Budowanie APK zakończyło się błędem.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $env:ANDROID_AVD_HOME "$avd.ini"))) {
    if (-not (Test-Path -LiteralPath $avdManager)) { throw 'Zainstaluj Android SDK Command-line Tools.' }
    'no' | & $avdManager create avd --name $avd --package 'system-images;android-35;google_apis;x86_64' --device 'pixel_tablet'
    if ($LASTEXITCODE -ne 0) { throw 'Nie można utworzyć tabletu. Sprawdź instalację obrazu Androida 35.' }
}
if (-not ((& $adb devices) -match "^$device\s")) {
    $launch = @{
        FilePath = $emulator
        ArgumentList = @('-avd', $avd, '-port', $Port, '-gpu', 'swiftshader', '-no-snapshot-load', '-no-boot-anim')
        PassThru = $true
        RedirectStandardOutput = (Join-Path $repo '.local/emulator.log')
        RedirectStandardError = (Join-Path $repo '.local/emulator-error.log')
    }
    if ($NoWindow) { $launch.ArgumentList += '-no-window'; $launch.WindowStyle = 'Hidden' }
    $emulatorProcess = Start-Process @launch
}
Write-Host "Czekam na Androida ($device)…"
$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($emulatorProcess -and $emulatorProcess.HasExited) { throw 'Emulator zakończył pracę. Sprawdź .local/emulator-error.log.' }
    if ((& $adb devices) -match "^$device\s+device$") {
        try { $boot = & $adb -s $device shell getprop sys.boot_completed 2>$null } catch { $boot = '' }
        if ($boot -eq '1') { $ready = $true; break }
    }
    Start-Sleep -Seconds 2
}
if (-not $ready) { throw 'Emulator nie uruchomił Androida w wyznaczonym czasie.' }
& $adb -s $device install -r $apk
if ($LASTEXITCODE -ne 0) { throw 'Nie udało się zainstalować APK.' }
& $adb -s $device shell am start -n pl.restaurantos.tablet/.MainActivity
if ($LASTEXITCODE -ne 0) { throw 'Nie udało się uruchomić RestaurantOS.' }
Write-Host 'Lokal: oliwa · login: manager · hasło: demo1234'
