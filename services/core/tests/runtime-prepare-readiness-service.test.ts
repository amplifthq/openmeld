import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { describe, expect, it, vi } from "vitest";
import type { AcceptedRuntimeAgentControllerReport } from "../src/runtime-registry/application/runtime-agent-controller-report-service";
import type { RuntimeLookupStore } from "../src/runtime-registry/application/runtime-lookup-service";
import {
  type RuntimeAgentControllerReportReadStore,
  resolveRuntimePrepareReadiness,
} from "../src/runtime-registry/application/runtime-prepare-readiness-service";

describe("runtime prepare readiness service", () => {
  it("returns not ready for a missing Runtime without reading agent controller reports", async () => {
    const reportReadStore = createReportReadStore();

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 2000,
        reportReadStore,
        runtimeLookupInput: createOwnerAccountLookupInput(),
        runtimeLookupStore: createMissingRuntimeLookupStore(),
      })
    ).resolves.toMatchObject({
      agentControllerReportsRead: false,
      reason: "runtime_missing",
      status: "not_ready",
      summary: {
        displayState: "unknown",
        ready: false,
        reasonCodes: ["runtime.missing"],
      },
    });

    expect(
      reportReadStore.readCurrentRuntimeAgentControllerReports
    ).not.toHaveBeenCalled();
  });

  it("returns not ready for an invalid Runtime identity without reading agent controller reports", async () => {
    const reportReadStore = createReportReadStore();

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 2000,
        reportReadStore,
        runtimeLookupInput: createRuntimeLookupInput({
          deviceId: "device-1",
          lane: "openmeld-dev",
          owner: {
            id: "principal-1",
            kind: "owner_principal",
          },
        }),
        runtimeLookupStore: createMissingRuntimeLookupStore(),
      })
    ).resolves.toMatchObject({
      agentControllerReportsRead: false,
      reason: "openmeld_service_runtime_identity_invalid",
      status: "not_ready",
      summary: {
        ready: false,
        reasonCodes: ["runtime.identity_invalid"],
      },
    });

    expect(
      reportReadStore.readCurrentRuntimeAgentControllerReports
    ).not.toHaveBeenCalled();
  });

  it("returns not ready for a lookup-derived non-opaque openMeldServiceRuntimeId without reading agent controller reports", async () => {
    const reportReadStore = createReportReadStore();
    const runtimeLookupInput = createOwnerAccountLookupInput();

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 2000,
        reportReadStore,
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "owner_account:owner-1:device-1:openmeld-dev",
        },
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore({
          openMeldServiceRuntimeId: authorityRuntimeId({
            lookupInput: runtimeLookupInput,
            value: "runtime_opaque_1",
          }),
        }),
      })
    ).resolves.toMatchObject({
      agentControllerReportsRead: false,
      reason: "openmeld_service_runtime_id_invalid",
      status: "not_ready",
      summary: {
        ready: false,
        reasonCodes: ["runtime.id_invalid"],
      },
    });

    expect(
      reportReadStore.readCurrentRuntimeAgentControllerReports
    ).not.toHaveBeenCalled();
  });

  it("returns not ready when supplied openMeldServiceRuntimeId does not match Runtime lookup", async () => {
    const reportReadStore = createReportReadStore();
    const runtimeLookupInput = createOwnerAccountLookupInput();

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 2000,
        reportReadStore,
        openMeldServiceRuntimeId: authorityRuntimeId({
          lookupInput: runtimeLookupInput,
          value: "runtime_submitted",
        }),
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore({
          openMeldServiceRuntimeId: authorityRuntimeId({
            lookupInput: runtimeLookupInput,
            value: "runtime_registered",
          }),
        }),
      })
    ).resolves.toMatchObject({
      agentControllerReportsRead: false,
      reason: "openmeld_service_runtime_id_mismatch",
      status: "not_ready",
      summary: {
        ready: false,
        reasonCodes: ["runtime.id_mismatch"],
      },
    });

    expect(
      reportReadStore.readCurrentRuntimeAgentControllerReports
    ).not.toHaveBeenCalled();
  });

  it("returns explicit missing agent controller report when Runtime exists but no report exists", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportReadStore = createReportReadStore();

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 2000,
        reportReadStore,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore({
          openMeldServiceRuntimeId,
        }),
      })
    ).resolves.toMatchObject({
      agentControllerReportsRead: true,
      nonRunnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          reasonCodes: ["runtime.agent_controller_report_missing"],
          status: "missing",
        },
      ],
      reason: "runtime_not_ready",
      runnableCapabilities: [],
      status: "not_ready",
      summary: {
        displayState: "needs_prepare",
        ready: false,
      },
    });

    expect(
      reportReadStore.readCurrentRuntimeAgentControllerReports
    ).toHaveBeenCalledWith({
      agentControllerRefs: ["builtin:codex"],
      openMeldServiceRuntimeId,
    });
  });

  it("returns invalid capability evidence without passing invalid refs to storage", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportReadStore = createReportReadStore();

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["codex"],
        nowMs: 2000,
        reportReadStore,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore({
          openMeldServiceRuntimeId,
        }),
      })
    ).resolves.toMatchObject({
      agentControllerReportsRead: false,
      nonRunnableCapabilities: [
        {
          agentControllerRef: "codex",
          reasonCodes: ["runtime.agent_controller_ref_invalid"],
          status: "invalid",
        },
      ],
      reason: "runtime_not_ready",
      status: "not_ready",
      summary: {
        ready: false,
      },
    });

    expect(
      reportReadStore.readCurrentRuntimeAgentControllerReports
    ).not.toHaveBeenCalled();
  });

  it("returns not ready for a stale agent controller report", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 5000,
        reportReadStore: createReportReadStore([
          buildAgentControllerReport({
            expiresAtMs: 5000,
            openMeldServiceRuntimeId,
            status: "ready",
          }),
        ]),
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore({
          openMeldServiceRuntimeId,
        }),
      })
    ).resolves.toMatchObject({
      nonRunnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          status: "stale",
        },
      ],
      reason: "runtime_not_ready",
      status: "not_ready",
      summary: {
        displayState: "stale",
        ready: false,
      },
    });
  });

  it.each([
    {
      expectedDisplayState: "needs_prepare",
      status: "disabled",
    },
    {
      expectedDisplayState: "unavailable",
      status: "unavailable",
    },
    {
      expectedDisplayState: "unknown",
      status: "unknown",
    },
  ] as const)("returns not ready for a $status agent controller report", async ({
    expectedDisplayState,
    status,
  }) => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: `runtime_${status}`,
    });

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 2000,
        reportReadStore: createReportReadStore([
          buildAgentControllerReport({
            openMeldServiceRuntimeId,
            status,
          }),
        ]),
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore({
          openMeldServiceRuntimeId,
        }),
      })
    ).resolves.toMatchObject({
      nonRunnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          status,
        },
      ],
      reason: "runtime_not_ready",
      runnableCapabilities: [],
      status: "not_ready",
      summary: {
        displayState: expectedDisplayState,
        ready: false,
      },
    });
  });

  it("returns ready with runnable capability facts for a fresh ready report", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });

    await expect(
      resolveRuntimePrepareReadiness({
        agentControllerRefsToEvaluate: ["builtin:codex"],
        nowMs: 2000,
        reportReadStore: createReportReadStore([
          buildAgentControllerReport({
            openMeldServiceRuntimeId,
            status: "ready",
          }),
        ]),
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore({
          openMeldServiceRuntimeId,
        }),
      })
    ).resolves.toMatchObject({
      agentControllerReportsRead: true,
      nonRunnableCapabilities: [],
      runnableCapabilities: [
        {
          agentControllerRef: "builtin:codex",
          status: "ready",
        },
      ],
      status: "ready",
      summary: {
        displayState: "ready",
        ready: true,
      },
    });
  });

  it("does not return Binding, Wake, Claim, Result, or Space side-effect fields", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });

    const result = await resolveRuntimePrepareReadiness({
      agentControllerRefsToEvaluate: ["builtin:codex"],
      nowMs: 2000,
      reportReadStore: createReportReadStore([
        buildAgentControllerReport({
          openMeldServiceRuntimeId,
          status: "ready",
        }),
      ]),
      runtimeLookupInput,
      runtimeLookupStore: createFoundRuntimeLookupStore({
        openMeldServiceRuntimeId,
      }),
    });

    expect(Object.keys(result).sort()).toEqual([
      "agentControllerReportsRead",
      "nonRunnableCapabilities",
      "openMeldServiceRuntimeId",
      "projection",
      "runnableCapabilities",
      "status",
      "summary",
    ]);
    expect(Object.hasOwn(result.projection, "nextSteps")).toBe(false);
  });
});

function createOwnerAccountLookupInput(): RuntimeLookupInput {
  return createRuntimeLookupInput({
    deviceId: "device-1",
    lane: "openmeld-dev",
    owner: {
      id: "owner-1",
      kind: "owner_account",
    },
  });
}

function authorityRuntimeId(input: {
  lookupInput: RuntimeLookupInput;
  value: string;
}) {
  return createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: input.lookupInput,
    openMeldServiceRuntimeId: input.value,
    source: "runtime_registry_authority",
  });
}

function createFoundRuntimeLookupStore(input: {
  openMeldServiceRuntimeId: ReturnType<typeof authorityRuntimeId>;
}): RuntimeLookupStore {
  return {
    readRuntimeRecord: async () => ({
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
      status: "found",
    }),
  };
}

function createMissingRuntimeLookupStore(): RuntimeLookupStore {
  return {
    readRuntimeRecord: async () => ({
      status: "missing",
    }),
  };
}

function createReportReadStore(
  reports: readonly AcceptedRuntimeAgentControllerReport[] = []
): RuntimeAgentControllerReportReadStore & {
  readCurrentRuntimeAgentControllerReports: ReturnType<typeof vi.fn>;
} {
  return {
    readCurrentRuntimeAgentControllerReports: vi.fn(async () => reports),
  };
}

function buildAgentControllerReport(input: {
  expiresAtMs?: number;
  openMeldServiceRuntimeId: ReturnType<typeof authorityRuntimeId>;
  status: AcceptedRuntimeAgentControllerReport["status"];
}): AcceptedRuntimeAgentControllerReport {
  return {
    agentControllerRef: "builtin:codex",
    expiresAtMs: input.expiresAtMs ?? 5000,
    observedAtMs: 1000,
    reasonCodes: [`runtime.agent_controller_report.${input.status}`],
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    status: input.status,
  };
}
