param([Parameter(Mandatory = $true)][string]$CachePath)
$ErrorActionPreference = 'Stop'
Import-Module -Name (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$item = Get-Item -LiteralPath $CachePath -Force
if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'A physical fixture directory is required' }
if ($item.Name -notin @('c', 'unknown') -or $item.Parent.Name -notmatch '^(db|dp)-[A-Za-z0-9]{6}$') { throw 'Target is outside the cache ownership fixture' }
if (@(Get-ChildItem -LiteralPath $item.FullName -Force).Count -ne 0) { throw 'Fixture ownership requires a newly created empty cache directory' }
# Elevated hosted runners can create files owned by their Administrators group.
# Prepare only this test's disposable directories for a genuine current-user owner check.
$acl = Get-Acl -LiteralPath $item.FullName
$acl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
Set-Acl -LiteralPath $item.FullName -AclObject $acl
