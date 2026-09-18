import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { normalizeCommandEnvironment } from "@openmeld/adapter-core/process-environment";
import {
  powerShellEncodedArguments,
  resolveWindowsPowerShellPath,
} from "@openmeld/adapter-core/windows-system";
import { desktopWindowsBuildSchema } from "@openmeld/schemas";

const SIGNATURE_VERIFIED = "OPENMELD_AUTHENTICODE_VERIFIED";
const VERIFY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$r = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OPENMELD_SIGNATURE_REQUEST)))
$path = [IO.Path]::GetFullPath($r.path)
$signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $path -ErrorAction Stop
if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or !$signature.SignerCertificate -or $signature.Path -ine $path) { throw 'OpenMeld update signature is not valid for this file.' }
$certificate = $signature.SignerCertificate
$publisher = [string]$r.publisherName
$matches = if ($publisher.Contains('=')) { $certificate.Subject -ceq $publisher } else { $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ceq $publisher }
if (!$matches) { throw 'OpenMeld update publisher does not match this installation.' }
[Console]::Out.Write('OPENMELD_AUTHENTICODE_VERIFIED')
`;

type ExecuteSignatureCheck = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    windowsHide: boolean;
    timeout: number;
    maxBuffer: number;
  }
) => Promise<{ stdout: string; stderr: string }>;

/** Public NSIS verifier seam: every missing/failed/ambiguous OS result rejects. */
export async function verifyWindowsDesktopSignature(
  path: string,
  publisherName: string,
  execute: ExecuteSignatureCheck = promisify(execFile)
): Promise<void> {
  const publisher =
    desktopWindowsBuildSchema.shape.publisherName.parse(publisherName);
  if (!win32.isAbsolute(path) || path.includes("\0")) {
    throw new Error(
      "OpenMeld signature verification requires an absolute Windows file path."
    );
  }
  const env = normalizeCommandEnvironment(process.env, "win32");
  // Use Windows PowerShell's own module discovery, not a caller override.
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PSMODULEPATH") {
      delete env[key];
    }
  }
  const result = await execute(
    resolveWindowsPowerShellPath(env),
    powerShellEncodedArguments(VERIFY_SCRIPT),
    {
      env: {
        ...env,
        OPENMELD_SIGNATURE_REQUEST: Buffer.from(
          JSON.stringify({ path, publisherName: publisher })
        ).toString("base64"),
      },
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 16_384,
    }
  );
  if (result.stderr.trim() || result.stdout.trim() !== SIGNATURE_VERIFIED) {
    throw new Error("Windows could not verify the OpenMeld update signature.");
  }
}
