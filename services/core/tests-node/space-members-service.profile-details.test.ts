import { DatabaseSync, type StatementSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreAgentExecutionReadiness } from "../src/agent-execution/application/agent-execution-readiness-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as readinessService from "../src/agent-execution/application/agent-execution-readiness-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as runtimeTransportClient from "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client";
import type { CoreBindings } from "../src/lib/bindings";
import { listSpaceMembersSnapshotUseCase } from "../src/space/application/space-members-service";
import {
  type SpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

const NOW_ISO = "2026-06-19T00:00:00.000Z";
const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

describe("space members profile details projection", () => {
  beforeEach(() => {
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockResolvedValue({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("projects the Binding controller conversation ID for an owner-visible agent member", async () => {
    const harness = createSqlStorageHarness();
    try {
      ensureSpaceSqlSchema(harness.sql);
      upsertSpaceMemberRecord(harness.sql, createAgentMemberRecord());
      vi.spyOn(
        readinessService,
        "resolveCoreAgentExecutionReadiness"
      ).mockResolvedValue(
        createCoreReadiness({
          agentControllerConversationId: "thread-binding-1",
        })
      );

      const snapshot = await listSpaceMembersSnapshotUseCase({
        env: createCoreEnv({
          lineage: {
            [AGENT_PROFILE_ID]: "human-root",
            "human-root": null,
          },
        }),
        liveSessions: [],
        nowIso: NOW_ISO,
        spaceId: "space-1",
        sql: harness.sql,
        viewerOwnerUserId: "owner-1",
        viewerProfileId: "human-root",
      });

      expect(snapshot.agents).toHaveLength(1);
      expect(snapshot.agents[0]?.agentControllerConversationId).toBe(
        "thread-binding-1"
      );
    } finally {
      harness.close();
    }
  });

  it("keeps the Binding controller conversation ID hidden from same-owner sibling profiles", async () => {
    const harness = createSqlStorageHarness();
    try {
      ensureSpaceSqlSchema(harness.sql);
      upsertSpaceMemberRecord(harness.sql, createAgentMemberRecord());
      vi.spyOn(
        readinessService,
        "resolveCoreAgentExecutionReadiness"
      ).mockResolvedValue(
        createCoreReadiness({
          agentControllerConversationId: "thread-binding-1",
        })
      );

      const snapshot = await listSpaceMembersSnapshotUseCase({
        env: createCoreEnv({
          lineage: {
            [AGENT_PROFILE_ID]: "human-root",
            "agent-sibling": "human-root",
            "human-root": null,
          },
        }),
        liveSessions: [],
        nowIso: NOW_ISO,
        spaceId: "space-1",
        sql: harness.sql,
        viewerOwnerUserId: "owner-1",
        viewerProfileId: "agent-sibling",
      });

      expect(snapshot.agents).toHaveLength(1);
      expect(snapshot.agents[0]?.agentControllerConversationId).toBeNull();
    } finally {
      harness.close();
    }
  });
});

function createCoreEnv(input: {
  lineage: Record<string, string | null>;
}): CoreBindings {
  return {
    OPENMELD_AUTH_WORKER: {
      listProfileLineage: vi.fn().mockResolvedValue({
        ok: true,
        profiles: Object.entries(input.lineage).map(
          ([profileId, creatorProfileId]) => ({
            creatorProfileId,
            profileId,
          })
        ),
      }),
    },
  } as unknown as CoreBindings;
}

function createAgentMemberRecord(): SpaceMemberRecord {
  return {
    addedAt: NOW_ISO,
    addedByDisplayNameSnapshot: "Felix",
    addedByOwnerUserId: "owner-1",
    addedByProfileId: "human-root",
    controllerRefSnapshot: "builtin:codex",
    createdAt: NOW_ISO,
    firstEnteredAt: NOW_ISO,
    lastEnteredAt: NOW_ISO,
    memberSource: "added_by_member",
    ownerNameSnapshot: "Felix",
    ownerUserIdSnapshot: "owner-1",
    profileId: AGENT_PROFILE_ID,
    profileKindSnapshot: "agent",
    profileNameSnapshot: "Codex Setup Interviewer",
    removalReason: null,
    removedAt: null,
    removedByOwnerUserId: null,
    removedByProfileId: null,
    spaceId: "space-1",
    status: "active",
    updatedAt: NOW_ISO,
  };
}

function createCoreReadiness(input: {
  agentControllerConversationId: string;
}): CoreAgentExecutionReadiness {
  const readiness = {
    agentProfileId: AGENT_PROFILE_ID,
    displayState: "not_ready",
    facts: {
      binding: {
        reasonCodes: [],
        routable: true,
        source: "binding_truth",
      },
      claim: {
        executionBlocked: false,
        grantsClaimSuccess: false,
        reasonCodes: [],
        source: "claim_diagnostics",
      },
      localService: {
        reachable: false,
        reasonCodes: ["local_service.not_connected_for_account"],
        refreshable: false,
        source: "runtime_transport",
      },
      profile: {
        active: true,
        reasonCodes: [],
        source: "auth_profile",
      },
      providerAccount: {
        blocked: false,
        expiresAtMs: null,
        observedAtMs: null,
        provider: "codex",
        reasonCodes: [],
        source: "not_required",
      },
      providerConversation: {
        agentControllerConversationId: input.agentControllerConversationId,
        errorCode: null,
        errorMessage: null,
        errorType: null,
        expiresAtMs: null,
        method: null,
        observedAtMs: null,
        provider: "codex",
        ready: false,
        reasonCodes: [],
        required: true,
        source: "binding_truth",
        status: "not_checked",
      },
      readinessImpact: {
        blocked: false,
        expiresAtMs: null,
        impactKind: null,
        observedAtMs: null,
        reasonCodes: [],
        source: "none",
      },
      route: {
        deviceId: null,
        lane: null,
        online: false,
        reasonCodes: ["agent_execution.route_offline"],
        source: "runtime_transport",
      },
      runtime: {
        ready: false,
        reasonCodes: [],
        source: "missing",
      },
      service: {
        reasonCodes: [],
        source: "not_checked",
      },
    },
    primaryAction: "connect_service",
    reasonCodes: ["local_service.not_connected_for_account"],
  };

  return {
    agentControllerRef: "builtin:codex",
    agentExecutionReadiness: readiness,
    agentWakeRouteRegistration: {
      daemonSessionId: null,
      deviceId: null,
      lane: null,
      reasonCode: null,
      reportedAtMs: null,
      serviceVersion: null,
      status: "unavailable",
    },
    daemonRouteObservation: {
      online: false,
      reasonCode: "daemon.profile.offline",
    },
    ownerUserId: "owner-1",
    profileName: "Codex Setup Interviewer",
    routeDeviceId: null,
    routeLane: null,
    runtimeDeviceDisplayName: "Felix's MacBook Pro",
    spaceMemberAgentExecutionReadiness: readiness,
    wakeRouteStatus: {
      status: "offline",
    },
  } as unknown as CoreAgentExecutionReadiness;
}

function createSqlStorageHarness(): {
  close(): void;
  sql: SqlStorage;
} {
  const database = new DatabaseSync(":memory:");
  return {
    close: () => {
      database.close();
    },
    sql: new SqliteSqlStorage(database) as unknown as SqlStorage,
  };
}

class SqliteSqlCursor<T extends Record<string, unknown>> {
  private index = 0;
  private readonly rows: T[];
  readonly rowsWritten: number;

  constructor(rows: T[], rowsWritten = 0) {
    this.rows = rows;
    this.rowsWritten = rowsWritten;
  }

  next(): IteratorResult<T> {
    if (this.index >= this.rows.length) {
      return { done: true, value: undefined as never };
    }
    const value = this.rows[this.index] as T;
    this.index += 1;
    return { done: false, value };
  }

  toArray(): T[] {
    return [...this.rows];
  }
}

class SqliteSqlStorage {
  private readonly database: DatabaseSync;

  constructor(database: DatabaseSync) {
    this.database = database;
  }

  exec<T extends Record<string, unknown>>(
    sql: string,
    ...params: unknown[]
  ): SqliteSqlCursor<T> {
    const statement = this.database.prepare(sql);
    if (isReadStatement(sql)) {
      return new SqliteSqlCursor<T>(
        statement.all(...toSqliteParams(params)) as T[]
      );
    }
    const result = (statement as StatementSync).run(...toSqliteParams(params));
    return new SqliteSqlCursor<T>([], Number(result.changes));
  }
}

function isReadStatement(sql: string): boolean {
  const normalized = sql.trim().toUpperCase();
  return normalized.startsWith("SELECT") || normalized.startsWith("PRAGMA");
}

function toSqliteParams(
  params: readonly unknown[]
): (string | number | null)[] {
  return params.map((param) => {
    if (
      typeof param === "string" ||
      typeof param === "number" ||
      param === null
    ) {
      return param;
    }
    throw new Error("unsupported sqlite test parameter");
  });
}
