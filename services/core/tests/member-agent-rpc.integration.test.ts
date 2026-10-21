import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  type EnsureDetectedMemberAgentRpcInput,
  ensureDetectedMemberAgentRpcResultSchema,
  listMemberAgentsResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldRequestContext } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  pairAcceptedReports,
  recordMemberAgentCatalogReports,
  rpcSyncMemberAgents,
} from "../src/member-agent/member-agent-rpc";
import { env } from "../test-support/worker-env";

const db = () => {
  const database = getPostgresDatabase(env);
  if (!database) {
    throw new Error("PostgreSQL test binding is missing");
  }
  return database;
};

async function seed() {
  const suffix = crypto.randomUUID();
  const userId = `user_${suffix}`;
  const opened = `org_opened_${suffix}`;
  const unopened = `org_unopened_${suffix}`;
  const foreign = `org_foreign_${suffix}`;
  const runtimeId = `runtime_${suffix}`;
  const nowMs = Date.now();
  await db().query({
    text: 'INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at) VALUES ($1, $1, $2, 1, $3, $3)',
    values: [userId, `${userId}@example.com`, nowMs],
  });
  for (const organizationId of [opened, unopened, foreign]) {
    await db().query({
      text: 'INSERT INTO "openmeld"."organizations" (id, name, slug, created_at) VALUES ($1, $1, $1, $2)',
      values: [organizationId, nowMs],
    });
  }
  for (const organizationId of [opened, unopened]) {
    await db().query({
      text: 'INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at) VALUES ($1, $2, $3, \'member\', $4)',
      values: [`member_${organizationId}`, organizationId, userId, nowMs],
    });
  }
  await db().query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_registry_records" (
      openmeld_service_runtime_id, owner_kind, owner_id, device_id, lane,
      created_at_ms, last_registered_at_ms, updated_at_ms
    ) VALUES ($1, 'owner_account', $2, $3, 'prod', $4, $4, $4)`,
    values: [runtimeId, userId, `device_${suffix}`, nowMs],
  });
  await db().query({
    text: `INSERT INTO "openmeld"."openMeldDaemon_runtime_agent_controller_reports" (
      openmeld_service_runtime_id, agent_controller_ref, report_status,
      observed_at_ms, expires_at_ms, reported_reason_codes_json,
      agent_controller_interface_json, accepted_at_ms, updated_at_ms
    ) VALUES ($1, 'builtin:codex', 'ready', $2, $3, '[]', NULL, $2, $2)`,
    values: [runtimeId, nowMs, nowMs + 600_000],
  });
  const context = (organizationId: string): OpenMeldRequestContext => ({
    activeOrganizationId: organizationId,
    actorContext: {
      callerPrincipalId: userId,
      openMeldProfileId: crypto.randomUUID(),
      ownerUserId: userId,
      profileKind: "human",
      profileName: "Member",
      requestId: crypto.randomUUID(),
    },
  });
  return { context, foreign, nowMs, opened, runtimeId, unopened, userId };
}

// Auth contract fakes, built through the shared RPC schemas.
function authWorker(input: { organizationIds: string[] }) {
  const ensureDetectedMemberAgent = vi.fn(
    async (request: EnsureDetectedMemberAgentRpcInput) =>
      ensureDetectedMemberAgentRpcResultSchema.parse({
        ok: true,
        created: true,
        memberAgent: {
          archivedAt: null,
          defaultProfileId: `agt_${crypto.randomUUID()}`,
          harnessKind: request.harnessKind,
          id: `ma_${crypto.randomUUID()}`,
          organizationId: request.organizationId,
          ownerUserId: request.ownerUserId,
          source: "detected",
        },
      })
  );
  return {
    ensureDetectedMemberAgent,
    listMemberAgentOrganizationIds: vi.fn(async () => ({
      ok: true as const,
      organizationIds: input.organizationIds,
    })),
    listOwnerMemberAgents: vi.fn(
      async (request: { organizationId?: string | null }) =>
        listMemberAgentsResponseSchema.parse({
          ok: true,
          organizationId: request.organizationId,
          memberAgents: [],
          unassignedProfiles: [],
        })
    ),
  };
}

function withAuth(worker: ReturnType<typeof authWorker>): CoreBindings {
  return { ...env, OPENMELD_AUTH_WORKER: worker } as unknown as CoreBindings;
}

describe("rpcSyncMemberAgents", () => {
  it("is unavailable while the release flag is off", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [] });
    await expect(
      rpcSyncMemberAgents(
        withAuth(worker),
        { context: f.context(f.opened) },
        { enabled: false }
      )
    ).rejects.toMatchObject({ code: "member_agents.disabled" });
    expect(worker.ensureDetectedMemberAgent).not.toHaveBeenCalled();
  });

  it("rejects an organization the member does not belong to", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [] });
    await expect(
      rpcSyncMemberAgents(
        withAuth(worker),
        { context: f.context(f.foreign) },
        { enabled: true }
      )
    ).rejects.toMatchObject({ code: "organization.membership_required" });
    expect(worker.ensureDetectedMemberAgent).not.toHaveBeenCalled();
  });

  it("rejects an Agent caller", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [] });
    const context = f.context(f.opened);
    await expect(
      rpcSyncMemberAgents(
        withAuth(worker),
        {
          context: {
            ...context,
            actorContext: {
              ...context.actorContext,
              openMeldProfileId: `agt_${crypto.randomUUID()}`,
              profileKind: "agent",
            },
          },
        },
        { enabled: true }
      )
    ).rejects.toMatchObject({ code: "member_agents.human_caller_required" });
  });

  it("offers a detected Harness without creating it", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [] });

    const response = await rpcSyncMemberAgents(
      withAuth(worker),
      { context: f.context(f.opened) },
      { enabled: true }
    );

    expect(worker.ensureDetectedMemberAgent).not.toHaveBeenCalled();
    expect(response).toMatchObject({
      addableHarnessKinds: ["codex"],
      ok: true,
      results: [],
    });
  });

  it("rejects an unknown Harness to create", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [] });
    await expect(
      rpcSyncMemberAgents(
        withAuth(worker),
        {
          context: f.context(f.opened),
          createHarnessKinds: ["hosted" as "codex"],
        },
        { enabled: true }
      )
    ).rejects.toMatchObject({ code: "invalid_payload" });
    expect(worker.ensureDetectedMemberAgent).not.toHaveBeenCalled();
  });

  it("creates a requested Harness only in the organization the member opened", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [] });

    const response = await rpcSyncMemberAgents(
      withAuth(worker),
      { context: f.context(f.opened), createHarnessKinds: ["codex"] },
      { enabled: true }
    );

    expect(worker.ensureDetectedMemberAgent).toHaveBeenCalledTimes(1);
    expect(worker.ensureDetectedMemberAgent).toHaveBeenCalledWith({
      harnessKind: "codex",
      organizationId: f.opened,
      ownerUserId: f.userId,
    });
    expect(response).toMatchObject({
      ok: true,
      organizationId: f.opened,
      results: [{ harnessKind: "codex", outcome: "created" }],
    });
  });
});

describe("recordMemberAgentCatalogReports", () => {
  it("reconciles a newly present Harness only where the owner already has MemberAgents, without creating it", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [f.opened] });
    const report = {
      agentControllerRef: "builtin:codex",
      observedAtMs: f.nowMs,
      openMeldServiceRuntimeId: f.runtimeId,
      reasonCodes: [],
      status: "ready" as const,
    };

    await recordMemberAgentCatalogReports(withAuth(worker), {
      context: f.context(f.opened),
      db: db(),
      enabled: true,
      nowMs: f.nowMs,
      ownerUserId: f.userId,
      reports: [report],
    });

    // Only the member chooses which Harnesses become Agents.
    expect(worker.ensureDetectedMemberAgent).not.toHaveBeenCalled();
    expect(worker.listOwnerMemberAgents).toHaveBeenCalledTimes(1);
    expect(worker.listOwnerMemberAgents).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: f.opened })
    );

    // A steady report is not a catalog change and reconciles nothing.
    await recordMemberAgentCatalogReports(withAuth(worker), {
      context: f.context(f.opened),
      db: db(),
      enabled: true,
      nowMs: f.nowMs + 60_000,
      ownerUserId: f.userId,
      reports: [{ ...report, observedAtMs: f.nowMs + 60_000 }],
    });
    expect(worker.listOwnerMemberAgents).toHaveBeenCalledTimes(1);
    expect(worker.listMemberAgentOrganizationIds).toHaveBeenCalledTimes(1);
  });

  it("never broadcasts to organizations without a MemberAgent", async () => {
    const f = await seed();
    const worker = authWorker({ organizationIds: [] });

    await recordMemberAgentCatalogReports(withAuth(worker), {
      context: f.context(f.opened),
      db: db(),
      enabled: true,
      nowMs: f.nowMs,
      ownerUserId: f.userId,
      reports: [
        {
          agentControllerRef: "builtin:codex",
          observedAtMs: f.nowMs,
          openMeldServiceRuntimeId: f.runtimeId,
          reasonCodes: [],
          status: "ready",
        },
      ],
    });

    expect(worker.listMemberAgentOrganizationIds).toHaveBeenCalledTimes(1);
    expect(worker.ensureDetectedMemberAgent).not.toHaveBeenCalled();
  });
});

describe("pairAcceptedReports", () => {
  it("forwards only the exact accepted reports, never a rejected duplicate", () => {
    const report = (observedAtMs: number) => ({
      agentControllerRef: "builtin:codex",
      expiresAtMs: observedAtMs + 600_000,
      observedAtMs,
      reasonCodes: ["local_agent_preparation.not_detected"],
      status: "unavailable" as const,
    });
    const paired = pairAcceptedReports(
      {
        deviceId: "device-1",
        lane: "prod",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        reports: [report(1000), report(2000), report(3000)],
      },
      {
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
        reports: [
          {
            agentControllerRef: "builtin:codex",
            outcome: "updated",
            status: "accepted",
          },
          {
            agentControllerRef: "builtin:codex",
            reason: "report_time_invalid",
            status: "rejected",
          },
          {
            agentControllerRef: "builtin:codex",
            reason: "report_time_invalid",
            status: "rejected",
          },
        ],
        status: "partial",
      },
      "runtime-1"
    );

    expect(paired.map((entry) => entry.observedAtMs)).toEqual([1000]);
  });
});
