import { readFile, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { ensureDaemonRuntimePaths } from "../src/local-service/state/daemon-device-id";
import { ensureDaemonRuntimeContractState } from "../src/local-service/state/runtime-contract-guard";
import { withTempHome } from "./helpers/fs";

vi.mock("../src/strategy-constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/strategy-constants")>()),
  DAEMON_RUNTIME_CONTRACT_EPOCH: "a-new-wire-protocol",
}));

describe("local state compatibility", () => {
  it("keeps existing local data when only the network protocol changes", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const meta = JSON.stringify({
        v: 1,
        schema: "daemon.runtime.contract.meta",
        contractEpoch: "runtime-transport-epoch-2026-07-default-project",
        updatedAt: "2026-09-01T00:00:00.000Z",
      });
      await writeFile(runtimePaths.contractMetaPath, meta);
      await writeFile(runtimePaths.contextStorePath, '{"conversation":"keep"}');
      expect(
        (await ensureDaemonRuntimeContractState({ runtimePaths })).action
      ).toBe("none");
      expect(await readFile(runtimePaths.contextStorePath, "utf8")).toBe(
        '{"conversation":"keep"}'
      );
      expect(await readFile(runtimePaths.contractMetaPath, "utf8")).toBe(meta);
    });
  });

  it("does not clean runtime data from a newer file format", async () => {
    await withTempHome(async () => {
      const runtimePaths = await ensureDaemonRuntimePaths();
      const meta =
        '{"v":2,"schema":"daemon.runtime.contract.meta","future":"keep"}';
      await writeFile(runtimePaths.contractMetaPath, meta);
      await writeFile(runtimePaths.contextStorePath, '{"conversation":"keep"}');
      await expect(
        ensureDaemonRuntimeContractState({ runtimePaths })
      ).rejects.toThrow("newer local runtime state");
      expect(await readFile(runtimePaths.contextStorePath, "utf8")).toBe(
        '{"conversation":"keep"}'
      );
      expect(await readFile(runtimePaths.contractMetaPath, "utf8")).toBe(meta);
    });
  });
});
