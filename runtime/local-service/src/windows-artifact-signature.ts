import { execFile } from "node:child_process";
import { win32 } from "node:path";
import { promisify } from "node:util";
import { normalizeCommandEnvironment } from "@openmeld/adapter-core/process-environment";
import {
  powerShellEncodedArguments,
  resolveWindowsPowerShellPath,
} from "@openmeld/adapter-core/windows-system";
import { WINDOWS_ARTIFACT_SIGNATURE_FUNCTION } from "@openmeld/local-service/windows-artifact-script";
import { windowsPublisherNameSchema } from "@openmeld/schemas";

const SIGNATURE_VERIFIED = "OPENMELD_AUTHENTICODE_VERIFIED";
const VERIFY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
${WINDOWS_ARTIFACT_SIGNATURE_FUNCTION}
$r = ConvertFrom-Json ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:OPENMELD_SIGNATURE_REQUEST)))
Assert-OpenMeldArtifactSignature $r.path $r.publisherName
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

/** Shared artifact verifier: every missing/failed/ambiguous OS result rejects. */
export async function verifyWindowsArtifactSignature(
  path: string,
  publisherName: string,
  execute: ExecuteSignatureCheck = promisify(execFile)
): Promise<void> {
  const publisher = windowsPublisherNameSchema.parse(publisherName);
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
