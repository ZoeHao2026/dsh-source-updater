param([Parameter(Mandatory = $true)][string]$LiteralPath)
$ErrorActionPreference = 'Stop'
$taskLink = Get-Item -LiteralPath $LiteralPath -Force
if ($taskLink.LinkType -notin @('Junction', 'SymbolicLink')) { throw 'Expected a symbolic link or junction' }
[pscustomobject]@{ linkType = [string]$taskLink.LinkType; directory = [bool]$taskLink.PSIsContainer } | ConvertTo-Json -Compress
