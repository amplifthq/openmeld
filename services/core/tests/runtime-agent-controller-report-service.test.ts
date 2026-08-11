import {
  type AuthorityOpenMeldServiceRuntimeId,
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
  type RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { AgentControllerInterfaceSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  type AcceptedRuntimeAgentControllerReport,
  acceptRuntimeAgentControllerReport,
  type RuntimeAgentControllerReportStore,
} from "../src/runtime-registry/application/runtime-agent-controller-report-service";
import type { RuntimeLookupStore } from "../src/runtime-registry/application/runtime-lookup-service";

describe("runtime agent controller report service", () => {
  const CODEX_AGENT_CONTROLLER_INTERFACE = {
    agentControllerRef: "builtin:codex",
    auth: { status: "authenticated", label: "Signed in" },
    capabilities: {
      approvals: true,
      cancel: true,
      interrupt: true,
      modelSelection: true,
      nativeEventStream: true,
      permissionModes: true,
      structuredUserInput: false,
    },
    checkedAt: "2026-06-28T00:00:00.000Z",
    controllerId: "codex",
    displayName: "Codex",
    launch: {
      argsPrefix: [],
      commandPath: "/usr/local/bin/codex",
      installChoiceCount: 1,
      status: "ready",
    },
    message: null,
    models: [{ id: "gpt-5.5", displayName: "GPT-5.5" }],
    nativeInterface: "codex-app-server",
    schemaVersion: 1,
    skills: [],
    status: "ready",
    version: "0.1.0",
  } satisfies AgentControllerInterfaceSnapshot;

  it("accepts a valid current report for an existing registered Runtime", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 2000,
        report: {
          agentControllerRef: "builtin:codex",
          agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
          expiresAtMs: 5000,
          observedAtMs: 1000,
          reasonCodes: ["runtime.agent_controller_report.available"],
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(
          openMeldServiceRuntimeId
        ),
      })
    ).resolves.toEqual({
      currentReport: {
        agentControllerRef: "builtin:codex",
        agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId,
        status: "ready",
      },
      outcome: "created",
      status: "accepted",
    });

    expect(reportStore.currentReports).toEqual([
      {
        agentControllerRef: "builtin:codex",
        agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
        expiresAtMs: 5000,
        observedAtMs: 1000,
        reasonCodes: ["runtime.agent_controller_report.available"],
        openMeldServiceRuntimeId,
        status: "ready",
      },
    ]);
  });

  it("rejects a report for a missing Runtime without writing", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 2000,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createMissingRuntimeLookupStore(),
      })
    ).resolves.toEqual({
      reason: "runtime_missing",
      status: "rejected",
    });

    expect(reportStore.currentReports).toEqual([]);
  });

  it("rejects a lookup-derived openMeldServiceRuntimeId before writing", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = {
      source: "runtime_registry_authority",
      value: "owner_account:owner-1:device-1:openmeld-dev",
    } satisfies AuthorityOpenMeldServiceRuntimeId;
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 2000,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(
          authorityRuntimeId({
            lookupInput: runtimeLookupInput,
            value: "runtime_opaque_1",
          })
        ),
      })
    ).resolves.toEqual({
      reason: "openmeld_service_runtime_id_invalid",
      status: "rejected",
    });

    expect(reportStore.currentReports).toEqual([]);
  });

  it("rejects an invalid agentControllerRef before writing", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 2000,
        report: {
          agentControllerRef: "codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(
          openMeldServiceRuntimeId
        ),
      })
    ).resolves.toEqual({
      reason: "agent_controller_ref_invalid",
      status: "rejected",
    });

    expect(reportStore.currentReports).toEqual([]);
  });

  it("rejects ACI evidence that does not match the report agentControllerRef", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 2000,
        report: {
          agentControllerRef: "builtin:claude-code",
          agentControllerInterface: CODEX_AGENT_CONTROLLER_INTERFACE,
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(
          openMeldServiceRuntimeId
        ),
      })
    ).resolves.toEqual({
      reason: "agent_controller_ref_invalid",
      status: "rejected",
    });

    expect(reportStore.currentReports).toEqual([]);
  });

  it("rejects a stale report without writing current facts", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 5000,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(
          openMeldServiceRuntimeId
        ),
      })
    ).resolves.toEqual({
      reason: "stale",
      status: "rejected",
    });

    expect(reportStore.currentReports).toEqual([]);
  });

  it("rejects a report when lookup returns a different registered openMeldServiceRuntimeId", async () => {
    const runtimeLookupInput = createOwnerAccountLookupInput();
    const submittedRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_submitted",
    });
    const registeredRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_registered",
    });
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 2000,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId: submittedRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(registeredRuntimeId),
      })
    ).resolves.toEqual({
      reason: "openmeld_service_runtime_id_mismatch",
      status: "rejected",
    });

    expect(reportStore.currentReports).toEqual([]);
  });

  it("rejects unsupported owner identity through the canonical Runtime lookup guard", async () => {
    const runtimeLookupInput = createRuntimeLookupInput({
      deviceId: "device-1",
      lane: "openmeld-dev",
      owner: {
        id: "principal-1",
        kind: "owner_principal",
      },
    });
    const openMeldServiceRuntimeId = authorityRuntimeId({
      lookupInput: runtimeLookupInput,
      value: "runtime_opaque_1",
    });
    const reportStore = createInMemoryRuntimeAgentControllerReportStore();

    await expect(
      acceptRuntimeAgentControllerReport({
        nowMs: 2000,
        report: {
          agentControllerRef: "builtin:codex",
          expiresAtMs: 5000,
          observedAtMs: 1000,
          status: "ready",
        },
        reportStore,
        openMeldServiceRuntimeId,
        runtimeLookupInput,
        runtimeLookupStore: createFoundRuntimeLookupStore(
          openMeldServiceRuntimeId
        ),
      })
    ).resolves.toEqual({
      reason: "openmeld_service_runtime_identity_invalid",
      status: "rejected",
    });

    expect(reportStore.currentReports).toEqual([]);
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
}): AuthorityOpenMeldServiceRuntimeId {
  return createAuthorityOpenMeldServiceRuntimeId({
    lookupInput: input.lookupInput,
    openMeldServiceRuntimeId: input.value,
    source: "runtime_registry_authority",
  });
}

function createFoundRuntimeLookupStore(
  openMeldServiceRuntimeId: AuthorityOpenMeldServiceRuntimeId
): RuntimeLookupStore {
  return {
    readRuntimeRecord: async () => ({
      openMeldServiceRuntimeId,
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

function createInMemoryRuntimeAgentControllerReportStore(): RuntimeAgentControllerReportStore & {
  currentReports: AcceptedRuntimeAgentControllerReport[];
} {
  const currentReports: AcceptedRuntimeAgentControllerReport[] = [];

  return {
    currentReports,
    acceptRuntimeAgentControllerReport: (input) => {
      currentReports.push(input.report);
      return Promise.resolve({
        currentReport: input.report,
        outcome: "created",
        status: "accepted",
      });
    },
  };
}
