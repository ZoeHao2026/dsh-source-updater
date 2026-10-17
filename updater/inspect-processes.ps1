param([Parameter(Mandatory = $true)][string]$RequestPath)
$ErrorActionPreference = 'Stop'
$request = Get-Content -LiteralPath $RequestPath -Raw | ConvertFrom-Json
$roots = @($request.installDir, $request.userDataDir, $request.sharedDataDir) | ForEach-Object { [IO.Path]::GetFullPath($_).TrimEnd('\') }
$writers = @(Get-CimInstance Win32_Process | Where-Object {
    $candidate = $_
    if ($candidate.ProcessId -eq $PID -or $candidate.ProcessId -eq $request.workerPid) { return $false }
    $name = [string]$candidate.Name
    $executable = [string]$candidate.ExecutablePath
    $commandLine = [string]$candidate.CommandLine
    if ($name -eq 'DeepSeek Harness.exe' -or $name -eq 'dsh.exe') { return $true }
    if ($name -notmatch '^(node|electron)\.exe$') { return $false }
    if ($commandLine -match '(?i)(dsh-desktop-host|[\\/]dsh[\\/].*cli\.(js|mjs)|deepseek-harness.*(start|desktop|host))') { return $true }
    foreach ($root in $roots) {
        if (($executable -and $executable.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) -or ($commandLine -and $commandLine.IndexOf($root, [StringComparison]::OrdinalIgnoreCase) -ge 0)) { return $true }
    }
    return $false
} | ForEach-Object { @{ pid = $_.ProcessId; name = $_.Name } })
ConvertTo-Json -InputObject $writers -Compress
