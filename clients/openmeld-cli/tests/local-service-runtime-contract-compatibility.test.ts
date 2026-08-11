import { describe, expect, it, vi } from "vitest";
import { resolveDaemonRuntimeContractCompatibility } from "../src/local-service/lifecycle/daemon-runtime-contract-compatibility";

const currentMeta = {
  schema: "daemon.runtime.contract.meta" as const,
  v: 1 as const,
  contractEpoch: "daemon-runtime-epoch-current",
  updatedAt: "2026-03-04T00:00:00.000Z",
};

describe("local service runtime contract compatibility", () => {
  it("marks matching observed runtime contract meta as compatible", async () => {
    await expect(
      resolveDaemonRuntimeContractCompatibility({
        expectedEpoch: "daemon-runtime-epoch-current",
        readMeta: async () => currentMeta,
        runtimeStatus: "running",
      })
    ).resolves.toEqual({
      status: "compatible",
      expectedEpoch: "daemon-runtime-epoch-current",
      observedEpoch: "daemon-runtime-epoch-current",
      updatedAt: "2026-03-04T00:00:00.000Z",
      reasonCode: "daemon.runtime_contract.compatible",
    });
  });

  it("marks missing observed runtime contract meta as missing for a running local service", async () => {
    await expect(
      resolveDaemonRuntimeContractCompatibility({
        expectedEpoch: "daemon-runtime-epoch-current",
        readMeta: async () => null,
        runtimeStatus: "running",
      })
    ).resolves.toEqual({
      status: "missing",
      expectedEpoch: "daemon-runtime-epoch-current",
      observedEpoch: null,
      updatedAt: null,
      reasonCode: "daemon.runtime_contract.missing",
    });
  });

  it("marks an older observed runtime contract epoch as mismatch", async () => {
    await expect(
      resolveDaemonRuntimeContractCompatibility({
        expectedEpoch: "daemon-runtime-epoch-current",
        readMeta: async () => ({
          ...currentMeta,
          contractEpoch: "daemon-runtime-epoch-old",
        }),
        runtimeStatus: "running",
      })
    ).resolves.toEqual({
      status: "mismatch",
      expectedEpoch: "daemon-runtime-epoch-current",
      observedEpoch: "daemon-runtime-epoch-old",
      updatedAt: "2026-03-04T00:00:00.000Z",
      reasonCode: "daemon.runtime_contract.mismatch",
    });
  });

  it("marks read failures as unavailable without throwing", async () => {
    await expect(
      resolveDaemonRuntimeContractCompatibility({
        expectedEpoch: "daemon-runtime-epoch-current",
        readMeta: () => {
          throw new Error("permission denied");
        },
        runtimeStatus: "running",
      })
    ).resolves.toEqual({
      status: "unavailable",
      expectedEpoch: "daemon-runtime-epoch-current",
      observedEpoch: null,
      updatedAt: null,
      reasonCode: "daemon.runtime_contract.unavailable",
      errorMessage: "permission denied",
    });
  });

  it("does not read runtime contract meta when no running local service can be judged", async () => {
    const readMeta = vi.fn(async () => currentMeta);

    await expect(
      resolveDaemonRuntimeContractCompatibility({
        expectedEpoch: "daemon-runtime-epoch-current",
        readMeta,
        runtimeStatus: "not_running",
      })
    ).resolves.toEqual({
      status: "not_observed",
      expectedEpoch: "daemon-runtime-epoch-current",
      observedEpoch: null,
      updatedAt: null,
      reasonCode: "daemon.runtime_contract.not_observed",
    });
    expect(readMeta).not.toHaveBeenCalled();
  });
});
