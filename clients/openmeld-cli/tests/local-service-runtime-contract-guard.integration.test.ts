import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DAEMON_RUNTIME_CONTRACT_EPOCH } from "../src/local-service/core/constants";
import { ensureDaemonRuntimePaths } from "../src/local-service/state/daemon-device-id";
import {
  ensureDaemonRuntimeContractState,
  readDaemonRuntimeContractMeta,
  readDaemonRuntimeContractRepairReport,
} from "../src/local-service/state/runtime-contract-guard";
import { withTempHome } from "./helpers/fs";

describe("local service runtime contract guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("initializes meta on fresh runtime and does not create repair report", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const result = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:00:00.000Z",
      });

      expect(result.action).toBe("fresh_init");
      expect(result.meta.contractEpoch).toBe(DAEMON_RUNTIME_CONTRACT_EPOCH);

      const report = await readDaemonRuntimeContractRepairReport();
      expect(report).toBeNull();
    });
  });

  it("reads runtime contract meta without mutating runtime state", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const meta = {
        schema: "daemon.runtime.contract.meta",
        v: 1,
        contractEpoch: "daemon-runtime-epoch-previous",
        updatedAt: "2026-03-03T00:00:00.000Z",
      };
      await writeFile(
        runtimePaths.contractMetaPath,
        `${JSON.stringify(meta, null, 2)}\n`,
        "utf8"
      );

      const observed = await readDaemonRuntimeContractMeta();

      expect(observed).toEqual(meta);
      await expect(
        readFile(runtimePaths.contractMetaPath, "utf8")
      ).resolves.toBe(`${JSON.stringify(meta, null, 2)}\n`);
      expect(await readDaemonRuntimeContractRepairReport()).toBeNull();
    });
  });

  it("returns null when runtime contract meta is absent", async () => {
    await withTempHome(async () => {
      await ensureDaemonRuntimePaths();

      await expect(readDaemonRuntimeContractMeta()).resolves.toBeNull();
    });
  });

  it("repairs legacy state when meta is missing and runtime cache files exist", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const legacyContextStore = runtimePaths.contextStorePath;
      const legacyLedgerState = join(runtimePaths.ledgerRootPath, "state.json");

      await mkdir(runtimePaths.ledgerRootPath, { recursive: true });
      await writeFile(legacyContextStore, '{\n  "k": "v"\n}\n', "utf8");
      await writeFile(legacyLedgerState, '{\n  "v": 1\n}\n', "utf8");

      const result = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:00:00.000Z",
      });

      expect(result.action).toBe("repair_applied");
      if (result.action !== "repair_applied") {
        return;
      }
      expect(result.reason).toBe("legacy_state_without_meta");
      expect(result.report.status).toBe("applied");
      expect(result.report.fromEpoch).toBeNull();
      expect(result.report.toEpoch).toBe(DAEMON_RUNTIME_CONTRACT_EPOCH);
      expect(result.report.cleanedPaths).toContain(legacyContextStore);
      expect(result.report.cleanedPaths).toContain(legacyLedgerState);
      expect(result.report.backupPaths.length).toBeGreaterThanOrEqual(2);

      await expect(access(legacyContextStore)).rejects.toThrow();
      await expect(access(legacyLedgerState)).rejects.toThrow();

      for (const backupPath of result.report.backupPaths) {
        await expect(access(backupPath)).resolves.toBeUndefined();
      }
    });
  });

  it("repairs runtime cache on contract epoch mismatch", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const oldEpoch = "daemon-runtime-epoch-2026-02-20";
      const oldMeta = {
        schema: "daemon.runtime.contract.meta",
        v: 1,
        contractEpoch: oldEpoch,
        updatedAt: "2026-02-20T00:00:00.000Z",
      };
      await writeFile(
        runtimePaths.contractMetaPath,
        `${JSON.stringify(oldMeta, null, 2)}\n`,
        "utf8"
      );
      const legacyLedgerState = join(runtimePaths.ledgerRootPath, "state.json");
      await writeFile(legacyLedgerState, '{\n  "v": 1\n}\n', "utf8");

      const result = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:00:00.000Z",
      });

      expect(result.action).toBe("repair_applied");
      if (result.action !== "repair_applied") {
        return;
      }
      expect(result.reason).toBe("contract_epoch_mismatch");
      expect(result.report.fromEpoch).toBe(oldEpoch);
      expect(result.report.toEpoch).toBe(DAEMON_RUNTIME_CONTRACT_EPOCH);
      expect(result.report.cleanedPaths).toContain(legacyLedgerState);
    });
  });

  it("preserves runtime data when metadata cannot be read", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const legacyContextStore = runtimePaths.contextStorePath;
      await writeFile(legacyContextStore, '{\n  "k": "v"\n}\n', "utf8");

      const invalidRuntimePaths = {
        ...runtimePaths,
        contractMetaPath: runtimePaths.dataRootPath,
      };

      await expect(
        ensureDaemonRuntimeContractState({
          runtimePaths: invalidRuntimePaths,
          nowIso: "2026-03-04T00:00:00.000Z",
        })
      ).rejects.toEqual(
        expect.objectContaining({
          code: "EISDIR",
        })
      );

      const report = await readDaemonRuntimeContractRepairReport();
      expect(report).toBeNull();
      expect(await readFile(legacyContextStore, "utf8")).toBe(
        '{\n  "k": "v"\n}\n'
      );
    });
  });

  it("preserves the underlying read error instead of suggesting destructive repair", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      await writeFile(
        runtimePaths.contextStorePath,
        '{\n  "k": "v"\n}\n',
        "utf8"
      );

      const invalidRuntimePaths = {
        ...runtimePaths,
        contractMetaPath: runtimePaths.dataRootPath,
      };

      const thrown = await ensureDaemonRuntimeContractState({
        runtimePaths: invalidRuntimePaths,
        nowIso: "2026-03-04T00:00:00.000Z",
      }).catch((error) => error);

      expect(thrown).toBeInstanceOf(Error);
      const message = thrown instanceof Error ? thrown.message : "";
      expect(message).toContain("EISDIR");
      expect(message).not.toContain("service repair");
    });
  });

  it("returns no-op when epoch already matches", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const meta = {
        schema: "daemon.runtime.contract.meta",
        v: 1,
        contractEpoch: DAEMON_RUNTIME_CONTRACT_EPOCH,
        updatedAt: "2026-03-04T00:00:00.000Z",
      };
      await writeFile(
        runtimePaths.contractMetaPath,
        `${JSON.stringify(meta, null, 2)}\n`,
        "utf8"
      );

      const result = await ensureDaemonRuntimeContractState({
        runtimePaths,
      });

      expect(result.action).toBe("none");
      expect(result.meta.contractEpoch).toBe(DAEMON_RUNTIME_CONTRACT_EPOCH);
      const persisted = JSON.parse(
        await readFile(runtimePaths.contractMetaPath, "utf8")
      ) as { contractEpoch: string };
      expect(persisted.contractEpoch).toBe(DAEMON_RUNTIME_CONTRACT_EPOCH);
    });
  });

  it("repairs only once for the same runtime state and then becomes no-op", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      await writeFile(
        runtimePaths.contextStorePath,
        '{\n  "k": "v"\n}\n',
        "utf8"
      );

      const first = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:00:00.000Z",
      });
      expect(first.action).toBe("repair_applied");

      const second = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:01:00.000Z",
      });
      expect(second.action).toBe("none");
      expect(second.meta.contractEpoch).toBe(DAEMON_RUNTIME_CONTRACT_EPOCH);
    });
  });

  it("keeps non-runtime files untouched when runtime cleanup is applied", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const openMeldHome = process.env.OPENMELD_HOME;
      if (!openMeldHome) {
        throw new Error("OPENMELD_HOME is required in test");
      }

      const deviceIdContent = "device-fixed-id\n";
      const configPath = join(openMeldHome, "config.json");
      const configContent =
        '{\n  "v": 1,\n  "updatedAt": "2026-03-04T00:00:00.000Z"\n}\n';
      const authDir = join(openMeldHome, "auth");
      const authSessionPath = join(authDir, "session.json");
      const authSessionContent =
        '{\n  "schema": "openmeld.auth.session",\n  "v": 1,\n  "accessToken": "token"\n}\n';

      await mkdir(authDir, { recursive: true });
      await writeFile(runtimePaths.deviceIdPath, deviceIdContent, "utf8");
      await writeFile(configPath, configContent, "utf8");
      await writeFile(authSessionPath, authSessionContent, "utf8");
      await writeFile(
        runtimePaths.contextStorePath,
        '{\n  "k": "v"\n}\n',
        "utf8"
      );

      const result = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:00:00.000Z",
      });
      expect(result.action).toBe("repair_applied");

      await expect(readFile(runtimePaths.deviceIdPath, "utf8")).resolves.toBe(
        deviceIdContent
      );
      await expect(readFile(configPath, "utf8")).resolves.toBe(configContent);
      await expect(readFile(authSessionPath, "utf8")).resolves.toBe(
        authSessionContent
      );
    });
  });

  it("treats malformed contract meta as legacy state and repairs runtime cache", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      await writeFile(runtimePaths.contractMetaPath, "{invalid-json", "utf8");
      await writeFile(
        runtimePaths.contextStorePath,
        '{\n  "k": "v"\n}\n',
        "utf8"
      );

      const result = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:00:00.000Z",
      });

      expect(result.action).toBe("repair_applied");
      if (result.action !== "repair_applied") {
        return;
      }
      expect(result.reason).toBe("legacy_state_without_meta");
      expect(result.report.cleanedPaths).toContain(
        runtimePaths.contextStorePath
      );
    });
  });

  it("returns null when repair report file is malformed", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      await writeFile(
        runtimePaths.contractRepairReportPath,
        "{bad-json",
        "utf8"
      );

      const report = await readDaemonRuntimeContractRepairReport();
      expect(report).toBeNull();
    });
  });

  it("allows legacy migration after the metadata read path is corrected", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const legacyContextStore = runtimePaths.contextStorePath;
      const legacyLedgerState = join(runtimePaths.ledgerRootPath, "state.json");
      await writeFile(legacyContextStore, '{\n  "k": "v"\n}\n', "utf8");
      await writeFile(legacyLedgerState, '{\n  "v": 1\n}\n', "utf8");

      const invalidRuntimePaths = {
        ...runtimePaths,
        contractMetaPath: runtimePaths.dataRootPath,
      };

      await expect(
        ensureDaemonRuntimeContractState({
          runtimePaths: invalidRuntimePaths,
          nowIso: "2026-03-04T00:00:00.000Z",
        })
      ).rejects.toEqual(
        expect.objectContaining({
          code: "EISDIR",
        })
      );

      const failedReport = await readDaemonRuntimeContractRepairReport();
      expect(failedReport).toBeNull();
      expect(await readFile(legacyLedgerState, "utf8")).toBe(
        '{\n  "v": 1\n}\n'
      );

      const recovered = await ensureDaemonRuntimeContractState({
        runtimePaths,
        nowIso: "2026-03-04T00:01:00.000Z",
      });
      expect(recovered.action).toBe("repair_applied");
    });
  });
});
