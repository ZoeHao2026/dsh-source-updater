param(
    [Parameter(Mandatory = $true)][ValidateSet('Snapshot','Restore','RestoreShortcuts')][string]$Action,
    [Parameter(Mandatory = $true)][string]$ConfigPath,
    [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$taskConfig = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
$taskRoot = [IO.Path]::GetFullPath($taskConfig.root).TrimEnd('\')
$taskDestination = [IO.Path]::GetFullPath($Destination).TrimEnd('\')
if (-not $taskDestination.StartsWith($taskRoot + '\transactions\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Metadata must remain in a private update transaction' }
$taskManifestPath = Join-Path $taskDestination 'manifest.json'
if ($Action -eq 'Snapshot') {
    New-Item -ItemType Directory -Path $taskDestination -ErrorAction Stop | Out-Null
    $taskRegistry = @()
    $taskUninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    foreach ($taskKey in Get-ChildItem -LiteralPath $taskUninstall) {
        $taskValues = Get-ItemProperty -LiteralPath $taskKey.PSPath
        if ($taskValues.DisplayName -notlike 'DeepSeek Harness*' -or $taskValues.InstallLocation -ne $taskConfig.installDir) { continue }
        $taskKeys = @($taskKey.Name)
        $taskPrivate = 'HKCU:\Software\' + $taskKey.PSChildName
        if (Test-Path -LiteralPath $taskPrivate) { $taskKeys += (Get-Item -LiteralPath $taskPrivate).Name }
        foreach ($taskRegistryKey in $taskKeys) {
            $taskFile = 'registry-' + $taskRegistry.Count + '.reg'
            & reg.exe export $taskRegistryKey (Join-Path $taskDestination $taskFile) /y | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Installation registry export failed' }
            $taskRegistry += [pscustomobject]@{ key=$taskRegistryKey; file=$taskFile; sha256=(Get-FileHash -LiteralPath (Join-Path $taskDestination $taskFile) -Algorithm SHA256).Hash }
        }
    }
    if ($taskRegistry.Count -eq 0) { throw 'Existing per-user installation registration was not found' }
    $taskShortcuts = @()
    $taskShell = New-Object -ComObject WScript.Shell
    $taskCandidates = @()
    $taskDesktop = [Environment]::GetFolderPath('Desktop')
    $taskPrograms = [Environment]::GetFolderPath('Programs')
    $taskCandidates += @(Get-ChildItem -LiteralPath $taskDesktop -Filter '*.lnk' -File -ErrorAction Stop)
    $taskCandidates += @(Get-ChildItem -LiteralPath $taskPrograms -Filter '*.lnk' -File -Recurse -ErrorAction Stop)
    foreach ($taskShortcut in $taskCandidates) {
        $taskTarget = $taskShell.CreateShortcut($taskShortcut.FullName).TargetPath
        if ($taskTarget -ne (Join-Path $taskConfig.installDir 'DeepSeek Harness.exe')) { continue }
        $taskFile = 'shortcut-' + $taskShortcuts.Count + '.lnk'
        Copy-Item -LiteralPath $taskShortcut.FullName -Destination (Join-Path $taskDestination $taskFile)
        $taskShortcuts += [pscustomobject]@{ original=$taskShortcut.FullName; file=$taskFile; sha256=(Get-FileHash -LiteralPath (Join-Path $taskDestination $taskFile) -Algorithm SHA256).Hash }
    }
    [pscustomobject]@{schemaVersion=1;installDir=$taskConfig.installDir;registry=$taskRegistry;shortcuts=$taskShortcuts} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $taskManifestPath -Encoding utf8
} else {
    $taskManifest = Get-Content -LiteralPath $taskManifestPath -Raw | ConvertFrom-Json
    if ($taskManifest.schemaVersion -ne 1 -or $taskManifest.installDir -ne $taskConfig.installDir) { throw 'Metadata installation identity differs' }
    foreach ($taskEntry in @($taskManifest.registry) + @($taskManifest.shortcuts)) {
        if ($taskEntry.file -notmatch '^(registry-\d+\.reg|shortcut-\d+\.lnk)$') { throw 'Invalid metadata filename' }
        if ((Get-FileHash -LiteralPath (Join-Path $taskDestination $taskEntry.file) -Algorithm SHA256).Hash -ne $taskEntry.sha256) { throw 'Metadata backup digest changed' }
    }
    if ($Action -eq 'Restore') {
        foreach ($taskEntry in $taskManifest.registry) {
            if ($taskEntry.key -notmatch '^HKEY_CURRENT_USER\\Software\\(Microsoft\\Windows\\CurrentVersion\\Uninstall\\)?[a-f0-9-]{36}$') { throw 'Registry key is outside the application installation identity' }
            & reg.exe import (Join-Path $taskDestination $taskEntry.file) | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Installation registry restoration failed' }
        }
    }
    foreach ($taskEntry in $taskManifest.shortcuts) {
        $taskOriginal = [IO.Path]::GetFullPath($taskEntry.original)
        $taskAllowed = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs')) | Where-Object { $taskOriginal.StartsWith($_.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) }
        if (-not $taskAllowed -or [IO.Path]::GetExtension($taskOriginal) -ne '.lnk') { throw 'Shortcut target is outside the original user shortcut folders' }
        Copy-Item -LiteralPath (Join-Path $taskDestination $taskEntry.file) -Destination $taskOriginal -Force
    }
}
$taskResult = Get-Content -LiteralPath $taskManifestPath -Raw | ConvertFrom-Json
[pscustomobject]@{manifest=$taskManifestPath;registryEntries=@($taskResult.registry).Count;shortcuts=@($taskResult.shortcuts).Count} | ConvertTo-Json -Compress
