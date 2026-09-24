param([Parameter(Mandatory=$true)][string]$Helper, [Parameter(Mandatory=$true)][string]$FixtureRoot)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
  throw 'User PATH acceptance runs only on an ephemeral GitHub-hosted Windows runner.'
}
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment', $true)
$previous = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
$kind = if ($null -eq $previous) { $null } else { $key.GetValueKind('Path') }
$requestBefore = $env:OPENMELD_NATIVE_JOB_REQUEST
try {
  # PS 5.1 does not assume UTF-8 for BOM-free scripts. Keep source ASCII while
  # constructing real Unicode, including a non-ASCII case pair for deduplication.
  $bin = Join-Path $FixtureRoot ('command bin ' + [char]0x4e2d + [char]0x6587 + [char]0x00e4)
  New-Item -ItemType Directory -Path $bin -Force | Out-Null
  Copy-Item -LiteralPath $Helper -Destination (Join-Path $bin 'openmeld.exe')
  $unrelated = '%TEMP%\other commands;C:\unrelated path'
  $key.SetValue('Path', ($unrelated + ';' + $bin.ToUpperInvariant()), [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $request = @{ operation = 'activate-managed-command'; binDirectory = $bin } | ConvertTo-Json -Compress
  $env:OPENMELD_NATIVE_JOB_REQUEST = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($request))
  $first = & $Helper
  if ($LASTEXITCODE -ne 0 -or $first -ne 'activated') { throw 'Initial command activation failed.' }
  $second = & $Helper
  if ($LASTEXITCODE -ne 0 -or $second -ne 'already_active') { throw 'Repeated activation was not idempotent.' }
  $actual = $key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  if ($actual -cne ($bin + ';' + $unrelated)) {
    # Only synthetic fixture values; never emit the saved real runner PATH.
    @{ actual = $actual; expected = ($bin + ';' + $unrelated) } | ConvertTo-Json -Compress | Write-Output
    throw 'Activation altered an unrelated PATH entry or duplicated the command directory.'
  }
  if ($key.GetValueKind('Path') -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) { throw 'Activation lost expandable PATH semantics.' }
  # REG_SZ values must retain literal percent references, too.
  $key.SetValue('Path', $unrelated, [Microsoft.Win32.RegistryValueKind]::String)
  $third = & $Helper
  if ($LASTEXITCODE -ne 0 -or $third -ne 'activated') { throw 'Literal PATH activation failed.' }
  if ($key.GetValueKind('Path') -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'Activation changed the registry value kind.' }
  if ($key.GetValue('Path', $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) -cne ($bin + ';' + $unrelated)) { throw 'Activation changed literal PATH entries.' }
  Write-Output '{"stage":"managed_command_path","status":"passed"}'
} finally {
  if ($null -eq $previous) { $key.DeleteValue('Path', $false) } else { $key.SetValue('Path', $previous, $kind) }
  $key.Dispose()
  $env:OPENMELD_NATIVE_JOB_REQUEST = $requestBefore
}
