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
  const fixture = path.join(root, 'fixture.ps1');
  await fs.writeFile(fixture, `param([string]$Guid,[string]$InstallDir,[ValidateSet('Create','Change','Read','Cleanup')][string]$Action)
$ErrorActionPreference='Stop'
if($Guid -notmatch '^[a-f0-9-]{36}$'){throw 'Fixture GUID required'}
$uninstall='HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\'+$Guid
$private='HKCU:\\Software\\'+$Guid
if($Action -eq 'Create'){
  foreach($key in @($uninstall,$private)){if(Test-Path -LiteralPath $key){throw 'Existing key must not be adopted'}}
  New-Item -Path $uninstall | Out-Null; New-Item -Path $private | Out-Null
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
  foreach($key in @($uninstall,$private)){if(Test-Path -LiteralPath $key){Remove-Item -LiteralPath $key -Recurse -Force}}
}else{
  $result=@()
  foreach($key in @($uninstall,$private)){
    $values=@((Get-ItemProperty -LiteralPath $key).PSObject.Properties | Where-Object {$_.Name -notlike 'PS*'} | Sort-Object Name | ForEach-Object {[pscustomobject]@{name=$_.Name;value=$_.Value}})
    $result += [pscustomobject]@{key=$key;values=$values;children=@(Get-ChildItem -LiteralPath $key).Count}
  }
  ConvertTo-Json -InputObject $result -Depth 6 -Compress
}
`);
  const args = ['-NoProfile', '-NonInteractive', '-File', fixture, '-Guid', guid, '-InstallDir', path.join(root, 'install')];
  const command = action => run(powershell, [...args, '-Action', action], { env: environment, timeoutMs: 60_000 });
  let registryCreated = false;
  try {
    await command('Create'); registryCreated = true; const original = JSON.parse(await command('Read'));
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
    if (registryCreated) await command('Cleanup');
    assert.ok(root.startsWith(await fs.realpath(os.tmpdir()) + path.sep));
    await fs.rm(root, { recursive: true, force: true });
  }
});
