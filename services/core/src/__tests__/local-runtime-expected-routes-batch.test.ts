import { createAuthorityOpenMeldServiceRuntimeId } from "@openmeld/agent-runtime";
import type { AuthRpcProfileFact } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readLocalRuntimeExpectedRoutes } from "../agent-profile-binding/application/local-runtime-expected-routes-service";
import type { AgentProfileBindingRecord } from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
// biome-ignore lint/performance/noNamespaceImport: Per-test repository spy.
import * as bindingRepo from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import { listEnabledPrimaryAgentProfileBindingRecords } from "../agent-profile-binding/infrastructure/d1/agent-profile-binding-repo";
import type { CoreBindings } from "../lib/bindings";
// biome-ignore lint/performance/noNamespaceImport: Per-test runtime lookup spy.
import * as runtimeLookup from "../runtime-registry/application/runtime-lookup-service";

const binding = (
  id: string,
  runtime = "runtime-1"
): AgentProfileBindingRecord => ({
  agentProfileId: id,
  bindingId: `binding-${id}`,
  bindingState: "enabled_primary",
  owner: { kind: "owner_account", id: "owner" },
  openMeldServiceRuntimeId: runtime,
  agentControllerRef: "builtin:codex",
  agentControllerConversationId: null,
  configurationRevision: 1,
  agentControllerCollaborationMode: null,
  agentControllerPermissionMode: null,
  createdAtMs: 1,
  createdByProfileId: null,
  disabledAtMs: null,
  updatedAtMs: 1,
  reasonCode: null,
});
const fact = (id: string, ownerUserId = "owner"): AuthRpcProfileFact => ({
  profileId: id,
  ownerUserId,
  profileName: id,
  profileHandle: id,
  profileKind: "agent",
  status: "active",
  organizationId: "org",
  defaultProjectId: "project",
});

beforeEach(() => {
  vi.spyOn(
    bindingRepo,
    "listEnabledPrimaryAgentProfileBindingRecords"
  ).mockResolvedValue([]);
  vi.spyOn(runtimeLookup, "lookupRuntime").mockResolvedValue({
    status: "found",
    openMeldServiceRuntimeId: createAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: "runtime-1",
      source: "runtime_registry_authority",
    }),
  });
});
afterEach(() => vi.restoreAllMocks());

describe("full computer catalog Profile batch boundary", () => {
  it("keeps full target validation while excluding another computer and another owner", async () => {
    vi.mocked(listEnabledPrimaryAgentProfileBindingRecords).mockResolvedValue([
      binding("target"),
      binding("wrong-owner"),
      binding("disabled"),
      binding("missing"),
      binding("other-computer", "runtime-other"),
    ]);
    const resolveProfilesByIds = vi.fn(async () => ({
      ok: true as const,
      profiles: {
        target: fact("target"),
        "wrong-owner": fact("wrong-owner", "different-owner"),
        disabled: { ...fact("disabled"), status: "disabled" as const },
        missing: null,
      },
    }));
    const result = await read({ resolveProfilesByIds });
    expect(resolveProfilesByIds).toHaveBeenCalledWith({
      profileIds: ["target", "wrong-owner", "disabled", "missing"],
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected catalog");
    }
    expect(
      result.response.expectedRoutes.map((route) => route.agentProfileId)
    ).toEqual(["target"]);
    expect(result.response.expectedRoutes[0]).toMatchObject({
      defaultProjectId: "project",
      configurationRevision: 1,
    });
    expect(result.response.excludedProfiles).toHaveLength(4);
  });

  it.each([
    { ok: false, code: "auth.unavailable", message: "Unavailable" },
    { ok: true, profiles: {} },
    { ok: true, profiles: { target: fact("someone-else") } },
  ])("does not publish a shortened catalog from failed or incomplete identity evidence", async (response) => {
    vi.mocked(listEnabledPrimaryAgentProfileBindingRecords).mockResolvedValue([
      binding("target"),
    ]);
    expect(await read({ resolveProfilesByIds: async () => response })).toEqual({
      status: "profile_facts_unavailable",
    });
  });
});

function read(authWorker: unknown) {
  return readLocalRuntimeExpectedRoutes({
    authWorker: authWorker as CoreBindings["OPENMELD_AUTH_WORKER"],
    contractVersion: "v4",
    db: {} as D1Database,
    deviceId: "device-1",
    ownerUserId: "owner",
    lane: "prod",
    generatedAt: "2026-09-08T22:00:00.000Z",
  });
}
