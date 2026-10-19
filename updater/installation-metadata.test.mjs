/** Actual registry round trip, limited to two fresh random per-user fixture keys. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run, atomicJson } from './upgrade-worker.mjs';

test('metadata rollback restores exact registry values and removes candidate-only additions', { skip: process.platform !== 'win32' }, async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-metadata-')));
  const guid = randomUUID();
  const powershell = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const environment = { ...process.env }; delete environment.PSModulePath;
  Object.assign(environment, { USERPROFILE: root, HOME: root, APPDATA: path.join(root, 'AppData/Roaming'), LOCALAPPDATA: path.join(root, 'AppData/Local') });
  for (const folder of [path.join(root, 'Desktop'), path.join(environment.APPDATA, 'Microsoft/Windows/Start Menu/Programs'), environment.LOCALAPPDATA]) await fs.mkdir(folder, { recursive: true });
  const fixture = path.join(root, 'fixture.ps1');
  await fs.writeFile(fixture, `param([string]$Guid,[string]$InstallDir,[string]$StatePath,[ValidateSet('Create','Change','Read','Cleanup')][string]$Action)
$ErrorActionPreference='Stop'
if($Guid -notmatch '^[a-f0-9-]{36}$'){throw 'Fixture GUID required'}
$uninstall='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$Guid
$private='HKCU:\\Software\\'+$Guid
$parents=@('HKCU:\\Software\\Microsoft','HKCU:\\Software\\Microsoft\\Windows','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
if($Action -eq 'Create'){
  foreach($key in @($uninstall,$private)){if(Test-Path -LiteralPath $key){throw 'Existing key must not be adopted'}}
  New-Item -Path $private | Out-Null
  Set-ItemProperty -LiteralPath $private -Name FixtureMarker -Value $Guid
  $created=@()
  foreach($key in $parents){
    if(-not(Test-Path -LiteralPath $key)){
      New-Item -Path $key | Out-Null; $created+= $key
      ConvertTo-Json -InputObject $created | Set-Content -LiteralPath $StatePath -Encoding utf8
    }
  }
  New-Item -Path $uninstall | Out-Null
  Set-ItemProperty -LiteralPath $uninstall -Name DisplayName -Value ('DeepSeek Harness fixture '+$Guid)
  Set-ItemProperty -LiteralPath $uninstall -Name InstallLocation -Value $InstallDir
  New-ItemProperty -LiteralPath $private -Name OriginalNumber -Value 17 -PropertyType DWord | Out-Null
}elseif($Action -eq 'Change'){
  Set-ItemProperty -LiteralPath $private -Name OriginalNumber -Value 99
  Set-ItemProperty -LiteralPath $private -Name CandidateOnly -Value 'must disappear'
  New-Item -Path ($private+'\\CandidateChild') | Out-Null
  Set-ItemProperty -LiteralPath ($private+'\\CandidateChild') -Name CandidateOnly -Value 'must disappear'
  Set-ItemProperty -LiteralPath $uninstall -Name CandidateOnly -Value 'must disappear'
}elseif($Action -eq 'Cleanup'){
  if(-not(Test-Path -LiteralPath $private)){return}
  if((Get-ItemProperty -LiteralPath $private).FixtureMarker -ne $Guid){throw 'Fixture ownership marker differs'}
  foreach($key in @($uninstall,$private)){if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key -Recurse -Force}}
  if(Test-Path -LiteralPath $StatePath){
    $created=@(Get-Content -LiteralPath $StatePath -Raw | ConvertFrom-Json)
    [array]::Reverse($created)
    foreach($key in $created){
      if($key -notin $parents){throw 'Unknown fixture-created registry ancestor'}
      if((Test-Path -LiteralPath $key) -and @(Get-ChildItem -LiteralPath $key).Count -eq 0 -and @((Get-Item -LiteralPath $key).Property).Count -eq 0){Remove-Item -LiteralPath $key}
    }
  }
}else{
  $result=@()
  foreach($key in @($uninstall,$private)){
    $values=@((Get-ItemProperty -LiteralPath $key).PSObject.Properties | Where-Object {$_.Name -notlike 'PS*'} | Sort-Object Name | ForEach-Object {[pscustomobject]@{name=$_.Name;value=$_.Value}})
    $result += [pscustomobject]@{key=$key;values=$values;children=@(Get-ChildItem -LiteralPath $key).Count}
  }
  ConvertTo-Json -InputObject $result -Depth 6 -Compress
}
`);
  const args = ['-NoProfile', '-NonInteractive', '-File', fixture, '-Guid', guid, '-InstallDir', path.join(root, 'install'), '-StatePath', path.join(root, 'created-registry-ancestors.json')];
  const command = action => run(powershell, [...args, '-Action', action], { env: environment, timeoutMs: 60_000 });
  try {
    await command('Create'); const original = JSON.parse(await command('Read'));
    const configPath = path.join(root, 'config.json');
    await atomicJson(configPath, { root, installDir: path.join(root, 'install') });
    const destination = path.join(root, 'transactions', 'fixture');
    const metadata = path.join(path.dirname(fileURLToPath(import.meta.url)), 'installation-metadata.ps1');
    const invoke = action => run(powershell, ['-NoProfile', '-NonInteractive', '-File', metadata, '-Action', action, '-ConfigPath', configPath, '-Destination', destination], { env: environment, timeoutMs: 60_000 });
    assert.equal(JSON.parse(await invoke('Snapshot')).registryEntries, 2);
    await command('Change'); assert.notDeepEqual(JSON.parse(await command('Read')), original);
    assert.equal(JSON.parse(await invoke('Restore')).registryEntries, 2);
    assert.deepEqual(JSON.parse(await command('Read')), original);
  } finally {
    await command('Cleanup');
    assert.ok(root.startsWith(await fs.realpath(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
