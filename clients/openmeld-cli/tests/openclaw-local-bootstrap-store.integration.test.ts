import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  readOpenClawLocalBootstrapState,
  resolveOpenClawLocalBootstrapPaths,
  writeOpenClawLocalBootstrapState,
} from "../src/provider-hosts/openclaw/local-bootstrap-store";
import { withTempHome } from "./helpers/fs";

describe("openclaw local bootstrap store", () => {
  it("resolves OpenMeld-owned provider paths under the device providers tree", async () => {
    await withTempHome((home) =>
      Promise.resolve().then(() => {
        const paths = resolveOpenClawLocalBootstrapPaths({
          openMeldProfileId: "agt_demo_profile",
        });

        expect(paths.profileRoot).toBe(
          join(
            home,
            ".openmeld",
            "device",
            "providers",
            "openclaw",
            "profiles",
            "agt_demo_profile"
          )
        );
        expect(paths.workspaceDir).toBe(join(paths.profileRoot, "workspace"));
        expect(paths.bootstrapPath).toBe(
          join(paths.profileRoot, "bootstrap.json")
        );
      })
    );
  });

  it("writes and reads the minimal bootstrap state", async () => {
    await withTempHome(async () => {
      await writeOpenClawLocalBootstrapState({
        openMeldProfileId: "agt_demo_profile",
        state: {
          agentId: "openmeld-demo-profile",
          bootstrapVersion: 1,
        },
      });

      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).resolves.toEqual({
        agentId: "openmeld-demo-profile",
        bootstrapVersion: 1,
      });
    });
  });

  it("stores versioned file payload under the dedicated bootstrap path", async () => {
    await withTempHome(async () => {
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: "agt_demo_profile",
      });
      await writeOpenClawLocalBootstrapState({
        openMeldProfileId: "agt_demo_profile",
        state: {
          agentId: "openmeld-demo-profile",
          bootstrapVersion: 1,
        },
      });

      const raw = JSON.parse(await readFile(paths.bootstrapPath, "utf8")) as {
        v?: number;
        agentId?: string;
        bootstrapVersion?: number;
      };
      expect(raw).toEqual({
        v: 1,
        agentId: "openmeld-demo-profile",
        bootstrapVersion: 1,
      });
    });
  });

  it("uses a unique temp path suffix even when writes share the same timestamp", async () => {
    await withTempHome(async () => {
      vi.resetModules();
      const observedTempPaths: string[] = [];
      const mockedNow = vi
        .spyOn(Date, "now")
        .mockReturnValue(1_700_000_000_000);
      try {
        vi.doMock("node:fs/promises", async () => {
          const actual =
            await vi.importActual<typeof import("node:fs/promises")>(
              "node:fs/promises"
            );
          return {
            ...actual,
            writeFile: vi.fn(
              async (...args: Parameters<typeof actual.writeFile>) => {
                observedTempPaths.push(String(args[0]));
                return await actual.writeFile(...args);
              }
            ),
          };
        });

        const module = await import(
          "../src/provider-hosts/openclaw/local-bootstrap-store"
        );
        await module.writeOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
          state: {
            agentId: "agent-a",
            bootstrapVersion: 1,
          },
        });
        await module.writeOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
          state: {
            agentId: "agent-b",
            bootstrapVersion: 1,
          },
        });
      } finally {
        mockedNow.mockRestore();
        vi.doUnmock("node:fs/promises");
        vi.resetModules();
      }

      expect(observedTempPaths).toHaveLength(2);
      expect(observedTempPaths[0]).not.toBe(observedTempPaths[1]);
    });
  });

  it("throws a dedicated version mismatch error when the bootstrap file version is unsupported", async () => {
    await withTempHome(async () => {
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: "agt_demo_profile",
      });
      await mkdir(paths.profileRoot, { recursive: true });
      await writeFile(
        paths.bootstrapPath,
        `${JSON.stringify({
          agentId: "openmeld-demo-profile",
          bootstrapVersion: 1,
          v: 2,
        })}\n`,
        "utf8"
      );

      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).rejects.toMatchObject({
        actualVersion: 2,
        code: "openclaw.bootstrap.version_mismatch",
        expectedVersion: 1,
        name: "OpenClawLocalBootstrapStoreError",
      });
      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).rejects.toThrow("expected v1, found v2");
    });
  });

  it("keeps missing version metadata in the generic invalid bucket", async () => {
    await withTempHome(async () => {
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: "agt_demo_profile",
      });
      await mkdir(paths.profileRoot, { recursive: true });
      await writeFile(
        paths.bootstrapPath,
        `${JSON.stringify({
          agentId: "openmeld-demo-profile",
          bootstrapVersion: 1,
        })}\n`,
        "utf8"
      );

      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.state_invalid",
        name: "OpenClawLocalBootstrapStoreError",
      });
      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).rejects.not.toMatchObject({
        code: "openclaw.bootstrap.version_mismatch",
      });
    });
  });

  it("keeps missing agentId in the generic invalid bucket", async () => {
    await withTempHome(async () => {
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: "agt_demo_profile",
      });
      await mkdir(paths.profileRoot, { recursive: true });
      await writeFile(
        paths.bootstrapPath,
        `${JSON.stringify({
          bootstrapVersion: 1,
          v: 1,
        })}\n`,
        "utf8"
      );

      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.state_invalid",
        name: "OpenClawLocalBootstrapStoreError",
      });
    });
  });

  it("keeps invalid bootstrapVersion in the generic invalid bucket", async () => {
    await withTempHome(async () => {
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: "agt_demo_profile",
      });
      await mkdir(paths.profileRoot, { recursive: true });
      await writeFile(
        paths.bootstrapPath,
        `${JSON.stringify({
          agentId: "openmeld-demo-profile",
          bootstrapVersion: 0,
          v: 1,
        })}\n`,
        "utf8"
      );

      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.state_invalid",
        name: "OpenClawLocalBootstrapStoreError",
      });
    });
  });

  it("keeps invalid JSON in the generic invalid bucket", async () => {
    await withTempHome(async () => {
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: "agt_demo_profile",
      });
      await mkdir(paths.profileRoot, { recursive: true });
      await writeFile(paths.bootstrapPath, "{not-json}\n", "utf8");

      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: "agt_demo_profile",
        })
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.state_invalid",
        name: "OpenClawLocalBootstrapStoreError",
      });
    });
  });
});
