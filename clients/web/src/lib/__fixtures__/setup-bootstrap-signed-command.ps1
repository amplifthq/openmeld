param([string]$Root, [string]$Publisher)
$ErrorActionPreference = 'Stop'
# This fixture is permitted only on disposable GitHub-hosted Windows runners.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'Signing fixture requires an ephemeral GitHub-hosted runner.' }
$source = @'
using System;
using System.IO;
using System.Reflection;
using System.Web.Script.Serialization;
public static class SetupFixture {
  public static int Main(string[] args) {
    var json = new JavaScriptSerializer();
    var home = Environment.GetEnvironmentVariable("OPENMELD_HOME");
    var commandPrefix = Environment.GetEnvironmentVariable("OPENMELD_USER_FACING_CLI_COMMAND");
    var followUp = Environment.GetEnvironmentVariable("OPENMELD_SETUP_FOLLOW_UP_CLI_COMMAND");
    File.AppendAllText(Environment.GetEnvironmentVariable("OPENMELD_TEST_CALLS_PATH"), json.Serialize(new { args, home, commandPrefix, followUp }) + "\n");
    if (args.Length == 2 && args[0] == "install-self" && args[1] == "--json") {
      Directory.CreateDirectory(Path.Combine(home, "bin"));
      var command = Path.Combine(home, "bin", "openmeld.exe");
      File.Copy(Assembly.GetExecutingAssembly().Location, command, true);
      Console.WriteLine(json.Serialize(new { schemaVersion=1, type="cli.install_self", result="installed", version="0.0.0", platform="windows-x64", managedBinaryPath=command, currentPointerPath=command, previousVersion=(string)null, forced=false }));
      return 0;
    }
    Console.WriteLine("fixture setup output");
    Console.Error.WriteLine("fixture setup stderr");
    return 7;
  }
}
'@
$exe = Join-Path $Root 'fixture.exe'
[Console]::Out.WriteLine('fixture stage: compile')
Add-Type -TypeDefinition $source -Language CSharp -OutputAssembly $exe -OutputType ConsoleApplication -ReferencedAssemblies 'System.Web.Extensions.dll'
[Console]::Out.WriteLine('fixture stage: create certificate')
$certificate = New-SelfSignedCertificate -Subject "CN=$Publisher" -Type CodeSigningCert -CertStoreLocation 'Cert:\CurrentUser\My' -NotAfter (Get-Date).AddDays(1)
# Save the exact identity before importing trust, including for failed setup cleanup.
[IO.File]::WriteAllText((Join-Path $Root 'certificate-thumbprint.txt'), $certificate.Thumbprint)
[Console]::Out.WriteLine('fixture stage: trust certificate on ephemeral runner')
# CurrentUser Root can require interactive trust UI. The disposable hosted
# runner is an administrator; use its machine test store, never a user PC.
$store = New-Object Security.Cryptography.X509Certificates.X509Store('Root','LocalMachine')
try { $store.Open('ReadWrite'); $store.Add($certificate) } finally { $store.Close() }
[Console]::Out.WriteLine('fixture stage: sign')
$signature = Set-AuthenticodeSignature -LiteralPath $exe -Certificate $certificate -HashAlgorithm SHA256
if ($signature.Status -ne 'Valid') { throw "Fixture signing failed: $($signature.Status): $($signature.StatusMessage)" }
[Console]::Out.WriteLine('fixture stage: ready')
