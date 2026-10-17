param([Parameter(Mandatory = $true)][string]$CachePath)
$ErrorActionPreference = 'Stop'
# The updater can be launched by PowerShell 7, whose inherited PSModulePath must not select its module in Windows PowerShell 5.
Import-Module -Name (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$item = Get-Item -LiteralPath $CachePath -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Source build cache must be a physical directory' }
$ownerSid = (Get-Acl -LiteralPath $item.FullName).GetOwner([Security.Principal.SecurityIdentifier]).Value
$currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
@{ ownedByCurrentUser = ($ownerSid -eq $currentSid); ownerSid = $ownerSid; currentSid = $currentSid } | ConvertTo-Json -Compress
