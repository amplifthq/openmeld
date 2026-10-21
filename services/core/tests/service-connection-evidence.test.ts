import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { serviceConnectionIncidentSchema } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionRecord,
  ServiceConnectionIncident,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  deleteExpiredServiceConnectionIncidents,
  readServiceConnectionIncidents,
  storeServiceConnectionIncident,
} from "../src/computers/service-connection-evidence-repo";
import { createServiceConnectionEvidenceRpc } from "../src/computers/service-connection-evidence-rpc";
import { readOwnerServiceConnectionTrace } from "../src/computers/service-connection-trace";
import { WAKE_EVIDENCE_RETENTION_MS } from "../src/dispatch/infrastructure/postgresql/wake-evidence-retention";
import type { CoreBindings } from "../src/lib/bindings";
import { registerRuntimeRegistryRecord } from "../src/runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import { env } from "../test-support/worker-env";

const coreEnv = env as unknown as CoreBindings;
function incident(): ServiceConnectionIncident {
  const now = Date.now();
  return {
    v: 1,
    incidentId: crypto.randomUUID(),
    deviceId: "device-a",
    runtimeLane: "prod",
    serviceSessionId: crypto.randomUUID(),
    serviceVersion: "0.3.205",
    startedAtMs: now - 10_000,
    endedAtMs: now,
    outcome: "recovered",
    evidenceTruncated: false,
    events: [
      {
        kind: "registered",
        reason: "recovered",
        phase: "online",
        connectionId: crypto.randomUUID(),
        firstAtMs: now,
        lastAtMs: now,
        count: 1,
      },
    ],
  };
}
describe("owner-scoped Service connection evidence in D1", () => {
  it("links overlapping incidents to Wake traces only for the runtime's owner", async () => {
    const ownerUserId = crypto.randomUUID();
    const record = incident();
    const runtime = createAuthorityOpenMeldServiceRuntimeId({
      openMeldServiceRuntimeId: crypto.randomUUID(),
      source: "runtime_registry_authority",
    });
    await registerRuntimeRegistryRecord({
      db: getPostgresDatabase(env),
      record: {
        nowMs: Date.now(),
        runtimeLookupInput: createRuntimeLookupInput({
          owner: { kind: "owner_account", id: ownerUserId },
          deviceId: record.deviceId,
          lane: record.runtimeLane,
        }),
        openMeldServiceRuntimeId: runtime,
      },
    });
    await storeServiceConnectionIncident({
      db: getPostgresDatabase(env),
      ownerUserId,
      incident: record,
      nowMs: Date.now(),
    });
    const execution: RuntimeCoordinatorExecutionRecord = {
      runtimeCoordinatorExecutionId: "execution",
      modelVersion: "openmeld.runtime_coordinator.execution.v1",
      spaceId: "space",
      dispatchId: "dispatch",
      targetProfileId: "profile",
      sourceClientMessageId: null,
      openMeldServiceRuntimeId: runtime,
      bindingId: "binding",
      agentControllerRef: "builtin:codex",
      status: "running",
      terminalOutcome: null,
      createdAtMs: record.startedAtMs - 1000,
      updatedAtMs: Date.now(),
      legacyPointers: {
        attemptId: null,
        claimLeaseId: null,
        daemonSessionId: null,
        connectionGeneration: null,
        leaseEpoch: null,
      },
    };
    const request = { env: coreEnv, ownerUserId, execution };
    const evidence = await readOwnerServiceConnectionTrace(request);
    expect(evidence?.incidents.map((item) => item.incidentId)).toEqual([
      record.incidentId,
    ]);
    expect(evidence?.incidents[0]).not.toHaveProperty("events");
    expect(
      await readOwnerServiceConnectionTrace({
        ...request,
        ownerUserId: "another-team-member",
      })
    ).toBeUndefined();
    expect(
      await readOwnerServiceConnectionTrace({
        ...request,
        ownerUserId: undefined,
      })
    ).toBeUndefined();
  });
  it("enforces owner and current-uploader gates before accessing incident storage", async () => {
    const record = incident();
    const rpc = createServiceConnectionEvidenceRpc({
      requireOwnerUserId: (context) => context.actorContext.ownerUserId ?? "",
      requireOwnedDevice: (_env, owner, device) => {
        if (owner !== "owner-a" || device !== record.deviceId) {
          throw new Error("device_not_owned");
        }
        return Promise.resolve();
      },
      requireUploader: (_env, owner, input) => {
        if (
          owner !== "owner-a" ||
          input.report.uploaderServiceSessionId !== record.serviceSessionId
        ) {
          throw new Error("uploader_not_current");
        }
        return Promise.resolve();
      },
    });
    const target = {
      deviceId: record.deviceId,
      runtimeLane: record.runtimeLane,
      context: {
        actorContext: {
          requestId: "request",
          openMeldProfileId: "02325896-2cf8-4fa9-bd49-185db194dc8b",
          profileKind: "human" as const,
          ownerUserId: "owner-a",
        },
      },
    };
    await expect(
      rpc.read(coreEnv, { ...target, deviceId: "another-device" })
    ).rejects.toThrow("device_not_owned");
    await expect(
      rpc.report(coreEnv, {
        ...target,
        report: {
          incident: record,
          uploaderServiceSessionId: crypto.randomUUID(),
        },
      })
    ).rejects.toThrow("uploader_not_current");
    await expect(
      rpc.report(coreEnv, {
        ...target,
        deviceId: "another-device",
        report: {
          incident: record,
          uploaderServiceSessionId: record.serviceSessionId,
        },
      })
    ).rejects.toThrow();
    expect(
      (
        await readServiceConnectionIncidents({
          db: getPostgresDatabase(env),
          ownerUserId: "owner-a",
          target,
          nowMs: Date.now(),
        })
      ).incidents
    ).toEqual([]);
  });
  it("commits one immutable receipt per incident and isolates owner, device, lane and time", async () => {
    const ownerUserId = crypto.randomUUID();
    const record = incident();
    const nowMs = Date.now();
    const input = {
      db: getPostgresDatabase(env),
      ownerUserId,
      incident: record,
      nowMs,
    };
    const first = await storeServiceConnectionIncident(input);
    expect(
      await storeServiceConnectionIncident({ ...input, nowMs: nowMs + 1000 })
    ).toEqual(first);
    await expect(
      storeServiceConnectionIncident({
        ...input,
        incident: { ...record, outcome: "interrupted" },
      })
    ).rejects.toThrow();
    const read = {
      db: getPostgresDatabase(env),
      ownerUserId,
      target: { deviceId: record.deviceId, runtimeLane: record.runtimeLane },
      nowMs,
    };
    expect((await readServiceConnectionIncidents(read)).incidents).toHaveLength(
      1
    );
    expect(
      (
        await readServiceConnectionIncidents({
          ...read,
          ownerUserId: "other-owner",
        })
      ).incidents
    ).toEqual([]);
    expect(
      (
        await readServiceConnectionIncidents({
          ...read,
          target: { ...read.target, runtimeLane: "canary" },
        })
      ).incidents
    ).toEqual([]);
    expect(
      (
        await readServiceConnectionIncidents({
          ...read,
          interval: { startedAtMs: nowMs + 1000, endedAtMs: nowMs + 2000 },
        })
      ).incidents
    ).toEqual([]);
    expect(
      serviceConnectionIncidentSchema.safeParse({
        ...record,
        credentials: "secret",
      }).success
    ).toBe(false);
  });
  it("caps each device at 100 incidents, reads 20, and deletes expired evidence", async () => {
    const ownerUserId = crypto.randomUUID();
    const nowMs = Date.now();
    for (let i = 0; i < 102; i += 1) {
      await storeServiceConnectionIncident({
        db: getPostgresDatabase(env),
        ownerUserId,
        incident: incident(),
        nowMs: nowMs + i,
      });
    }
    const count = () =>
      getPostgresDatabase(env)
        .query<{
          count: number;
        }>({
          ...{
            text: 'SELECT COUNT(*) AS count FROM "openmeld"."openmeld_service_connection_incidents" WHERE owner_user_id = $1',
            values: [],
          },
          values: [ownerUserId],
        })
        .then((result) => result.rows[0] ?? null);
    expect((await count())?.count).toBe(100);
    expect(
      (
        await readServiceConnectionIncidents({
          db: getPostgresDatabase(env),
          ownerUserId,
          target: { deviceId: "device-a", runtimeLane: "prod" },
          nowMs: nowMs + 102,
        })
      ).incidents
    ).toHaveLength(20);
    await deleteExpiredServiceConnectionIncidents({
      db: getPostgresDatabase(env),
      nowMs: nowMs + WAKE_EVIDENCE_RETENTION_MS + 1000,
    });
    expect((await count())?.count).toBe(0);
  });
});
