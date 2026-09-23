import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  powerShellEncodedArguments,
  resolveWindowsPowerShellPath,
} from "@openmeld/adapter-core/windows-system";
import { verifyCliBinaryCodeSignature } from "@openmeld/local-service/cli-binary-update-artifact";
import { verifyWindowsArtifactSignature } from "@openmeld/local-service/windows-artifact-signature";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

// OS contract only. Does not create/import a certificate, sign code, run an
// installer, contact OpenMeld, or claim an OpenMeld production signature passed.
describe.skipIf(process.platform !== "win32")(
  "Windows Authenticode native boundary",
  () => {
    it("accepts the OS-signed system executable's actual publisher but rejects a different publisher and an unsigned file", async () => {
      const system = resolveWindowsPowerShellPath();
      const script = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
Import-Module -Name (Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1') -ErrorAction Stop
$s = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath (Join-Path $PSHOME 'powershell.exe') -ErrorAction Stop
@{ status=[string]$s.Status; publisherName=$s.SignerCertificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false) } | ConvertTo-Json -Compress
`;
      const result = await promisify(execFile)(
        system,
        powerShellEncodedArguments(script),
        {
          // A PS7 -> Node -> PS5.1 launch does not perform PowerShell's direct
          // WinPSModulePath translation. Let PS5.1 construct its own defaults.
          env: Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => key.toUpperCase() !== "PSMODULEPATH"
            )
          ),
          windowsHide: true,
          timeout: 30_000,
          maxBuffer: 16_384,
        }
      );
      const signed = JSON.parse(result.stdout);
      expect(signed.status).toBe("Valid");
      expect(signed.publisherName).toBeTypeOf("string");
      // Exercise the production boundary with an intentionally incompatible
      // parent module path; the capture above remains an independent OS read.
      vi.stubEnv("PSModulePath", "C:\\OpenMeld-test-missing-PS7-modules");
      await verifyWindowsArtifactSignature(system, signed.publisherName);
      const artifact = {
        url: "https://fixture.invalid/never-downloaded.exe",
        sha256: "a".repeat(64),
        sizeBytes: 1,
      };
      const cliInput = {
        artifactPath: system,
        release: {
          ...artifact,
          windows: {
            publisherName: signed.publisherName,
            processHelper: artifact,
          },
        },
        runCommand: () =>
          Promise.reject(new Error("Windows must not invoke macOS codesign")),
      };
      await verifyCliBinaryCodeSignature(cliInput);
      await expect(
        verifyCliBinaryCodeSignature({ ...cliInput, release: artifact })
      ).rejects.toThrow("must declare their publisher");
      await expect(
        verifyWindowsArtifactSignature(
          system,
          "OpenMeld deliberately wrong publisher fixture"
        )
      ).rejects.toThrow();
      const root = await mkdtemp(join(tmpdir(), "OpenMeld unsigned 中文 & "));
      try {
        const unsigned = join(root, "unsigned.exe");
        await writeFile(unsigned, "This test file is never executed.");
        await expect(
          verifyWindowsArtifactSignature(unsigned, signed.publisherName)
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }, 120_000);
  }
);
