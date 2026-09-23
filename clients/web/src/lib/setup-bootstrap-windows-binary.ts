import { WINDOWS_ARTIFACT_SIGNATURE_FUNCTION } from "@openmeld/local-service/windows-artifact-script";

export function buildWindowsBinaryBootstrap(input: {
	manifestUrl: string;
	envPreset: string;
	userFacingCommand: string;
	openMeldHome: string;
	gatewayUrl: string;
	authUrl: string;
	progressMessage: string;
}): string {
	const configuration = JSON.stringify(input).replaceAll("'", "''");
	return String.raw`param([Parameter(ValueFromRemainingArguments=$true)][string[]]$OpenMeldArgs)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$c = ConvertFrom-Json '${configuration}'
$temporary = $null
$tls = [Net.ServicePointManager]::SecurityProtocol
${WINDOWS_ARTIFACT_SIGNATURE_FUNCTION}

function Get-OpenMeldFile([string]$Url, [string]$Destination, [long]$MaximumBytes) {
  $uri = [Uri]$Url
  $manifest = [Uri]$c.manifestUrl
  if (!$uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Fragment -or $uri.Scheme -ne $manifest.Scheme -or $uri.Authority -ne $manifest.Authority) { throw 'OpenMeld returned an unexpected download location.' }
  if ($uri.Scheme -ne 'https' -and !($uri.Scheme -eq 'http' -and $uri.IsLoopback -and $c.envPreset -ne 'prod')) { throw 'OpenMeld requires a secure download connection.' }
  $request = [Net.HttpWebRequest]::Create($uri)
  $request.AllowAutoRedirect = $false
  $request.Timeout = 30000
  $request.ReadWriteTimeout = 60000
  $response = $null; $stream = $null; $file = $null
  $started = [Diagnostics.Stopwatch]::StartNew()
  try {
    $response = $request.GetResponse()
    if ([int]$response.StatusCode -ne 200 -or $response.ContentLength -gt $MaximumBytes) { throw 'OpenMeld download returned an unexpected response.' }
    $stream = $response.GetResponseStream()
    $file = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    $buffer = New-Object byte[] 65536
    [long]$total = 0
    while (($count = $stream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $total += $count
      if ($total -gt $MaximumBytes -or $started.Elapsed.TotalMinutes -ge 5) { throw 'OpenMeld download exceeded its size or time limit.' }
      $file.Write($buffer, 0, $count)
    }
  } finally {
    if ($file) { $file.Dispose() }; if ($stream) { $stream.Dispose() }; if ($response) { $response.Close() }
  }
}

function Get-OpenMeldArtifact($Artifact, [string]$Destination, [string]$Publisher) {
  if (!$Artifact -or [string]$Artifact.sha256 -cnotmatch '^[0-9a-f]{64}$' -or [long]$Artifact.sizeBytes -le 0 -or [long]$Artifact.sizeBytes -gt 536870912) { throw 'OpenMeld returned invalid artifact metadata.' }
  Get-OpenMeldFile $Artifact.url $Destination ([long]$Artifact.sizeBytes)
  $file = [IO.File]::OpenRead($Destination)
  $hash = [Security.Cryptography.SHA256]::Create()
  try {
    if ($file.Length -ne [long]$Artifact.sizeBytes) { throw 'OpenMeld download has an unexpected size.' }
    $actual = [BitConverter]::ToString($hash.ComputeHash($file)).Replace('-', '').ToLowerInvariant()
    if ($actual -cne [string]$Artifact.sha256) { throw 'OpenMeld download failed its integrity check.' }
  } finally { $hash.Dispose(); $file.Dispose() }
  Assert-OpenMeldArtifactSignature $Destination $Publisher
}

function Quote-OpenMeldArgument([string]$Value) {
  return '"' + [regex]::Replace([regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Invoke-OpenMeld([string]$Executable, [string[]]$Arguments, [switch]$Receipt) {
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $Executable
  $start.Arguments = (@($Arguments | ForEach-Object { Quote-OpenMeldArgument $_ }) -join ' ')
  $start.UseShellExecute = $false
  $start.RedirectStandardOutput = [bool]$Receipt
  foreach ($name in @('OPENMELD_HOME','OPENMELD_GATEWAY_URL','OPENMELD_AUTH_URL','OPENMELD_CLI_BINARY_MANIFEST_URL','OPENMELD_USER_FACING_CLI_COMMAND','OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND')) { $start.EnvironmentVariables.Remove($name) }
  $start.EnvironmentVariables['OPENMELD_ENV_PRESET'] = $c.envPreset
  $start.EnvironmentVariables['OPENMELD_USER_FACING_CLI_COMMAND'] = $c.userFacingCommand
  $start.EnvironmentVariables['OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND'] = $c.userFacingCommand
  $start.EnvironmentVariables['OPENMELD_CLI_BINARY_MANIFEST_URL'] = $c.manifestUrl
  if ($c.openMeldHome) { $start.EnvironmentVariables['OPENMELD_HOME'] = $c.openMeldHome }
  if ($c.gatewayUrl) { $start.EnvironmentVariables['OPENMELD_GATEWAY_URL'] = $c.gatewayUrl }
  if ($c.authUrl) { $start.EnvironmentVariables['OPENMELD_AUTH_URL'] = $c.authUrl }
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $start
  try {
    $null = $process.Start()
    $output = if ($Receipt) { $process.StandardOutput.ReadToEnd() } else { $null }
    $process.WaitForExit()
    if ($Receipt) {
      if ($process.ExitCode -ne 0) { throw 'OpenMeld Tools installation did not complete.' }
      return (ConvertFrom-Json $output)
    }
    return $process.ExitCode
  } finally { $process.Dispose() }
}

try {
  if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() -ne 'X64') { throw 'OpenMeld Tools currently require an x64 Windows PC.' }
  if ($OpenMeldArgs.Count -lt 1 -or $OpenMeldArgs[0] -ne 'setup' -or !(@($OpenMeldArgs | Where-Object { $_ -eq '--start-session' -or $_.StartsWith('--start-session=') }).Count) -or !(@($OpenMeldArgs | Where-Object { $_ -eq '--device-code' -or $_.StartsWith('--device-code=') -or $_ -eq '--ott' -or $_.StartsWith('--ott=') }).Count)) { throw 'Copy the latest setup command from OpenMeld Web and run it again.' }
  [Net.ServicePointManager]::SecurityProtocol = $tls -bor [Net.SecurityProtocolType]::Tls12
  $temporary = Join-Path ([IO.Path]::GetTempPath()) ('openmeld-setup-' + [Guid]::NewGuid().ToString('N'))
  $null = [IO.Directory]::CreateDirectory($temporary)
  Write-Host 'Downloading OpenMeld Tools...'
  $manifestPath = Join-Path $temporary 'manifest.json'
  Get-OpenMeldFile $c.manifestUrl $manifestPath 2097152
  $manifest = ConvertFrom-Json ([IO.File]::ReadAllText($manifestPath))
  $release = $manifest.channels.stable.platforms.'windows-x64'
  $publisher = [string]$release.windows.publisherName
  if ($manifest.schemaVersion -ne 1 -or !$release -or [string]::IsNullOrWhiteSpace($publisher) -or !$release.windows.processHelper -or !$manifest.channels.stable.service.platforms.'windows-x64') { throw 'OpenMeld Tools are unavailable for this Windows computer.' }
  $cli = Join-Path $temporary 'openmeld.exe'
  Get-OpenMeldArtifact $release $cli $publisher
  Get-OpenMeldArtifact $release.windows.processHelper (Join-Path $temporary 'openmeld-windows-process.exe') $publisher
  $installed = Invoke-OpenMeld $cli @('install-self','--json') -Receipt
  if ($installed.schemaVersion -ne 1 -or $installed.type -ne 'cli.install_self' -or $installed.platform -ne 'windows-x64' -or $installed.result -notin @('installed','noop_same_version','noop_newer_present') -or ![IO.Path]::IsPathRooted($installed.currentPointerPath) -or ![IO.File]::Exists($installed.currentPointerPath)) { throw 'OpenMeld Tools returned an invalid installation result.' }
  Write-Host $c.progressMessage
  $exitCode = Invoke-OpenMeld $installed.currentPointerPath $OpenMeldArgs
  exit $exitCode
} catch {
  Write-Host 'OpenMeld setup could not continue.'
  Write-Host $_.Exception.Message
  exit 1
} finally {
  [Net.ServicePointManager]::SecurityProtocol = $tls
  if ($temporary -and [IO.Directory]::Exists($temporary)) { [IO.Directory]::Delete($temporary, $true) }
}
`;
}
