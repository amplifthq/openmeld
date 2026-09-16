import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { runConnectionSetup } from "../src/main/computer-connection";

describe("computer setup process outcome", () => {
  it.each([
    "rejects",
    "pending",
  ])("keeps completion authoritative when the progress observer %s", async (observer) => {
    const result = runConnectionSetup(
      process.execPath,
      [
        "-e",
        `
      console.log(JSON.stringify({type:'line',code:'prepare.session.progress.refresh_service',text:'Starting Service',data:{state:'started'}}));
      console.log(JSON.stringify({type:'result',code:'setup.complete'}));
    `,
      ],
      { ...process.env, OPENMELD_HOME: "/unused-disposable-process-test" },
      {
        onProgress: () =>
          observer === "rejects"
            ? Promise.reject(new Error("Observer failed"))
            : new Promise(() => undefined),
      }
    );
    await expect(result).resolves.toBeUndefined();
  });
  it("continues reading later output while a progress subscriber remains pending", async () => {
    const home = await mkdtemp(join(tmpdir(), "desktop-progress-test-"));
    const marker = join(home, "continue");
    try {
      await expect(
        runConnectionSetup(
          process.execPath,
          [
            "-e",
            `
        const fs = require('node:fs');
        fs.watch(${JSON.stringify(home)}, () => {
          if (!fs.existsSync(${JSON.stringify(home)})) process.exit(1);
          if (!fs.existsSync(${JSON.stringify(marker)})) return;
          console.log(JSON.stringify({type:'result',code:'setup.complete'}));
          process.exit(0);
        });
        console.log(JSON.stringify({type:'line',code:'prepare.session.progress.refresh_service',text:'Starting Service',data:{state:'started'}}));
      `,
          ],
          { ...process.env, OPENMELD_HOME: home },
          {
            onProgress: async () => {
              await writeFile(marker, "continue");
              await new Promise(() => undefined);
            },
          }
        )
      ).resolves.toBeUndefined();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
  it.each([
    { code: 0, event: "setup.complete", succeeds: true },
    { code: 1, event: "setup.complete", succeeds: false },
    { code: 0, event: "setup.started", succeeds: false },
    { code: 0, event: "setup.complete", succeeds: true, compact: true },
  ])("requires successful exit and completion evidence: $code / $event", async ({
    code,
    event,
    succeeds,
    compact,
  }) => {
    const result = runConnectionSetup(
      process.execPath,
      [
        "-e",
        `console.log(JSON.stringify(${JSON.stringify(compact ? { t: "result", c: event } : { type: "result", code: event })}));process.exit(${code});`,
      ],
      { ...process.env, OPENMELD_HOME: "/unused-disposable-process-test" }
    );
    if (succeeds) {
      await expect(result).resolves.toBeUndefined();
    } else {
      const error = await result.catch(
        (failure: Error & { diagnosticsPath: string }) => failure
      );
      expect(error).toMatchObject({
        message: expect.stringContaining("could not finish connecting"),
      });
      if (error) {
        await rm(dirname(error.diagnosticsPath), {
          recursive: true,
          force: true,
        });
      }
    }
  });

  it("reports owner progress before exit and preserves a bounded redacted failure file", async () => {
    const home = await mkdtemp(join(tmpdir(), "desktop-connection-test-"));
    const marker = join(home, "continue");
    let diagnosticDirectory: string | undefined;
    try {
      const result = runConnectionSetup(
        process.execPath,
        [
          "-e",
          `
        const fs = require('node:fs');
        fs.watch(${JSON.stringify(home)}, () => {
          if (!fs.existsSync(${JSON.stringify(home)})) process.exit(1);
          if (!fs.existsSync(${JSON.stringify(marker)})) return;
          console.error('Native helper failed. Authorization: Bearer native-secret');
          console.log(JSON.stringify({type:'error',code:'prepare.auth.account_mismatch',message:'Account changed. Authorization: Bearer secret-token'}));
          process.exit(1);
        });
        console.log(JSON.stringify({type:'line',code:'prepare.session.progress.refresh_service',text:'Starting OpenMeld Service...',data:{state:'started'}}));
      `,
        ],
        { ...process.env, OPENMELD_HOME: home },
        {
          onProgress: async (event) => {
            if (event.code === "prepare.session.progress.refresh_service") {
              expect(event.message).toBe("Starting OpenMeld Service...");
              await writeFile(marker, "continue");
            }
          },
        }
      );
      const error = await result.catch(
        (failure: Error & { diagnosticsPath: string }) => failure
      );
      expect(error).toMatchObject({
        message: "Account changed. Authorization: Bearer [redacted]",
      });
      if (!error) {
        throw new Error("Expected setup failure");
      }
      diagnosticDirectory = dirname(error.diagnosticsPath);
      const diagnostic = await readFile(error.diagnosticsPath, "utf8");
      expect(diagnostic).toContain("prepare.auth.account_mismatch");
      expect(diagnostic).not.toContain("secret-token");
      expect(diagnostic).toContain(
        "Native helper failed. Authorization: Bearer [redacted]"
      );
      expect(diagnostic).not.toContain("native-secret");
      await expect(
        readFile(join(diagnosticDirectory, "setup.log"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(home, { recursive: true, force: true });
      if (diagnosticDirectory) {
        await rm(diagnosticDirectory, { recursive: true, force: true });
      }
    }
  });
});
