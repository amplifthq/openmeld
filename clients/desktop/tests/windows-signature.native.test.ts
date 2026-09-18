import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  powerShellEncodedArguments,
  resolveWindowsPowerShellPath,
} from "@openmeld/adapter-core/windows-system";
import { describe, expect, it } from "vitest";
import { verifyWindowsDesktopSignature } from "../src/main/update/windows-signature";

// OS contract only. Does not create/import a certificate, sign code, run an
// installer, contact OpenMeld, or claim an OpenMeld production signature passed.
describe.skipIf(process.platform !== "win32")(
  "Windows Authenticode native boundary",
  () => {
    it("accepts the OS-signed system executable's actual publisher but rejects a different publisher and an unsigned file", async () => {
      const system = resolveWindowsPowerShellPath();
      const script = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
$s = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath (Join-Path $PSHOME 'powershell.exe') -ErrorAction Stop
@{ status=[string]$s.Status; publisherName=$s.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) } | ConvertTo-Json -Compress
`;
      const result = await promisify(execFile)(
        system,
        powerShellEncodedArguments(script),
        { windowsHide: true, timeout: 30_000, maxBuffer: 16_384 }
      );
      const signed = JSON.parse(result.stdout);
      expect(signed.status).toBe("Valid");
      expect(signed.publisherName).toBeTypeOf("string");
      await verifyWindowsDesktopSignature(system, signed.publisherName);
      await expect(
        verifyWindowsDesktopSignature(
          system,
          "OpenMeld deliberately wrong publisher fixture"
        )
      ).rejects.toThrow();
      const root = await mkdtemp(join(tmpdir(), "OpenMeld unsigned 中文 & "));
      try {
        const unsigned = join(root, "unsigned.exe");
        await writeFile(unsigned, "This test file is never executed.");
        await expect(
          verifyWindowsDesktopSignature(unsigned, signed.publisherName)
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 120_000);
  }
);
