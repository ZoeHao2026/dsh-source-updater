param([Parameter(Mandatory=$true)][string]$Source,[Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition (Get-Content -LiteralPath $Source -Raw) -Language CSharp -ReferencedAssemblies 'System.Web.Extensions' -OutputAssembly $OutputPath -OutputType ConsoleApplication
