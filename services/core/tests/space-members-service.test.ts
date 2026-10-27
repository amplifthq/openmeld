import {
  type PostgreSQLBinding,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import type { Profile, SignalEnvelope, SpaceCreator } from "@openmeld/protocol";
import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import type { RuntimeTransportHub } from "../src";
import type { CoreBindings } from "../src/lib/bindings";
import { resetCoreLocalComponentsReleaseCacheForTests } from "../src/local-components/release-source";
import {
  addSpaceMembersUseCase,
  leaveSpaceUseCase,
  listSpaceIdentityDirectoryUseCase,
  listSpaceMemberDirectoryUseCase,
  listSpaceMembersSnapshotUseCase,
  readSpaceStatusMembersSummaryUseCase,
  refreshSpaceMemberNamesFromAuth,
  removeSpaceMembersUseCase,
  type SpaceMembersUseCaseError,
  upsertJoinedSpaceMember,
  upsertSpaceCreatorMember,
} from "../src/space/application/space-members-service";
import {
  readSpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { createProjectionPostgresBinding } from "../test-support/postgresql-query.test-support";
import { createPublishedCliReleasesBucket } from "../test-support/published-local-components-release";

type SqlRow = Record<string, SqlStorageValue>;

const INSERT_INTO_SQL_REGEX = /INSERT INTO/i;
const INSERT_SPACE_MEMBERS_SQL_REGEX = /INSERT INTO space_members/i;
const FROM_SPACE_MEMBERS_SQL_REGEX = /FROM\s+space_members/i;
const SELECT_SIGNAL_PAYLOAD_SQL_REGEX =
  /SELECT payload_json\s+FROM\s+space_signals/i;
const SELECT_SIGNAL_ACTIVITY_SQL_REGEX =
  /SELECT profile_id,\s*MAX\(ts\)\s+AS\s+last_ts\s+FROM\s+space_signals/i;
const FROM_SPACE_CURSORS_SQL_REGEX = /FROM\s+space_cursors/i;
const WHERE_PROFILE_ID_SQL_REGEX = /WHERE\s+profile_id\s*=\s*\?/i;
const WHERE_STATUS_SQL_REGEX = /WHERE\s+status\s*=\s*\?/i;
const FROM_AGENT_PROFILE_BINDINGS_SQL_REGEX =
  /FROM\s+openMeldDaemon_agent_profile_bindings/i;
const FROM_CURRENT_DEVICE_TARGETS_SQL_REGEX =
  /FROM\s+openMeldDaemon_current_device_targets/i;
const FROM_RUNTIME_REGISTRY_SQL_REGEX =
  /FROM\s+openMeldDaemon_runtime_registry_records/i;
const FROM_OWNED_DEVICES_SQL_REGEX = /FROM\s+openMeldDaemon_owned_devices/i;
const FROM_RUNTIME_AGENT_CONTROLLER_REPORTS_SQL_REGEX =
  /FROM\s+openMeldDaemon_runtime_agent_controller_reports/i;
const FROM_RUNTIME_EXECUTION_TARGETS_SQL_REGEX =
  /FROM\s+openMeldDaemon_runtime_registry_records\s+runtime/i;
const TEST_RUNTIME_TRANSPORT = {
  get: () => ({
    fetch: async () =>
      Response.json({ online: false, reasonCode: "daemon.session.not_found" }),
  }),
  idFromName: (name: string) => name,
} as unknown as DurableObjectNamespace<RuntimeTransportHub>;

class FakeSqlCursor<T extends SqlRow> {
  private readonly rows: T[];
  private index = 0;
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

class MutableSqlStorage {
  private readonly memberRows = new Map<string, SqlRow>();
  private readonly signalRows: Array<{
    id: string;
    ts: number;
    type: string;
    profile_id: string | null;
    profile_kind: string | null;
    payload_json: string;
  }> = [];
  private readonly cursorRows = new Map<string, SqlRow>();
  private readonly webActivity = new Map<string, number>();
  private memberSelectAllCount = 0;
  private signalPayloadSelectCount = 0;
  private signalActivitySelectCount = 0;
  private backfillWatermark: {
    last_ts: number;
    last_signal_id: string;
  } | null = null;

  exec<T extends SqlRow>(sql: string, ...params: unknown[]): FakeSqlCursor<T> {
    if (sql.includes("space_member_web_activity")) {
      const value = this.webActivity.get(String(params[0]));
      return new FakeSqlCursor<T>(
        value === undefined ? [] : [{ last_active_at: value } as unknown as T]
      );
    }
    if (sql.includes("MAX(ts) AS last_active_at")) {
      const times = this.signalRows
        .filter(
          (row) => row.type === "signal.text" && row.profile_id === params[0]
        )
        .map((row) => row.ts);
      return new FakeSqlCursor<T>([
        {
          last_active_at: times.length ? Math.max(...times) : null,
        } as unknown as T,
      ]);
    }
    if (sql.includes("space_members_backfill_watermark")) {
      if (INSERT_INTO_SQL_REGEX.test(sql)) {
        this.backfillWatermark = {
          last_ts: params[0] as number,
          last_signal_id: params[1] as string,
        };
        return new FakeSqlCursor<T>([], 1);
      }
      return new FakeSqlCursor<T>(
        this.backfillWatermark
          ? ([{ ...this.backfillWatermark }] as unknown as T[])
          : []
      );
    }

    if (INSERT_SPACE_MEMBERS_SQL_REGEX.test(sql)) {
      this.upsertMember(params);
      return new FakeSqlCursor<T>([], 1);
    }

    if (FROM_SPACE_MEMBERS_SQL_REGEX.test(sql)) {
      return new FakeSqlCursor<T>(this.selectMembers(sql, params) as T[]);
    }

    if (sql.includes("MAX(ts) AS max_ts")) {
      // JS twin of the SQL latest-activity aggregation.
      const grouped = new Map<string, number>();
      for (const row of this.signalRows) {
        const payload = JSON.parse(row.payload_json) as {
          type?: string;
          profile?: { profileId?: unknown };
          data?: { actorProfileId?: unknown };
        };
        let pid: unknown;
        if (
          payload.type === "presence.join" ||
          payload.type === "presence.quit"
        ) {
          pid = null;
        } else if (payload.type === "signal.system_notice") {
          pid = payload.data?.actorProfileId;
        } else {
          pid = payload.profile?.profileId;
        }
        if (typeof pid !== "string" || pid.trim().length === 0) {
          continue;
        }
        const current = grouped.get(pid) ?? Number.NEGATIVE_INFINITY;
        grouped.set(pid, Math.max(current, row.ts));
      }
      return new FakeSqlCursor<T>(
        [...grouped.entries()].map(
          ([pid, maxTs]) => ({ pid, max_ts: maxTs }) as unknown as T
        )
      );
    }

    if (sql.includes("ROW_NUMBER() OVER")) {
      // JS twin of the newest-origin-facts window query.
      const latestByProfile = new Map<
        string,
        { ts: number; id: string; payload_json: string }
      >();
      for (const row of this.signalRows) {
        const payload = JSON.parse(row.payload_json) as {
          profile?: {
            kind?: string;
            profileId?: unknown;
            agentControllerConversationId?: unknown;
            workingDirectory?: unknown;
          };
        };
        const profile = payload.profile ?? {};
        if (profile.kind !== "agent") {
          continue;
        }
        const cid =
          typeof profile.agentControllerConversationId === "string"
            ? profile.agentControllerConversationId.trim()
            : "";
        const wd = profile.workingDirectory;
        const wdOk =
          typeof wd === "string" &&
          wd.length >= 1 &&
          wd.length <= 4096 &&
          !wd.includes("\u0000");
        if (!(cid.length > 0 || wdOk)) {
          continue;
        }
        const pid =
          typeof profile.profileId === "string" ? profile.profileId : "";
        const current = latestByProfile.get(pid);
        if (
          !current ||
          row.ts > current.ts ||
          (row.ts === current.ts && row.id > current.id)
        ) {
          latestByProfile.set(pid, {
            ts: row.ts,
            id: row.id,
            payload_json: row.payload_json,
          });
        }
      }
      return new FakeSqlCursor<T>(
        [...latestByProfile.values()].map(
          (row) => ({ payload_json: row.payload_json }) as unknown as T
        )
      );
    }

    if (sql.includes("'$.data.meta.purpose'")) {
      const purpose = params[0];
      const rows = this.signalRows
        .filter((row) => {
          const payload = JSON.parse(row.payload_json) as {
            type?: string;
            data?: { meta?: { purpose?: unknown } };
          };
          return (
            payload.type === "signal.text" &&
            payload.data?.meta?.purpose === purpose
          );
        })
        .sort(
          (left, right) => left.ts - right.ts || left.id.localeCompare(right.id)
        )
        .map((row) => ({ payload_json: row.payload_json }));
      return new FakeSqlCursor<T>(rows as unknown as T[]);
    }

    if (SELECT_SIGNAL_PAYLOAD_SQL_REGEX.test(sql)) {
      this.signalPayloadSelectCount += 1;
      const sorted = this.signalRows
        .slice()
        .sort(
          (left, right) => left.ts - right.ts || left.id.localeCompare(right.id)
        );
      const filtered = sql.includes("WHERE ts > ?")
        ? sorted.filter((row) => {
            const afterTs = params[0] as number;
            const tieTs = params[1] as number;
            const afterId = params[2] as string;
            return row.ts > afterTs || (row.ts === tieTs && row.id > afterId);
          })
        : sorted;
      return new FakeSqlCursor<T>(
        filtered.map(
          (row) => ({ payload_json: row.payload_json }) as unknown as T
        )
      );
    }

    if (SELECT_SIGNAL_ACTIVITY_SQL_REGEX.test(sql)) {
      this.signalActivitySelectCount += 1;
      const grouped = new Map<string, number>();
      for (const row of this.signalRows) {
        if (
          sql.includes("type NOT IN ('presence.join', 'presence.quit')") &&
          (row.type === "presence.join" || row.type === "presence.quit")
        ) {
          continue;
        }
        if (!row.profile_id) {
          continue;
        }
        const current = grouped.get(row.profile_id) ?? 0;
        grouped.set(row.profile_id, Math.max(current, row.ts));
      }
      return new FakeSqlCursor<T>(
        [...grouped.entries()].map(([profileId, lastTs]) => {
          return {
            profile_id: profileId,
            last_ts: lastTs,
          } as unknown as T;
        })
      );
    }

    if (FROM_SPACE_CURSORS_SQL_REGEX.test(sql)) {
      return new FakeSqlCursor<T>([...this.cursorRows.values()] as T[]);
    }

    if (
      sql.includes("space_member_profile_liveness") ||
      sql.includes("space_member_projection_dirty")
    ) {
      // Membership liveness evidence and projection-dirty bookkeeping are
      // covered by the Durable Object level tests against real SQLite; the
      // fake just accepts them.
      return new FakeSqlCursor<T>([], 1);
    }

    throw new Error(`Unexpected SQL in test double: ${sql}`);
  }

  seedSignal(signal: SignalEnvelope): void {
    this.signalRows.push({
      id: signal.id,
      ts: signal.ts,
      type: signal.type,
      profile_id: signal.profile.profileId,
      profile_kind: signal.profile.kind,
      payload_json: JSON.stringify(signal),
    });
  }

  seedWebActivity(profileId: string, at: string): void {
    this.webActivity.set(profileId, Date.parse(at));
  }

  seedCursor(input: {
    profileId: string;
    mentionAlias: string | null;
    lastSeenAt?: string | null;
    createdAt: string;
  }): void {
    this.cursorRows.set(input.profileId, {
      profile_id: input.profileId,
      mention_alias: input.mentionAlias,
      last_seen_ts: input.lastSeenAt ? Date.parse(input.lastSeenAt) : null,
      created_at: Date.parse(input.createdAt),
    });
  }

  getSignalPayloadSelectCount(): number {
    return this.signalPayloadSelectCount;
  }

  getMemberSelectAllCount(): number {
    return this.memberSelectAllCount;
  }

  getSignalActivitySelectCount(): number {
    return this.signalActivitySelectCount;
  }

  private selectMembers(sql: string, params: unknown[]): SqlRow[] {
    const rows = [...this.memberRows.values()].sort((left, right) => {
      const leftAddedAt = Number(left.added_at ?? 0);
      const rightAddedAt = Number(right.added_at ?? 0);
      if (leftAddedAt !== rightAddedAt) {
        return leftAddedAt - rightAddedAt;
      }
      return String(left.profile_id ?? "").localeCompare(
        String(right.profile_id ?? "")
      );
    });

    if (WHERE_PROFILE_ID_SQL_REGEX.test(sql)) {
      const profileId = String(params[0] ?? "").trim();
      const row = this.memberRows.get(profileId);
      return row ? [row] : [];
    }

    if (WHERE_STATUS_SQL_REGEX.test(sql)) {
      const status = String(params[0] ?? "").trim();
      return rows.filter((row) => String(row.status ?? "") === status);
    }

    this.memberSelectAllCount += 1;
    return rows;
  }

  private upsertMember(params: unknown[]): void {
    const [
      spaceId,
      profileId,
      profileKindSnapshot,
      profileNameSnapshot,
      ownerUserIdSnapshot,
      ownerNameSnapshot,
      controllerRefSnapshot,
      status,
      memberSource,
      addedAt,
      removedAt,
      addedByProfileId,
      addedByOwnerUserId,
      addedByDisplayNameSnapshot,
      removedByProfileId,
      removedByOwnerUserId,
      removalReason,
      firstEnteredAt,
      lastEnteredAt,
      createdAt,
      updatedAt,
    ] = params;

    this.memberRows.set(String(profileId), {
      space_id: String(spaceId),
      profile_id: String(profileId),
      profile_kind_snapshot: String(profileKindSnapshot),
      profile_name_snapshot: String(profileNameSnapshot),
      owner_user_id_snapshot: toNullableText(ownerUserIdSnapshot),
      owner_name_snapshot: toNullableText(ownerNameSnapshot),
      controller_ref_snapshot: toNullableText(controllerRefSnapshot),
      status: String(status),
      member_source: String(memberSource),
      added_at: Number(addedAt),
      removed_at: toNullableNumber(removedAt),
      added_by_profile_id: toNullableText(addedByProfileId),
      added_by_owner_user_id: toNullableText(addedByOwnerUserId),
      added_by_display_name_snapshot: toNullableText(
        addedByDisplayNameSnapshot
      ),
      removed_by_profile_id: toNullableText(removedByProfileId),
      removed_by_owner_user_id: toNullableText(removedByOwnerUserId),
      removal_reason: toNullableText(removalReason),
      first_entered_at: toNullableNumber(firstEnteredAt),
      last_entered_at: toNullableNumber(lastEnteredAt),
      created_at: Number(createdAt),
      updated_at: Number(updatedAt),
    });
  }
}

type RouteTruthPostgresProjection = {
  bindSpy: ReturnType<typeof vi.fn>;
  db: PostgreSQLBinding;
  querySpy: ReturnType<
    typeof vi.fn<
      (query: string, values: readonly unknown[]) => Record<string, unknown>[]
    >
  >;
};

type RouteTruthPostgresProjectionInput = {
  agentProfileId: string;
  agentProfileIds?: readonly string[];
  includeExpectedRouteBindings?: boolean;
  agentControllerRef?: string;
  agentControllerReport?: {
    reasonCodes: readonly string[];
    status: "disabled" | "ready" | "unavailable";
  };
  centerAgentDesignationOrganizationId?: string;
  deviceId?: string;
  failBindingRead?: boolean;
  ownerUserId?: string;
  profileOrganizationId?: string;
  runtimeDeviceDisplayName?: string;
  openMeldServiceRuntimeId?: string;
  runtimeLane?: string;
};

function createRouteTruthPostgresProjection(
  input: RouteTruthPostgresProjectionInput
): RouteTruthPostgresProjection {
  const ownerUserId = input.ownerUserId ?? "owner-1";
  const agentProfileId = input.agentProfileId;
  const agentProfileIds = input.agentProfileIds ?? [agentProfileId];
  const agentControllerRef = input.agentControllerRef ?? "builtin:ops-bot";
  const deviceId = input.deviceId ?? "device-1";
  const openMeldServiceRuntimeId =
    input.openMeldServiceRuntimeId ?? "runtime-1";
  const runtimeLane = input.runtimeLane ?? "dev-local";
  const runtimeDeviceDisplayName =
    input.runtimeDeviceDisplayName ?? "Felix's composer";
  const profileOrganizationId = input.profileOrganizationId ?? "org-1";

  function firstForSql(
    sql: string,
    params: readonly unknown[]
  ): Record<string, unknown> | null {
    if (sql.toLowerCase().includes("from openmeld_profiles")) {
      return {
        managed_role:
          agentControllerRef === HOSTED_CENTER_AGENT_CONTROLLER_REF
            ? "center_agent"
            : null,
        organization_id: profileOrganizationId,
        owner_user_id: ownerUserId,
        profile_kind: "agent",
        profile_name: "Center Agent",
      };
    }
    if (sql.toLowerCase().includes("from center_agent_designations")) {
      const organizationId = String(params[0] ?? "");
      if (organizationId !== input.centerAgentDesignationOrganizationId) {
        return null;
      }
      return {
        agent_profile_id: agentProfileId,
        created_at: 1_700_000_000_000,
        designated_by: ownerUserId,
        duty: null,
        operating_state: "active",
        organization_id: organizationId,
        paused_at: null,
        paused_by_user_id: null,
      };
    }
    if (FROM_AGENT_PROFILE_BINDINGS_SQL_REGEX.test(sql)) {
      if (input.failBindingRead) {
        throw new Error("binding read failed");
      }
      const queriedAgentProfileId =
        agentProfileIds.find((id) => params.includes(id)) ?? agentProfileId;
      return {
        agent_profile_id: queriedAgentProfileId,
        binding_id: "binding-route-truth",
        binding_state: "enabled_primary",
        configuration_revision: 1,
        agent_controller_ref: agentControllerRef,
        created_at_ms: 1,
        created_by_profile_id: null,
        disabled_at_ms: null,
        owner_id: ownerUserId,
        owner_kind: "owner_account",
        reason_code: null,
        openmeld_service_runtime_id: openMeldServiceRuntimeId,
        updated_at_ms: 1,
      };
    }
    if (FROM_CURRENT_DEVICE_TARGETS_SQL_REGEX.test(sql)) {
      return {
        device_id: deviceId,
        owner_user_id: ownerUserId,
        runtime_lane: runtimeLane,
        updated_at_ms: 1,
      };
    }
    if (FROM_RUNTIME_REGISTRY_SQL_REGEX.test(sql)) {
      return {
        created_at_ms: 1,
        device_id: deviceId,
        lane: runtimeLane,
        last_registered_at_ms: 1,
        owner_id: ownerUserId,
        owner_kind: "owner_account",
        openmeld_service_runtime_id: openMeldServiceRuntimeId,
        updated_at_ms: 1,
      };
    }
    return null;
  }

  function allForSql(sql: string): Record<string, unknown>[] {
    if (sql.includes("GROUP BY runtime.device_id, runtime.lane")) {
      return [{ device_id: deviceId, lane: runtimeLane, last_active_ms: 1 }];
    }
    if (
      input.includeExpectedRouteBindings &&
      FROM_AGENT_PROFILE_BINDINGS_SQL_REGEX.test(sql) &&
      !sql.includes("LIMIT 1")
    ) {
      return agentProfileIds.map((profileId) => ({
        ...firstForSql(sql, [profileId]),
        configuration_revision: 1,
      }));
    }
    if (FROM_OWNED_DEVICES_SQL_REGEX.test(sql)) {
      return [
        {
          connected_computer_id: "computer-1",
          device_id: deviceId,
          device_type: "laptop",
          first_seen_at_ms: 1,
          last_observed_at_ms: 2,
          observed_display_name: "Felix's MacBook Pro",
          os_version: "15.4",
          owner_user_id: ownerUserId,
          platform_family: "macOS",
          updated_at_ms: 3,
          user_display_name: runtimeDeviceDisplayName,
        },
      ];
    }
    if (FROM_RUNTIME_AGENT_CONTROLLER_REPORTS_SQL_REGEX.test(sql)) {
      if (input.agentControllerReport) {
        return [
          {
            accepted_at_ms: 1_700_000_000_000,
            agent_controller_interface_json: null,
            agent_controller_ref: agentControllerRef,
            expires_at_ms: 1_900_000_000_000,
            observed_at_ms: 1_700_000_000_000,
            report_status: input.agentControllerReport.status,
            reported_reason_codes_json: JSON.stringify(
              input.agentControllerReport.reasonCodes
            ),
            updated_at_ms: 1_700_000_000_000,
            openmeld_service_runtime_id: openMeldServiceRuntimeId,
          },
        ];
      }
      return [];
    }
    if (FROM_RUNTIME_EXECUTION_TARGETS_SQL_REGEX.test(sql)) {
      return [];
    }
    return [];
  }

  const bindSpy = vi.fn();
  const querySpy = vi.fn((query: string, values: readonly unknown[]) => {
    bindSpy(...values);
    const sql = query.replaceAll('"', "").replaceAll("openmeld.", "");
    const rows = allForSql(sql);
    if (rows.length) {
      return rows;
    }
    const row = firstForSql(sql, values.flat());
    return row ? [row] : [];
  });
  return {
    bindSpy,
    querySpy,
    db: createProjectionPostgresBinding(({ text, values }) =>
      querySpy(text, values ?? [])
    ),
  };
}

const EMPTY_PROJECTION_BINDING = {
  connectionString:
    "postgresql://projection_fixture@127.0.0.1:1/projection_fixture",
};
function withProjectionBinding(env: Partial<CoreBindings>): CoreBindings {
  return {
    OPENMELD_POSTGRESQL: EMPTY_PROJECTION_BINDING,
    ...env,
  } as CoreBindings;
}
describe("space-members-service", () => {
  beforeEach(() => {
    createProjectionPostgresBinding(() => []);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists identity directory without reading local availability or recovery facts", () => {
    const sql = new MutableSqlStorage();
    const nowIso = "2026-03-06T12:05:00.000Z";
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-identity-directory",
      profile: createHumanProfile(
        "11111111-1111-4111-8111-111111111111",
        "Felix"
      ),
      nowIso,
    });
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-identity-directory",
      profile: createAgentProfile({
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Felix's Codex",
        ownerUserId: "owner-identity",
        agentControllerRef: "builtin:codex",
      }),
      nowIso,
    });
    sql.seedCursor({
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      mentionAlias: "codex",
      createdAt: nowIso,
    });

    const directory = listSpaceIdentityDirectoryUseCase({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-identity-directory",
      liveSessions: [],
      nowIso,
    });

    expect(directory).toEqual({
      spaceId: "space-identity-directory",
      generatedAt: nowIso,
      entries: [
        expect.objectContaining({
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          profileName: "Felix",
          agentControllerRef: null,
        }),
        expect.objectContaining({
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileKind: "agent",
          profileName: "Felix's Codex",
          mentionAlias: "codex",
          agentControllerRef: "builtin:codex",
        }),
      ],
    });
    expect(JSON.stringify(directory)).not.toContain("agentWakeAvailability");
    expect(JSON.stringify(directory)).not.toContain("ownerWakeDiagnostics");
    expect(JSON.stringify(directory)).not.toContain("wakeableAgentCount");
  });

  it("lists member directory without embedding readiness or runtime diagnostics", () => {
    const sql = new MutableSqlStorage();
    const nowIso = "2026-03-06T12:05:00.000Z";
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-member-directory",
      profile: createHumanProfile(
        "11111111-1111-4111-8111-111111111111",
        "Felix"
      ),
      nowIso,
    });
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-member-directory",
      profile: createAgentProfile({
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Felix's Codex",
        ownerUserId: "owner-identity",
        agentControllerRef: "builtin:codex",
      }),
      nowIso,
    });
    sql.seedCursor({
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      mentionAlias: "codex",
      createdAt: nowIso,
    });

    const directory = listSpaceMemberDirectoryUseCase({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-member-directory",
      liveSessions: [],
      nowIso,
    });

    expect(directory).toEqual({
      spaceId: "space-member-directory",
      generatedAt: nowIso,
      members: [
        expect.objectContaining({
          profileId: "11111111-1111-4111-8111-111111111111",
          profileKind: "human",
          displayName: "Felix",
          allowedRelations: {
            mention: true,
            wake: false,
            reference: false,
          },
        }),
        expect.objectContaining({
          profileId: "agt_11111111-1111-4111-8111-111111111111",
          profileKind: "agent",
          displayName: "Felix's Codex",
          mentionAlias: "codex",
          allowedRelations: {
            mention: false,
            wake: true,
            reference: true,
          },
          agentCard: null,
          spaceRole: null,
        }),
      ],
    });
    expect(JSON.stringify(directory)).not.toContain("agentWakeAvailability");
    expect(JSON.stringify(directory)).not.toContain("ownerWakeDiagnostics");
    expect(JSON.stringify(directory)).not.toContain("wakeableAgentCount");
    expect(JSON.stringify(directory)).not.toContain("agentControllerRef");
  });

  it("builds Space status member counts without runtime readiness reads", async () => {
    const sql = new MutableSqlStorage();
    const nowIso = "2026-03-06T12:05:00.000Z";
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-status-summary",
      profile: createHumanProfile("hum-status-live", "Live Human"),
      nowIso,
    });
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-status-summary",
      profile: createAgentProfile({
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Ready Agent",
        ownerUserId: "owner-status",
        agentControllerRef: "builtin:codex",
      }),
      nowIso,
    });
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-status-summary",
      profile: createAgentProfile({
        profileId: "agt_22222222-2222-4222-8222-222222222222",
        profileName: "Idle Agent",
        ownerUserId: "owner-status",
        agentControllerRef: "builtin:codex",
      }),
      nowIso,
    });

    sql.seedWebActivity("hum-status-live", nowIso);
    const runtimeRead = vi.fn(() => {
      throw new Error("Status must not read runtime readiness");
    });
    const summary = await readSpaceStatusMembersSummaryUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({
        OPENMELD_RUNTIME_TRANSPORT: { idFromName: runtimeRead },
      } as unknown as CoreBindings),
      spaceId: "space-status-summary",
      liveSessions: [
        {
          enforcedProfile: createHumanProfile("hum-status-live", "Live Human"),
        },
        {
          enforcedProfile: createAgentProfile({
            profileId: "agt_11111111-1111-4111-8111-111111111111",
            profileName: "Ready Agent",
            ownerUserId: "owner-status",
            agentControllerRef: "builtin:codex",
          }),
        },
      ],
      nowIso,
    });

    expect(summary).toEqual({
      totalCount: 3,
      humanCount: 1,
      agentCount: 2,
      liveNowCount: 2,
      liveHumanCount: 1,
      liveAgentCount: 1,
    });
    expect(runtimeRead).not.toHaveBeenCalled();
  });

  it("returns member identity without consulting runtime readiness for a display bootstrap", async () => {
    const sql = new MutableSqlStorage();
    const queries = vi.spyOn(sql, "exec");
    const profile = createAgentProfile({
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      profileName: "Agent on a slow computer",
      ownerUserId: "owner-status",
      agentControllerRef: "builtin:codex",
    });
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-display",
      profile,
      nowIso: "2026-03-06T12:05:00.000Z",
    });
    const snapshot = await listSpaceMembersSnapshotUseCase({
      includeAgentReadiness: false,
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({
        OPENMELD_RUNTIME_TRANSPORT: {
          idFromName: () => {
            throw new Error("Runtime reads must not gate display");
          },
        },
      } as unknown as CoreBindings),
      spaceId: "space-display",
      liveSessions: [],
      nowIso: "2026-03-06T12:05:00.000Z",
    });
    expect(snapshot.agents[0]).toMatchObject({
      profileId: profile.profileId,
      profileName: profile.profileName,
      agentControllerRef: "builtin:codex",
    });
    expect(snapshot.agents[0]?.agentWakeAvailability).toBeUndefined();
    expect(
      queries.mock.calls.some(([query]) =>
        query.includes("$.profile.agentControllerConversationId")
      )
    ).toBe(false);
    expect(snapshot.summary).toEqual({
      totalCount: 1,
      humanCount: 0,
      agentCount: 1,
      liveNowCount: 0,
    });
  });

  it("keeps live sessions visible even when the input iterable can only be consumed once", async () => {
    const sql = new MutableSqlStorage();
    const metaRecord = createMetaRecord({
      spaceId: "space-members-live",
      createdAt: "2026-03-06T12:00:00.000Z",
      updatedAt: "2026-03-06T12:00:00.000Z",
      creator: createHumanCreator("hum-members-creator-live", "Space Host"),
    });
    const liveSessions = createOneShotIterable([
      {
        enforcedProfile: createHumanProfile(
          "hum-members-joiner-live",
          "Joined Human"
        ),
      },
    ]);

    sql.seedWebActivity("hum-members-joiner-live", "2026-03-06T12:05:00.000Z");

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions,
      metaRecord,
      nowIso: "2026-03-06T12:05:00.000Z",
    });

    expect(snapshot.summary.liveNowCount).toBe(1);
    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "hum-members-joiner-live",
          memberSource: "joined_directly",
          liveNow: true,
        }),
      ])
    );
  });

  it("preserves human owner identity in creator and joined member snapshots", async () => {
    const sql = new MutableSqlStorage();
    const creatorProfileId = "11111111-1111-4111-8111-111111111111";
    const joinedProfileId = "22222222-2222-4222-8222-222222222222";
    const metaRecord = createMetaRecord({
      spaceId: "space-members-human-owner",
      createdAt: "2026-03-06T12:00:00.000Z",
      updatedAt: "2026-03-06T12:00:00.000Z",
      creator: createHumanCreator(creatorProfileId, "Space Host", {
        ownerUserId: "user-space-host",
        ownerName: "Space Host",
      }),
    });

    upsertSpaceCreatorMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      creator: metaRecord.creator,
      addedAt: metaRecord.createdAt,
      nowIso: metaRecord.updatedAt,
    });

    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      profile: createHumanProfile(joinedProfileId, "Joined Human"),
      ownerUserId: "user-joined-human",
      ownerName: "Joined Human",
      nowIso: "2026-03-06T12:02:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:03:00.000Z",
    });

    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: creatorProfileId,
          ownerUserId: "user-space-host",
          ownerName: "Space Host",
        }),
        expect.objectContaining({
          profileId: joinedProfileId,
          ownerUserId: "user-joined-human",
          ownerName: "Joined Human",
        }),
      ])
    );
  });

  it("projects canonical account avatars over stale live-session avatars", async () => {
    const sql = new MutableSqlStorage();
    const removedProfileId = "33333333-3333-4333-8333-333333333333";
    const customProfileId = "44444444-4444-4444-8444-444444444444";
    const removedOwnerUserId = "user-removed-avatar";
    const customOwnerUserId = "user-custom-avatar";
    const staleGoogleAvatar = "https://lh3.googleusercontent.com/stale-google";
    const customAvatar =
      "https://gateway.example/v1/profile-avatars/custom/avatar.webp";

    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-members-canonical-avatars",
      profile: {
        ...createHumanProfile(removedProfileId, "Removed Avatar"),
        avatarUrl: staleGoogleAvatar,
      },
      ownerUserId: removedOwnerUserId,
      ownerName: "Removed Avatar",
      nowIso: "2026-07-31T10:00:00.000Z",
    });
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "space-members-canonical-avatars",
      profile: {
        ...createHumanProfile(customProfileId, "Custom Avatar"),
        avatarUrl: staleGoogleAvatar,
      },
      ownerUserId: customOwnerUserId,
      ownerName: "Custom Avatar",
      nowIso: "2026-07-31T10:00:00.000Z",
    });

    const identityRows = [
      { id: removedOwnerUserId, image: null },
      { id: customOwnerUserId, image: customAvatar },
    ];
    const querySpy = vi.fn(
      (_query: import("@openmeld/db/postgresql").QueryConfig) => identityRows
    );
    const binding = createProjectionPostgresBinding(querySpy);
    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({
        OPENMELD_POSTGRESQL: binding,
      } as CoreBindings),
      spaceId: "space-members-canonical-avatars",
      liveSessions: [
        {
          enforcedProfile: {
            ...createHumanProfile(removedProfileId, "Removed Avatar"),
            avatarUrl: staleGoogleAvatar,
          },
        },
        {
          enforcedProfile: {
            ...createHumanProfile(customProfileId, "Custom Avatar"),
            avatarUrl: staleGoogleAvatar,
          },
        },
      ],
      nowIso: "2026-07-31T10:01:00.000Z",
    });

    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          avatarUrl: null,
          profileId: removedProfileId,
        }),
        expect.objectContaining({
          avatarUrl: customAvatar,
          profileId: customProfileId,
        }),
      ])
    );
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0]?.[0]).toMatchObject({
      values: [[customOwnerUserId, removedOwnerUserId]],
    });
  });

  it("backfills legacy add-members notices even when the creator member row already exists", async () => {
    const sql = new MutableSqlStorage();
    const metaRecord = createMetaRecord({
      spaceId: "space-members-legacy",
      createdAt: "2026-03-06T12:10:00.000Z",
      updatedAt: "2026-03-06T12:10:00.000Z",
      creator: createHumanCreator("hum-members-creator-legacy", "Space Host"),
    });

    upsertSpaceCreatorMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      creator: metaRecord.creator,
      addedAt: metaRecord.createdAt,
      nowIso: metaRecord.updatedAt,
    });

    sql.seedSignal(
      createTextSignal({
        signalId: "sig-legacy-notice",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:11:00.000Z",
        profile: createHumanProfile("hum-members-creator-legacy", "Space Host"),
        text: "Legacy Bot (agent, controller: builtin:legacy-bot, owner: Space Host) joined the space via add-members.",
      })
    );
    sql.seedSignal(
      createTextSignal({
        signalId: "sig-legacy-target",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:12:00.000Z",
        profile: createAgentProfile({
          profileId: "agt-legacy-bot-1",
          profileName: "Legacy Bot",
          ownerUserId: "owner-members-creator-legacy",
          agentControllerRef: "builtin:legacy-bot",
        }),
        text: "hello from legacy bot",
      })
    );

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:13:00.000Z",
    });

    expect(snapshot.summary.totalCount).toBe(2);
    expect(snapshot.summary.agentCount).toBe(1);
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt-legacy-bot-1",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by Space Host",
        }),
      ])
    );
  });

  it("backfills purpose-backed legacy added-to-space notices by unique profile name", async () => {
    const sql = new MutableSqlStorage();
    const metaRecord = createMetaRecord({
      spaceId: "space-members-purpose-legacy",
      createdAt: "2026-03-06T12:14:00.000Z",
      updatedAt: "2026-03-06T12:14:00.000Z",
      creator: createHumanCreator("hum-members-creator-purpose", "Space Host"),
    });

    sql.seedSignal(
      createTextSignal({
        signalId: "sig-purpose-legacy-notice",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:15:00.000Z",
        profile: createHumanProfile(
          "hum-members-creator-purpose",
          "Space Host"
        ),
        text: "Space Host added 🤖 Legacy Bot to this space.",
        meta: {
          purpose: "space_membership_join_notice",
        },
      })
    );
    sql.seedSignal(
      createTextSignal({
        signalId: "sig-purpose-legacy-target",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:16:00.000Z",
        profile: createAgentProfile({
          profileId: "agt-purpose-legacy-bot-1",
          profileName: "Legacy Bot",
          ownerUserId: "owner-members-creator-purpose",
          agentControllerRef: "builtin:legacy-bot",
        }),
        text: "hello from legacy bot",
      })
    );

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:17:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt-purpose-legacy-bot-1",
          memberSource: "added_by_member",
          memberSourceLabel: "Added by Space Host",
        }),
      ])
    );
  });

  it("treats status-only agent activity as membership evidence", async () => {
    const sql = new MutableSqlStorage();
    const statusOnlyAgentProfileId = "agt_00000000-0000-4000-8000-000000000101";
    const metaRecord = createMetaRecord({
      spaceId: "space-members-status-only",
      createdAt: "2026-03-06T12:18:00.000Z",
      updatedAt: "2026-03-06T12:18:00.000Z",
      creator: createHumanCreator("hum-members-status-host", "Space Host"),
    });

    sql.seedSignal(
      createStatusSignal({
        signalId: "sig-status-only-agent",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:19:00.000Z",
        profile: createAgentProfile({
          profileId: statusOnlyAgentProfileId,
          profileName: "Status Agent",
          ownerUserId: "owner-status-agent",
          agentControllerRef: "builtin:status-agent",
        }),
        status: "done",
        text: "Status Agent is ready.",
      })
    );

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:20:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: statusOnlyAgentProfileId,
          profileName: "Status Agent",
          profileKind: "agent",
        }),
      ])
    );
  });

  it("treats system notices with actorProfileId as membership evidence", async () => {
    const sql = new MutableSqlStorage();
    const systemNoticeOnlyAgentProfileId =
      "agt_00000000-0000-4000-8000-000000000102";
    const metaRecord = createMetaRecord({
      spaceId: "space-members-system-notice-only",
      createdAt: "2026-03-06T12:21:00.000Z",
      updatedAt: "2026-03-06T12:21:00.000Z",
      creator: createHumanCreator(
        "hum-members-system-notice-host",
        "Space Host"
      ),
    });

    sql.seedSignal(
      createSystemNoticeSignal({
        signalId: "sig-system-notice-only-agent",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:22:00.000Z",
        actorProfileId: systemNoticeOnlyAgentProfileId,
        actorName: "Silent Agent",
        text: "Silent Agent chose to stay silent: waiting for the founder's reply.",
      })
    );

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:23:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: systemNoticeOnlyAgentProfileId,
          profileName: "Silent Agent",
          profileKind: "agent",
        }),
      ])
    );
  });

  it("does not overwrite an existing member name with actorProfileId when a system notice lacks actorName", async () => {
    const sql = new MutableSqlStorage();
    const agentProfileId = "agt_00000000-0000-4000-8000-000000000103";

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-system-notice-name-preserve",
      members: [
        {
          profileId: agentProfileId,
          profileName: "Known Agent",
          profileKind: "agent",
          ownerUserId: "owner-known-agent",
          ownerName: "Owner One",
          agentControllerRef: "builtin:known-agent",
        },
      ],
      actorProfileId: "hum-members-host-1",
      actorDisplayName: "Space Host",
      liveSessions: [],
      nowIso: "2026-03-06T12:24:00.000Z",
    });
    sql.seedSignal(
      createSystemNoticeSignal({
        signalId: "sig-system-notice-name-preserve",
        spaceId: "space-members-system-notice-name-preserve",
        ts: "2026-03-06T12:25:00.000Z",
        actorProfileId: agentProfileId,
        text: "Known Agent chose to stay silent: waiting for input.",
      })
    );

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-system-notice-name-preserve",
      liveSessions: [],
      nowIso: "2026-03-06T12:26:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: agentProfileId,
          profileName: "Known Agent",
        }),
      ])
    );
  });

  it.each([
    undefined,
    "agt_name_regression",
  ])("preserves a known name when text activity reports %s instead of a name", (profileName) => {
    const sql = new MutableSqlStorage();
    const profileId = "agt_name_regression";
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "name-regression",
      profile: {
        kind: "agent",
        profileId,
        profileName: "Amplift Center Agent",
      },
    });
    sql.seedSignal(
      createTextSignal({
        signalId: "missing-name",
        spaceId: "name-regression",
        ts: "2026-09-07T11:00:00.000Z",
        profile: {
          kind: "agent",
          profileId,
          ...(profileName ? { profileName } : {}),
        },
        text: "Working on the request",
      })
    );
    const directory = listSpaceMemberDirectoryUseCase({
      sql: sql as unknown as SqlStorage,
      spaceId: "name-regression",
      liveSessions: [],
    });
    expect(JSON.stringify(directory)).toContain("Amplift Center Agent");
  });

  it("refreshes an Auth rename and preserves it through old activity and sessions", async () => {
    const sql = new MutableSqlStorage();
    const profileId = "agt_repair_name";
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "repair-name",
      profile: {
        kind: "agent",
        profileId,
        profileName: "Previous Center Agent",
      },
    });
    const resolveProfilesByIds = vi.fn(() =>
      Promise.resolve({
        ok: true,
        profiles: {
          [profileId]: {
            profileId,
            profileKind: "agent",
            profileName: "Amplift Center Agent",
            profileHandle: "amplift-center-agent",
            ownerUserId: "owner-1",
            status: "active",
          },
        },
      })
    );
    const input = {
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({
        OPENMELD_AUTH_WORKER: { resolveProfilesByIds },
      } as unknown as CoreBindings),
    };
    expect((await refreshSpaceMemberNamesFromAuth(input)).changed).toBe(true);
    sql.seedSignal(
      createTextSignal({
        signalId: "old-id-name",
        spaceId: "repair-name",
        ts: "2026-09-07T11:00:00.000Z",
        profile: {
          kind: "agent",
          profileId,
          profileName: "Previous Center Agent",
        },
        text: "Earlier reply",
      })
    );
    const directory = listSpaceMemberDirectoryUseCase({
      sql: input.sql,
      spaceId: "repair-name",
      liveSessions: [
        {
          profile: {
            kind: "agent",
            profileId,
            profileName: "Previous Center Agent",
          },
        },
      ],
    });
    expect(JSON.stringify(directory)).toContain("Amplift Center Agent");
    expect((await refreshSpaceMemberNamesFromAuth(input)).changed).toBe(false);
    expect(resolveProfilesByIds).toHaveBeenCalledTimes(2);
    upsertJoinedSpaceMember({
      sql: input.sql,
      spaceId: "repair-name",
      profile: {
        kind: "agent",
        profileId,
        profileName: "Previous Center Agent",
      },
    });
    expect(
      readSpaceMemberRecord(input.sql, profileId)?.profileNameSnapshot
    ).toBe("Amplift Center Agent");
  });

  it("bounds the whole name refresh and ignores late Auth results", async () => {
    const sql = new MutableSqlStorage();
    const lateReplies: Array<() => void> = [];
    for (let index = 0; index < 17; index++) {
      upsertJoinedSpaceMember({
        sql: sql as unknown as SqlStorage,
        spaceId: "name-deadline",
        profile: {
          kind: "agent",
          profileId: `agt_deadline_${index}`,
          profileName: "Known Agent",
        },
      });
    }
    const resolveProfilesByIds = vi.fn(
      ({ profileIds }: { profileIds: string[] }) =>
        new Promise((resolve) => {
          lateReplies.push(() =>
            resolve({
              ok: true,
              profiles: Object.fromEntries(
                profileIds.map((profileId) => [
                  profileId,
                  {
                    profileId,
                    profileKind: "agent",
                    profileName: "Late Name",
                    profileHandle: "late-agent",
                    ownerUserId: "owner",
                    status: "active",
                  },
                ])
              ),
            })
          );
        })
    );
    const startedAt = Date.now();
    expect(
      await refreshSpaceMemberNamesFromAuth({
        sql: sql as unknown as SqlStorage,
        env: withProjectionBinding({
          OPENMELD_AUTH_WORKER: { resolveProfilesByIds },
        } as unknown as CoreBindings),
      })
    ).toEqual({ changed: false, profileFacts: null });
    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(resolveProfilesByIds).toHaveBeenCalledTimes(1);
    expect(resolveProfilesByIds.mock.calls[0]?.[0].profileIds).toHaveLength(17);
    const member = readSpaceMemberRecord(
      sql as unknown as SqlStorage,
      "agt_deadline_0"
    );
    if (!member) {
      throw new Error("Missing member");
    }
    upsertSpaceMemberRecord(sql as unknown as SqlStorage, {
      ...member,
      profileNameSnapshot: "Newer Name",
    });
    for (const reply of lateReplies) {
      reply();
    }
    await Promise.resolve();
    await Promise.resolve();
    expect(
      readSpaceMemberRecord(sql as unknown as SqlStorage, member.profileId)
        ?.profileNameSnapshot
    ).toBe("Newer Name");
  });

  it.each([
    "mismatch",
    "unavailable",
    "removed",
    "concurrent rename",
  ])("does not repair from %s identity evidence", async (scenario) => {
    const sql = new MutableSqlStorage();
    const profileId = "agt_repair_rejected";
    const member = upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: "repair-rejected",
      profile: { kind: "agent", profileId },
    });
    if (!member) {
      throw new Error("Missing fixture member");
    }
    const resolveProfilesByIds = vi.fn(() => {
      if (scenario === "unavailable") {
        throw new Error("Auth unavailable");
      }
      if (scenario === "removed") {
        upsertSpaceMemberRecord(sql as unknown as SqlStorage, {
          ...member,
          status: "removed",
        });
      }
      if (scenario === "concurrent rename") {
        upsertSpaceMemberRecord(sql as unknown as SqlStorage, {
          ...member,
          profileNameSnapshot: "Newer Auth Name",
        });
      }
      return Promise.resolve({
        ok: true,
        profiles: {
          [profileId]: {
            profileId: scenario === "mismatch" ? "agt_other" : profileId,
            profileKind: "agent",
            profileName: "Center Agent",
            profileHandle: "center-agent",
            ownerUserId: "owner-1",
            status: "active",
          },
        },
      });
    });
    expect(
      await refreshSpaceMemberNamesFromAuth({
        sql: sql as unknown as SqlStorage,
        env: withProjectionBinding({
          OPENMELD_AUTH_WORKER: { resolveProfilesByIds },
        } as unknown as CoreBindings),
      })
    ).toMatchObject({ changed: false });
    if (scenario === "concurrent rename") {
      expect(
        readSpaceMemberRecord(sql as unknown as SqlStorage, profileId)
          ?.profileNameSnapshot
      ).toBe("Newer Auth Name");
    }
  });

  it("reads stored signals once when building a members snapshot", async () => {
    const sql = new MutableSqlStorage();
    const metaRecord = createMetaRecord({
      spaceId: "space-members-single-signal-read",
      createdAt: "2026-03-06T12:27:00.000Z",
      updatedAt: "2026-03-06T12:27:00.000Z",
      creator: createHumanCreator("hum-members-single-read-host", "Space Host"),
    });

    sql.seedSignal(
      createTextSignal({
        signalId: "sig-members-single-read-1",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:28:00.000Z",
        profile: createHumanProfile(
          "hum-members-single-read-host",
          "Space Host"
        ),
        text: "Welcome to the room.",
      })
    );
    sql.seedSignal(
      createStatusSignal({
        signalId: "sig-members-single-read-2",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:28:30.000Z",
        profile: createAgentProfile({
          profileId: "agt_00000000-0000-4000-8000-000000000104",
          profileName: "Status Agent",
          ownerUserId: "owner-status-agent-2",
          agentControllerRef: "builtin:status-agent-2",
        }),
        status: "done",
        text: "Done.",
      })
    );
    sql.seedSignal(
      createSystemNoticeSignal({
        signalId: "sig-members-single-read-3",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:29:00.000Z",
        actorProfileId: "agt_00000000-0000-4000-8000-000000000105",
        actorName: "Silent Agent",
        text: "Silent Agent chose to stay silent: waiting for input.",
      })
    );

    await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:30:00.000Z",
    });

    expect(sql.getSignalPayloadSelectCount()).toBe(1);
    expect(sql.getSignalActivitySelectCount()).toBe(0);
  });

  it("backfills cursor-only members from exact-id add notices without forcing them to agent", async () => {
    const sql = new MutableSqlStorage();
    const creatorProfileId = "33333333-3333-4333-8333-333333333333";
    const targetProfileId = "44444444-4444-4444-8444-444444444444";
    const metaRecord = createMetaRecord({
      spaceId: "space-members-cursor",
      createdAt: "2026-03-06T12:20:00.000Z",
      updatedAt: "2026-03-06T12:20:00.000Z",
      creator: createHumanCreator(creatorProfileId, "Space Host"),
    });

    sql.seedSignal(
      createTextSignal({
        signalId: "sig-cursor-notice",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:21:00.000Z",
        profile: createHumanProfile(creatorProfileId, "Space Host"),
        text: "Space Host added Human Helper to this space.",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId,
          targetProfileKind: "human",
          addedByProfileId: creatorProfileId,
          addedByDisplayName: "Space Host",
        },
      })
    );
    sql.seedCursor({
      profileId: targetProfileId,
      mentionAlias: "human-helper",
      lastSeenAt: "2026-03-06T12:21:30.000Z",
      createdAt: "2026-03-06T12:21:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:22:00.000Z",
    });

    expect(snapshot.summary).toMatchObject({
      totalCount: 2,
      humanCount: 2,
      agentCount: 0,
    });
    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: targetProfileId,
          profileKind: "human",
          memberSource: "added_by_member",
        }),
      ])
    );
    expect(snapshot.agents).toEqual([]);
  });

  it("ignores persisted presence rows when deriving lastSeenAt for member snapshots", async () => {
    const sql = new MutableSqlStorage();
    const targetProfileId = "77777777-7777-4777-8777-777777777777";
    const metaRecord = createMetaRecord({
      spaceId: "space-members-last-seen",
      createdAt: "2026-03-06T12:00:00.000Z",
      updatedAt: "2026-03-06T12:00:00.000Z",
      creator: createHumanCreator("hum-members-last-seen-host", "Space Host"),
    });

    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      profile: createHumanProfile(targetProfileId, "Human Helper"),
      nowIso: "2026-03-06T12:20:00.000Z",
    });

    sql.seedSignal(
      createTextSignal({
        signalId: "sig-last-seen-text",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:25:00.000Z",
        profile: createHumanProfile(targetProfileId, "Human Helper"),
        text: "hello from helper",
      })
    );
    sql.seedSignal({
      v: 1,
      id: "sig-last-seen-presence",
      spaceId: metaRecord.spaceId,
      ts: Date.parse("2026-03-06T12:40:00.000Z"),
      profile: createHumanProfile(targetProfileId, "Human Helper"),
      type: "presence.join",
      data: {},
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:45:00.000Z",
    });

    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: targetProfileId,
          lastSeenAt: "2026-03-06T12:25:00.000Z",
        }),
      ])
    );
  });

  it("repairs existing joined members to added_by_member when a stronger exact-id hint exists", async () => {
    const sql = new MutableSqlStorage();
    const creatorProfileId = "55555555-5555-4555-8555-555555555555";
    const targetProfileId = "66666666-6666-4666-8666-666666666666";
    const metaRecord = createMetaRecord({
      spaceId: "space-members-repair",
      createdAt: "2026-03-06T12:30:00.000Z",
      updatedAt: "2026-03-06T12:30:00.000Z",
      creator: createHumanCreator(creatorProfileId, "Space Host"),
    });

    sql.seedSignal(
      createTextSignal({
        signalId: "sig-repair-notice",
        spaceId: metaRecord.spaceId,
        ts: "2026-03-06T12:31:00.000Z",
        profile: createHumanProfile(creatorProfileId, "Space Host"),
        text: "Space Host added Human Helper to this space.",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId,
          targetProfileKind: "human",
          addedByProfileId: creatorProfileId,
          addedByDisplayName: "Space Host",
        },
      })
    );

    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      profile: createHumanProfile(targetProfileId, "Human Helper"),
      nowIso: "2026-03-06T12:32:00.000Z",
    });

    sql.seedWebActivity(targetProfileId, "2026-03-06T12:33:00.000Z");

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [
        {
          enforcedProfile: createHumanProfile(targetProfileId, "Human Helper"),
        },
      ],
      metaRecord,
      nowIso: "2026-03-06T12:33:00.000Z",
    });

    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: targetProfileId,
          memberSource: "added_by_member",
          memberSourceLabel: "Added by Space Host",
          addedAt: "2026-03-06T12:31:00.000Z",
          firstEnteredAt: "2026-03-06T12:32:00.000Z",
          lastEnteredAt: "2026-03-06T12:33:00.000Z",
          liveNow: true,
        }),
      ])
    );
  });

  it("dedupes repeated items in addSpaceMembersUseCase responses", async () => {
    const sql = new MutableSqlStorage();

    const response = await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-dedupe",
      members: [
        {
          profileId: "agt-members-dedupe-1",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Mira",
          agentControllerRef: "builtin:ops-bot",
        },
        {
          profileId: "agt-members-dedupe-1",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Mira",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-1",
      actorOwnerUserId: "owner-1",
      actorDisplayName: "Mira",
      liveSessions: [],
      nowIso: "2026-03-06T12:40:00.000Z",
    });

    expect(response.addedMemberIds).toEqual(["agt-members-dedupe-1"]);
    expect(response.alreadyMemberIds).toEqual([]);
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({
      profileId: "agt-members-dedupe-1",
      memberSource: "added_by_member",
      memberSourceLabel: "Added by Mira",
    });
  });

  it("builds add-members response items from the requested members without scanning the full Space", async () => {
    const sql = new MutableSqlStorage();
    const authWorker = {
      resolveProfileById: vi.fn(() => {
        throw new Error("readiness lookup should not run for add-members");
      }),
    };
    const env = { OPENMELD_AUTH_WORKER: authWorker } as unknown as CoreBindings;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env,
      spaceId: "space-members-targeted-response",
      members: [
        {
          profileId: "agt-members-existing-unrelated",
          profileName: "Existing Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Mira",
          agentControllerRef: "builtin:existing-bot",
        },
      ],
      actorProfileId: "hum-members-host-1",
      actorOwnerUserId: "owner-1",
      actorDisplayName: "Mira",
      liveSessions: [],
      nowIso: "2026-03-06T12:40:00.000Z",
    });
    const allMemberSelectCountBefore = sql.getMemberSelectAllCount();

    const response = await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env,
      spaceId: "space-members-targeted-response",
      members: [
        {
          profileId: "agt-members-targeted-new",
          profileName: "New Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Mira",
          agentControllerRef: "builtin:new-bot",
        },
      ],
      actorProfileId: "hum-members-host-1",
      actorOwnerUserId: "owner-1",
      actorDisplayName: "Mira",
      liveSessions: [],
      nowIso: "2026-03-06T12:41:00.000Z",
    });

    expect(sql.getMemberSelectAllCount()).toBe(allMemberSelectCountBefore);
    expect(authWorker.resolveProfileById).not.toHaveBeenCalled();
    expect(response.items.map((item) => item.profileId)).toEqual([
      "agt-members-targeted-new",
    ]);
    expect(response.items[0]).not.toHaveProperty("publicReplyPresence");
    expect(response.items[0]).not.toHaveProperty("viewerLocalControl");
  });

  it("removes active members and keeps removed members out of snapshots", async () => {
    const sql = new MutableSqlStorage();
    const metaRecord = createMetaRecord({
      spaceId: "space-members-remove",
      createdAt: "2026-03-06T12:00:00.000Z",
      updatedAt: "2026-03-06T12:00:00.000Z",
      creator: createHumanCreator("hum-members-remove-host", "Space Host"),
    });

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      members: [
        {
          profileId: "agt-members-remove-target",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-remove-1",
          ownerName: "Mira",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-remove-host",
      actorOwnerUserId: "owner-remove-1",
      actorDisplayName: "Mira",
      liveSessions: [],
      nowIso: "2026-03-06T12:10:00.000Z",
    });

    const response = removeSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      memberProfileIds: [
        "agt-members-remove-target",
        "agt-members-remove-target",
        "agt-members-remove-missing",
      ],
      actorProfileId: "hum-members-remove-host",
      actorOwnerUserId: "owner-remove-1",
      metaRecord,
      nowIso: "2026-03-06T12:20:00.000Z",
    });

    expect(response).toEqual({
      removedMemberIds: ["agt-members-remove-target"],
      alreadyAbsentMemberIds: ["agt-members-remove-missing"],
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:21:00.000Z",
    });

    expect(snapshot.agents).toEqual([]);
    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "hum-members-remove-host",
          memberSource: "space_creator",
        }),
      ])
    );
  });

  it("rejects removing the current profile as one atomic batch", async () => {
    const sql = new MutableSqlStorage();

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-remove-self",
      members: [
        {
          profileId: "agt-members-remove-other",
          profileName: "Other Bot",
          profileKind: "agent",
          ownerUserId: "owner-remove-self-1",
          ownerName: "Mira",
          agentControllerRef: "builtin:other-bot",
        },
      ],
      actorProfileId: "hum-members-remove-self",
      actorOwnerUserId: "owner-remove-self-1",
      actorDisplayName: "Mira",
      liveSessions: [],
      nowIso: "2026-03-06T12:30:00.000Z",
    });

    expect(() =>
      removeSpaceMembersUseCase({
        sql: sql as unknown as SqlStorage,
        spaceId: "space-members-remove-self",
        memberProfileIds: [
          "hum-members-remove-self",
          "agt-members-remove-other",
        ],
        actorProfileId: "hum-members-remove-self",
        actorOwnerUserId: "owner-remove-self-1",
        nowIso: "2026-03-06T12:31:00.000Z",
      })
    ).toThrowError(
      expect.objectContaining<Partial<SpaceMembersUseCaseError>>({
        code: "space.members.current_profile_forbidden",
        status: 400,
      })
    );

    const retained = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-remove-self",
      liveSessions: [],
      nowIso: "2026-03-06T12:32:00.000Z",
    });
    expect(retained.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt-members-remove-other",
        }),
      ])
    );
  });

  it("rejects removing an active Space owner", () => {
    const sql = new MutableSqlStorage();
    const metaRecord = {
      ...createMetaRecord({
        spaceId: "space-members-remove-creator",
        createdAt: "2026-03-06T12:40:00.000Z",
        updatedAt: "2026-03-06T12:40:00.000Z",
        creator: createHumanCreator(
          "hum-members-remove-creator",
          "Space Host",
          { ownerUserId: "owner-remove-creator-1" }
        ),
      }),
      ownerUserIds: ["owner-remove-creator-1"],
    };

    upsertSpaceCreatorMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      creator: metaRecord.creator,
      nowIso: "2026-03-06T12:40:00.000Z",
    });

    expect(() =>
      removeSpaceMembersUseCase({
        sql: sql as unknown as SqlStorage,
        spaceId: metaRecord.spaceId,
        memberProfileIds: ["hum-members-remove-creator"],
        actorProfileId: "hum-members-operator",
        actorOwnerUserId: "owner-operator",
        metaRecord,
        nowIso: "2026-03-06T12:41:00.000Z",
      })
    ).toThrowError(
      expect.objectContaining<Partial<SpaceMembersUseCaseError>>({
        code: "space.members.owner_forbidden",
        status: 400,
      })
    );
  });

  it("lets an active non-creator leave the space", async () => {
    const sql = new MutableSqlStorage();
    const metaRecord = createMetaRecord({
      spaceId: "space-members-leave",
      createdAt: "2026-03-06T12:50:00.000Z",
      updatedAt: "2026-03-06T12:50:00.000Z",
      creator: createHumanCreator("hum-members-leave-host", "Space Host"),
    });

    upsertSpaceCreatorMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      creator: metaRecord.creator,
      nowIso: "2026-03-06T12:50:00.000Z",
    });
    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      members: [
        {
          profileId: "22222222-2222-4222-8222-222222222222",
          profileName: "Felix",
          profileKind: "human",
          ownerUserId: "owner-leave-1",
          ownerName: "Felix",
          agentControllerRef: null,
        },
      ],
      actorProfileId: "hum-members-leave-host",
      actorOwnerUserId: "owner-host",
      actorDisplayName: "Space Host",
      liveSessions: [],
      nowIso: "2026-03-06T12:51:00.000Z",
    });

    const response = leaveSpaceUseCase({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      actorProfileId: "22222222-2222-4222-8222-222222222222",
      actorOwnerUserId: "owner-leave-1",
      metaRecord,
      nowIso: "2026-03-06T12:52:00.000Z",
    });

    expect(response).toEqual({
      leftProfileId: "22222222-2222-4222-8222-222222222222",
      status: "left",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: metaRecord.spaceId,
      liveSessions: [],
      metaRecord,
      nowIso: "2026-03-06T12:53:00.000Z",
    });
    expect(snapshot.humans).toEqual([
      expect.objectContaining({
        profileId: "hum-members-leave-host",
        memberSource: "space_creator",
      }),
    ]);
  });

  it("rejects owner leave and treats absent actors as already absent", () => {
    const sql = new MutableSqlStorage();
    const metaRecord = {
      ...createMetaRecord({
        spaceId: "space-members-leave-creator",
        createdAt: "2026-03-06T13:00:00.000Z",
        updatedAt: "2026-03-06T13:00:00.000Z",
        creator: createHumanCreator("hum-members-leave-creator", "Space Host", {
          ownerUserId: "owner-host",
        }),
      }),
      ownerUserIds: ["owner-host"],
    };

    upsertSpaceCreatorMember({
      sql: sql as unknown as SqlStorage,
      spaceId: metaRecord.spaceId,
      creator: metaRecord.creator,
      nowIso: "2026-03-06T13:00:00.000Z",
    });

    expect(() =>
      leaveSpaceUseCase({
        sql: sql as unknown as SqlStorage,
        spaceId: metaRecord.spaceId,
        actorProfileId: "hum-members-leave-creator",
        actorOwnerUserId: "owner-host",
        metaRecord,
        nowIso: "2026-03-06T13:01:00.000Z",
      })
    ).toThrowError(
      expect.objectContaining<Partial<SpaceMembersUseCaseError>>({
        code: "space.leave_space.owner_forbidden",
        status: 400,
      })
    );

    expect(
      leaveSpaceUseCase({
        sql: sql as unknown as SqlStorage,
        spaceId: metaRecord.spaceId,
        actorProfileId: "33333333-3333-4333-8333-333333333333",
        actorOwnerUserId: "owner-absent",
        metaRecord,
        nowIso: "2026-03-06T13:02:00.000Z",
      })
    ).toEqual({
      leftProfileId: "33333333-3333-4333-8333-333333333333",
      status: "already_absent",
    });
  });

  it("shows agentControllerConversationId only to lineage viewers in members snapshots", async () => {
    const sql = new MutableSqlStorage();
    const lineageEnv = {
      OPENMELD_AUTH_WORKER: {
        listProfileLineage() {
          return Promise.resolve({
            ok: true as const,
            profiles: [
              {
                profileId: "hum-members-host-ctx",
                creatorProfileId: null,
              },
              {
                profileId: "agt-members-context-1",
                creatorProfileId: "hum-members-host-ctx",
              },
            ],
          });
        },
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-context-1",
              profileHandle: "context-bot",
              profileId: input.openMeldProfileId ?? "agt-members-context-1",
              profileKind: "agent" as const,
              profileName: "Context Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-context",
      members: [
        {
          profileId: "agt-members-context-1",
          profileName: "Context Bot",
          profileKind: "agent",
          ownerUserId: "owner-context-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:context-bot",
        },
      ],
      actorProfileId: "hum-members-host-ctx",
      actorOwnerUserId: "owner-context-1",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T12:50:00.000Z",
    });

    const ownerSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-context",
      viewerOwnerUserId: "owner-context-1",
      viewerProfileId: "hum-members-host-ctx",
      liveSessions: [
        {
          enforcedProfile: {
            ...createAgentProfile({
              profileId: "agt-members-context-1",
              profileName: "Context Bot",
              ownerUserId: "owner-context-1",
              agentControllerRef: "builtin:context-bot",
            }),
            agentControllerConversationId: "ctx-1",
            workingDirectory: " /tmp/live context ",
          },
        },
      ],
      nowIso: "2026-03-06T12:51:00.000Z",
    });
    const outsiderSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-context",
      viewerOwnerUserId: "owner-context-2",
      viewerProfileId: "hum-outsider",
      liveSessions: [
        {
          enforcedProfile: {
            ...createAgentProfile({
              profileId: "agt-members-context-1",
              profileName: "Context Bot",
              ownerUserId: "owner-context-1",
              agentControllerRef: "builtin:context-bot",
            }),
            agentControllerConversationId: "ctx-1",
            workingDirectory: " /tmp/live context ",
          },
        },
      ],
      nowIso: "2026-03-06T12:51:00.000Z",
    });

    expect(ownerSnapshot.agents[0]).toMatchObject({
      profileId: "agt-members-context-1",
      agentControllerConversationId: "ctx-1",
      workingDirectory: " /tmp/live context ",
    });
    expect(outsiderSnapshot.agents[0]).toMatchObject({
      profileId: "agt-members-context-1",
      agentControllerConversationId: null,
    });
    expect(outsiderSnapshot.agents[0]?.workingDirectory).toBeNull();
  });

  it("returns owner Wake diagnostics only to the agent owner", async () => {
    const sql = new MutableSqlStorage();
    const spaceId = "space-members-owner-diagnostics-control";

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId,
      members: [
        {
          profileId: "agt-members-owner-diagnostics",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-owner-diagnostics",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:03:00.000Z",
    });

    const ownerSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-owner-viewer",
      liveSessions: [],
      nowIso: "2026-03-06T13:04:00.000Z",
    });
    const outsiderSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId,
      viewerOwnerUserId: "owner-2",
      viewerProfileId: "hum-outsider-viewer",
      liveSessions: [],
      nowIso: "2026-03-06T13:04:00.000Z",
    });
    const unknownViewerSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId,
      liveSessions: [],
      nowIso: "2026-03-06T13:04:00.000Z",
    });

    expect(ownerSnapshot.agents[0]).toMatchObject({
      profileId: "agt-members-owner-diagnostics",
      ownerUserId: "owner-1",
      ownerName: "Owner One",
      agentControllerRef: "builtin:ops-bot",
      agentWakeAvailability: {
        status: expect.any(String),
      },
      ownerWakeDiagnostics: {
        agentExecutionReadiness: expect.objectContaining({
          agentProfileId: "agt-members-owner-diagnostics",
        }),
        wakeRouteEvidence: expect.objectContaining({
          status: expect.any(String),
        }),
      },
    });
    expect(ownerSnapshot.agents[0]).not.toHaveProperty("publicReplyPresence");
    expect(ownerSnapshot.agents[0]).not.toHaveProperty("viewerLocalControl");
    expect(ownerSnapshot.agents[0]).not.toHaveProperty(
      "agentExecutionReadiness"
    );
    expect(ownerSnapshot.agents[0]).not.toHaveProperty(
      "daemonRouteObservation"
    );
    expect(outsiderSnapshot.agents[0]).toMatchObject({
      profileId: "agt-members-owner-diagnostics",
      ownerUserId: "owner-1",
      ownerName: "Owner One",
      agentControllerRef: "builtin:ops-bot",
      agentWakeAvailability: {
        status: expect.any(String),
      },
      ownerWakeDiagnostics: null,
    });
    expect(outsiderSnapshot.agents[0]).not.toHaveProperty(
      "agentExecutionReadiness"
    );
    expect(outsiderSnapshot.agents[0]).not.toHaveProperty(
      "daemonRouteObservation"
    );
    expect(outsiderSnapshot.agents[0]).not.toHaveProperty(
      "publicReplyPresence"
    );
    expect(outsiderSnapshot.agents[0]).not.toHaveProperty("viewerLocalControl");
    expect(unknownViewerSnapshot.agents[0]).toMatchObject({
      profileId: "agt-members-owner-diagnostics",
      agentWakeAvailability: {
        status: expect.any(String),
      },
      ownerWakeDiagnostics: null,
    });
    expect(unknownViewerSnapshot.agents[0]).not.toHaveProperty(
      "agentExecutionReadiness"
    );
    expect(unknownViewerSnapshot.agents[0]).not.toHaveProperty(
      "daemonRouteObservation"
    );
    expect(unknownViewerSnapshot.agents[0]).not.toHaveProperty(
      "publicReplyPresence"
    );
    expect(unknownViewerSnapshot.agents[0]).not.toHaveProperty(
      "viewerLocalControl"
    );
  });

  it("falls back to a redacted members snapshot when lineage lookup throws", async () => {
    const sql = new MutableSqlStorage();
    const lineageEnv = {
      OPENMELD_AUTH_WORKER: {
        listProfileLineage() {
          throw new Error("auth lineage unavailable");
        },
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-context-1",
              profileHandle: "throws-bot",
              profileId: input.openMeldProfileId ?? "agt-members-throws-1",
              profileKind: "agent" as const,
              profileName: "Throws Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-lineage-throws",
      members: [
        {
          profileId: "agt-members-throws-1",
          profileName: "Throws Bot",
          profileKind: "agent",
          ownerUserId: "owner-throws-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:throws-bot",
        },
      ],
      actorProfileId: "hum-members-host-throws",
      actorOwnerUserId: "owner-throws-1",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T12:52:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-lineage-throws",
      viewerOwnerUserId: "owner-throws-1",
      viewerProfileId: "hum-members-host-throws",
      liveSessions: [
        {
          enforcedProfile: {
            ...createAgentProfile({
              profileId: "agt-members-throws-1",
              profileName: "Throws Bot",
              ownerUserId: "owner-throws-1",
              agentControllerRef: "builtin:throws-bot",
            }),
            agentControllerConversationId: "ctx-throws-1",
          },
        },
      ],
      nowIso: "2026-03-06T12:53:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt-members-throws-1",
      agentControllerConversationId: null,
    });
  });

  it("falls back to the latest stored signal origin in members snapshots", async () => {
    const sql = new MutableSqlStorage();
    const lineageEnv = {
      OPENMELD_AUTH_WORKER: {
        listProfileLineage() {
          return Promise.resolve({
            ok: true as const,
            profiles: [
              {
                profileId: "hum-members-host-fallback",
                creatorProfileId: null,
              },
              {
                profileId: "agt-members-fallback-1",
                creatorProfileId: "hum-members-host-fallback",
              },
            ],
          });
        },
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-context-1",
              profileHandle: "fallback-bot",
              profileId: input.openMeldProfileId ?? "agt-members-fallback-1",
              profileKind: "agent" as const,
              profileName: "Fallback Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-context-fallback",
      members: [
        {
          profileId: "agt-members-fallback-1",
          profileName: "Fallback Bot",
          profileKind: "agent",
          ownerUserId: "owner-context-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:context-bot",
        },
      ],
      actorProfileId: "hum-members-host-fallback",
      actorOwnerUserId: "owner-context-1",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T12:55:00.000Z",
    });
    sql.seedSignal(
      createTextSignal({
        signalId: "evt-members-fallback-1",
        spaceId: "space-members-context-fallback",
        ts: "2026-03-06T12:56:00.000Z",
        profile: {
          ...createAgentProfile({
            profileId: "agt-members-fallback-1",
            profileName: "Fallback Bot",
            ownerUserId: "owner-context-1",
            agentControllerRef: "builtin:context-bot",
          }),
          agentControllerConversationId: "ctx-fallback-1",
          workingDirectory: " /tmp/fallback origin ",
        },
        text: "hello from fallback",
      })
    );

    const ownerSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-context-fallback",
      viewerOwnerUserId: "owner-context-1",
      viewerProfileId: "hum-members-host-fallback",
      liveSessions: [],
      nowIso: "2026-03-06T12:57:00.000Z",
    });
    const outsiderSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-context-fallback",
      viewerOwnerUserId: "owner-context-2",
      viewerProfileId: "hum-outsider",
      liveSessions: [],
      nowIso: "2026-03-06T12:57:00.000Z",
    });

    expect(ownerSnapshot.agents[0]).toMatchObject({
      profileId: "agt-members-fallback-1",
      agentControllerConversationId: "ctx-fallback-1",
      workingDirectory: " /tmp/fallback origin ",
    });
    expect(outsiderSnapshot.agents[0]).toMatchObject({
      profileId: "agt-members-fallback-1",
      agentControllerConversationId: null,
    });
    expect(outsiderSnapshot.agents[0]?.workingDirectory).toBeNull();
  });

  it("shows descendant origins to a parent agent but hides sibling origins in members snapshots", async () => {
    const sql = new MutableSqlStorage();
    const lineageEnv = {
      OPENMELD_AUTH_WORKER: {
        listProfileLineage() {
          return Promise.resolve({
            ok: true as const,
            profiles: [
              {
                profileId: "hum-lineage-root",
                creatorProfileId: null,
              },
              {
                profileId: "agt-lineage-parent",
                creatorProfileId: "hum-lineage-root",
              },
              {
                profileId: "agt-lineage-child",
                creatorProfileId: "agt-lineage-parent",
              },
              {
                profileId: "agt-lineage-sibling",
                creatorProfileId: "hum-lineage-root",
              },
            ],
          });
        },
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          const profileId = input.openMeldProfileId ?? "agt-lineage-parent";
          const profileNameById: Record<string, string> = {
            "agt-lineage-parent": "Parent Agent",
            "agt-lineage-child": "Child Agent",
            "agt-lineage-sibling": "Sibling Agent",
          };
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-lineage-1",
              profileHandle: profileNameById[profileId]
                ? profileNameById[profileId].toLowerCase().replaceAll(" ", "-")
                : "lineage-agent",
              profileId,
              profileKind: "agent" as const,
              profileName: profileNameById[profileId] ?? "Lineage Agent",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-lineage-tree",
      members: [
        {
          profileId: "agt-lineage-parent",
          profileName: "Parent Agent",
          profileKind: "agent",
          ownerUserId: "owner-lineage-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:parent",
        },
        {
          profileId: "agt-lineage-child",
          profileName: "Child Agent",
          profileKind: "agent",
          ownerUserId: "owner-lineage-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:child",
        },
        {
          profileId: "agt-lineage-sibling",
          profileName: "Sibling Agent",
          profileKind: "agent",
          ownerUserId: "owner-lineage-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:sibling",
        },
      ],
      actorProfileId: "hum-lineage-root",
      actorOwnerUserId: "owner-lineage-1",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T12:58:00.000Z",
    });
    sql.seedSignal(
      createTextSignal({
        signalId: "evt-lineage-child",
        spaceId: "space-members-lineage-tree",
        ts: "2026-03-06T12:58:30.000Z",
        profile: {
          ...createAgentProfile({
            profileId: "agt-lineage-child",
            profileName: "Child Agent",
            ownerUserId: "owner-lineage-1",
            agentControllerRef: "builtin:child",
          }),
          agentControllerConversationId: "ctx-lineage-child",
        },
        text: "child signal",
      })
    );
    sql.seedSignal(
      createTextSignal({
        signalId: "evt-lineage-sibling",
        spaceId: "space-members-lineage-tree",
        ts: "2026-03-06T12:58:45.000Z",
        profile: {
          ...createAgentProfile({
            profileId: "agt-lineage-sibling",
            profileName: "Sibling Agent",
            ownerUserId: "owner-lineage-1",
            agentControllerRef: "builtin:sibling",
          }),
          agentControllerConversationId: "ctx-lineage-sibling",
        },
        text: "sibling signal",
      })
    );

    const parentViewerSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-lineage-tree",
      viewerOwnerUserId: "owner-lineage-1",
      viewerProfileId: "agt-lineage-parent",
      liveSessions: [],
      nowIso: "2026-03-06T12:59:00.000Z",
    });
    const ownerViewerSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(lineageEnv as unknown as CoreBindings),
      spaceId: "space-members-lineage-tree",
      viewerOwnerUserId: "owner-lineage-1",
      viewerProfileId: "hum-lineage-root",
      liveSessions: [],
      nowIso: "2026-03-06T12:59:00.000Z",
    });

    const parentViewByProfileId = new Map(
      parentViewerSnapshot.agents.map(
        (agent) => [agent.profileId, agent] as const
      )
    );
    const ownerViewByProfileId = new Map(
      ownerViewerSnapshot.agents.map(
        (agent) => [agent.profileId, agent] as const
      )
    );

    expect(parentViewByProfileId.get("agt-lineage-child")).toMatchObject({
      profileId: "agt-lineage-child",
      agentControllerConversationId: "ctx-lineage-child",
    });
    expect(parentViewByProfileId.get("agt-lineage-sibling")).toMatchObject({
      profileId: "agt-lineage-sibling",
      agentControllerConversationId: null,
    });
    expect(ownerViewByProfileId.get("agt-lineage-child")).toMatchObject({
      profileId: "agt-lineage-child",
      agentControllerConversationId: "ctx-lineage-child",
    });
    expect(ownerViewByProfileId.get("agt-lineage-sibling")).toMatchObject({
      profileId: "agt-lineage-sibling",
      agentControllerConversationId: "ctx-lineage-sibling",
    });
  });

  it("preserves explicit mention aliases without leaking derived labels into member snapshots", async () => {
    const sql = new MutableSqlStorage();

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-handles",
      members: [
        {
          profileId: "agt-members-helper",
          profileName: "Helper",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:helper",
        },
        {
          profileId: "agt-members-claude",
          profileName: "Claude Code",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:claude",
        },
      ],
      actorProfileId: "hum-members-host-handles",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:00:00.000Z",
    });
    sql.seedCursor({
      profileId: "agt-members-claude",
      mentionAlias: "helper",
      createdAt: "2026-03-06T13:00:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-handles",
      liveSessions: [],
      nowIso: "2026-03-06T13:01:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt-members-helper",
          mentionAlias: null,
          agentWakeAvailability: expect.objectContaining({
            status: "unavailable_for_wake",
          }),
        }),
        expect.objectContaining({
          profileId: "agt-members-claude",
          mentionAlias: "helper",
          agentWakeAvailability: expect.objectContaining({
            status: "unavailable_for_wake",
          }),
        }),
      ])
    );
  });

  it("keeps Wake checking until an online route also has current controller facts", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: {
        agt_route_online: {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "session-1",
          deviceId: "device-1",
          lane: "dev-local",
          lastHeartbeatMs: 1,
          leaseEpoch: 1,
          online: true,
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
          serviceVersion: "999.0.0",
        },
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_route_online",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "ops-bot",
              profileId: input.openMeldProfileId ?? "agt_ops_bot",
              profileKind: "agent" as const,
              profileName: "Ops Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-online",
      members: [
        {
          profileId: "agt_route_online",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-route-online",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:10:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-online",
      metaRecord: createReadinessMetaRecord(
        "space-members-route-online",
        "hum-members-host-route-online"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-route-online",
      liveSessions: [],
      nowIso: "2026-03-06T13:11:00.000Z",
    });
    const outsiderSnapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-online",
      metaRecord: createReadinessMetaRecord(
        "space-members-route-online",
        "hum-members-host-route-online"
      ),
      viewerOwnerUserId: "owner-2",
      viewerProfileId: "hum-outsider-route-online",
      liveSessions: [],
      nowIso: "2026-03-06T13:11:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_route_online",
      runtimeDeviceDisplayName: "Felix's composer",
      agentWakeAvailability: {
        status: "checking_connection",
      },
      ownerWakeDiagnostics: {
        state: "checking_wake_status",
        wakeRouteEvidence: {
          reasonCode: "online",
          status: "online",
        },
        agentExecutionReadiness: {
          displayState: "not_ready",
          facts: {
            route: {
              online: true,
              source: "daemon_route",
            },
          },
          reasonCodes: expect.arrayContaining([
            "agent_profile_binding.enabled_primary",
            "runtime.agent_controller_report_missing",
          ]),
        },
      },
    });
    expect(outsiderSnapshot.agents[0]).toMatchObject({
      profileId: "agt_route_online",
      agentWakeAvailability: {
        status: "checking_connection",
      },
      ownerWakeDiagnostics: null,
    });
    expect(outsiderSnapshot.agents[0]).not.toHaveProperty(
      "runtimeDeviceDisplayName"
    );
    expect(snapshot.agents[0]).not.toHaveProperty("publicReplyPresence");
    expect(snapshot.agents[0]).not.toHaveProperty("agentExecutionReadiness");
    expect(snapshot.agents[0]).not.toHaveProperty("daemonRouteObservation");
  });

  it("projects an unauthenticated Codex report into a wakeable member warning", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: {
        agt_codex_sign_in_warning: {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "session-1",
          deviceId: "device-1",
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
          lane: "dev-local",
          lastHeartbeatMs: 1,
          leaseEpoch: 1,
          online: true,
          serviceVersion: "999.0.0",
        },
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentControllerRef: "builtin:codex",
      agentControllerReport: {
        reasonCodes: [
          "provider_account.access_required",
          "controller.auth.unauthenticated",
        ],
        status: "unavailable",
      },
      agentProfileId: "agt_codex_sign_in_warning",
    });
    const env = {
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "codex",
              profileId: input.openMeldProfileId ?? "agt_codex_sign_in_warning",
              profileKind: "agent" as const,
              profileName: "Codex",
              status: "active" as const,
            },
          });
        },
      },
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      actorDisplayName: "Owner One",
      actorProfileId: "hum-members-host-codex-sign-in-warning",
      env: withProjectionBinding(env as unknown as CoreBindings),
      liveSessions: [],
      members: [
        {
          agentControllerRef: "builtin:codex",
          ownerName: "Owner One",
          ownerUserId: "owner-1",
          profileId: "agt_codex_sign_in_warning",
          profileKind: "agent",
          profileName: "Codex",
        },
      ],
      nowIso: "2026-03-06T13:10:00.000Z",
      spaceId: "space-members-codex-sign-in-warning",
      sql: sql as unknown as SqlStorage,
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      env: withProjectionBinding(env as unknown as CoreBindings),
      liveSessions: [],
      metaRecord: createReadinessMetaRecord(
        "space-members-codex-sign-in-warning",
        "hum-members-host-codex-sign-in-warning"
      ),
      nowIso: "2026-03-06T13:11:00.000Z",
      spaceId: "space-members-codex-sign-in-warning",
      sql: sql as unknown as SqlStorage,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-codex-sign-in-warning",
    });

    expect(snapshot.agents[0]).toMatchObject({
      agentWakeAvailability: {
        action: "none",
        badgeLabel: "Sign-in needed",
        category: "unavailable",
        phase: "provider_sign_in_needed",
        reasonCode: "controller.auth.unauthenticated",
        status: "unavailable_for_wake",
        summary:
          "Run codex login in a terminal on this computer to sign in to Codex.",
      },
      profileId: "agt_codex_sign_in_warning",
    });
  });

  it.each([
    65, 250,
  ])("reads only five Space member Profiles on a %i-profile runtime", async (runtimeProfileCount) => {
    const sql = new MutableSqlStorage();
    const profileIds = Array.from(
      { length: runtimeProfileCount },
      (_, index) => `agt_fanout_${index}`
    );
    const memberIds = profileIds.slice(0, 5);
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_fanout_0",
      agentProfileIds: profileIds,
      includeExpectedRouteBindings: true,
      agentControllerReport: { status: "ready", reasonCodes: [] },
    });
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const expectedRoutesService = await import(
      "../src/agent-profile-binding/application/local-runtime-expected-routes-service"
    );
    const expectedRoutesRead = vi.spyOn(
      expectedRoutesService,
      "readLocalRuntimeExpectedRoutes"
    );
    const resolveProfileById = vi.fn(
      async (input: { openMeldProfileId: string }) => ({
        ok: true as const,
        profile: {
          ownerUserId: "owner-1",
          profileHandle: input.openMeldProfileId,
          profileId: input.openMeldProfileId,
          profileKind: "agent" as const,
          profileName: input.openMeldProfileId,
          status: "active" as const,
          defaultProjectId: null,
        },
      })
    );
    const nowIso = "2026-03-06T13:11:00.000Z";
    const report = {
      daemonSessionId: "session-fanout",
      deviceId: "device-1",
      expectedRoutesContractVersion: "v4" as const,
      includedProfileIds: profileIds,
      lane: "dev-local" as const,
      reportedAtMs: Date.parse(nowIso),
      skippedProfiles: [],
      workingFolderObservations: profileIds.map((profileId) => ({
        bindingId: "binding-route-truth",
        configurationRevision: 1,
        defaultProjectId: null,
        localProjectBindingGeneration: null,
        observedAtMs: Date.parse(nowIso),
        profileId,
        reasonCode: null,
        source: "profile_workspace" as const,
        status: "ready" as const,
      })),
    };
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: Object.fromEntries(
        memberIds.map((profileId) => [
          profileId,
          {
            capabilities: {},
            connectionGeneration: 1,
            daemonSessionId: "session-fanout",
            deviceId: "device-1",
            lane: "dev-local" as const,
            lastHeartbeatMs: Date.parse(nowIso),
            leaseEpoch: 1,
            online: true as const,
            serviceVersion: "999.0.0",
            localWakeRouteReport: report,
            executionCompatibility: {
              expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              reasonCode: "daemon.runtime_contract.compatible",
              status: "compatible" as const,
            },
          },
        ])
      ),
    });
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockResolvedValue({
      online: false,
      reasonCode: "daemon.session.not_found",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: { resolveProfileById },
    } as unknown as CoreBindings;
    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env,
      spaceId: "space-fanout",
      members: memberIds.map((profileId) => ({
        profileId,
        profileName: profileId,
        profileKind: "agent" as const,
        ownerUserId: "owner-1",
        ownerName: "Owner",
        agentControllerRef: "builtin:ops-bot",
      })),
      actorProfileId: "human-fanout",
      actorDisplayName: "Owner",
      liveSessions: [],
      nowIso,
    });
    resolveProfileById.mockClear();
    routeDb.querySpy.mockClear();
    const snapshotInput = {
      sql: sql as unknown as SqlStorage,
      env,
      spaceId: "space-fanout",
      metaRecord: createReadinessMetaRecord("space-fanout", "human-fanout"),
      viewerOwnerUserId: "owner-1",
      liveSessions: [],
      nowIso,
    };
    // The public Space entrypoint owns one database façade per request.
    // Reopen the owner for every snapshot so failures cannot leak across requests.
    const readSnapshot = (
      input: Parameters<
        typeof listSpaceMembersSnapshotUseCase
      >[0] = snapshotInput
    ) =>
      withPostgresRequest(env.OPENMELD_POSTGRESQL, () =>
        listSpaceMembersSnapshotUseCase(input)
      );
    const first = await readSnapshot();
    expect(first.agents).toHaveLength(5);
    expect(
      first.agents.map((agent) => agent.agentWakeAvailability?.status)
    ).toEqual(Array.from({ length: 5 }, () => "available_for_wake"));
    expect(expectedRoutesRead).not.toHaveBeenCalled();
    expect(
      resolveProfileById.mock.calls
        .map(([input]) => input.openMeldProfileId)
        .sort()
    ).toEqual([...memberIds].sort());
    const queries = routeDb.querySpy.mock.calls.map(([sql]) =>
      String(sql).replaceAll('"', "").replaceAll("openmeld.", "")
    );
    expect(
      queries.filter(
        (sql) =>
          FROM_RUNTIME_REGISTRY_SQL_REGEX.test(sql) &&
          !FROM_RUNTIME_EXECUTION_TARGETS_SQL_REGEX.test(sql)
      )
    ).toHaveLength(2);
    expect(
      queries.filter((sql) =>
        FROM_RUNTIME_AGENT_CONTROLLER_REPORTS_SQL_REGEX.test(sql)
      )
    ).toHaveLength(1);

    // One target's temporary lookup failure must not block its siblings or
    // survive into the next request as a cached failure.
    resolveProfileById.mockRejectedValueOnce(
      new Error("temporary Auth read failure")
    );
    const interrupted = await readSnapshot();
    expect(
      interrupted.agents.filter(
        (agent) => agent.agentWakeAvailability?.status === "available_for_wake"
      )
    ).toHaveLength(4);
    const failed = interrupted.agents.find(
      (agent) => agent.agentWakeAvailability?.status !== "available_for_wake"
    );
    expect(
      failed?.ownerWakeDiagnostics?.agentExecutionReadiness?.facts.profile
    ).toMatchObject({
      active: false,
      reasonCodes: ["agent_profile.identity_lookup_failed"],
    });
    expect(failed?.agentWakeAvailability?.badgeLabel).toBe("Unavailable");
    const recovered = await readSnapshot();
    expect(
      recovered.agents.map((agent) => agent.agentWakeAvailability?.status)
    ).toEqual(Array.from({ length: 5 }, () => "available_for_wake"));
    expect(expectedRoutesRead).not.toHaveBeenCalled();
    expect(resolveProfileById).toHaveBeenCalledTimes(15);
    const resolveProfilesByIds = vi.fn(
      async ({ profileIds }: { profileIds: string[] }) => ({
        ok: true as const,
        profiles: Object.fromEntries(
          profileIds.map((profileId) => [
            profileId,
            {
              profileId,
              profileKind:
                profileId === "human-fanout"
                  ? ("human" as const)
                  : ("agent" as const),
              profileName: `Current ${profileId}`,
              profileHandle: profileId,
              ownerUserId: "owner-1",
              status: "active" as const,
              defaultProjectId: null,
            },
          ])
        ),
      })
    );
    if (!env.OPENMELD_AUTH_WORKER) {
      throw new Error("Missing Auth test binding");
    }
    Object.assign(env.OPENMELD_AUTH_WORKER, { resolveProfilesByIds });
    const refreshed = await refreshSpaceMemberNamesFromAuth({
      sql: snapshotInput.sql,
      env,
    });
    resolveProfileById.mockClear();
    const withNames = await readSnapshot({
      ...snapshotInput,
      profileFacts: refreshed.profileFacts,
    });
    expect(resolveProfilesByIds).toHaveBeenCalledTimes(1);
    expect(resolveProfilesByIds.mock.calls[0]?.[0].profileIds.sort()).toEqual(
      [...memberIds, "human-fanout"].sort()
    );
    expect(resolveProfileById).not.toHaveBeenCalled();
    expect(
      withNames.agents.map((agent) => agent.agentWakeAvailability?.status)
    ).toEqual(Array.from({ length: 5 }, () => "available_for_wake"));
    expect(withNames.agents.map((agent) => agent.profileName).sort()).toEqual(
      memberIds.map((id) => `Current ${id}`).sort()
    );
    resolveProfilesByIds.mockRejectedValueOnce(
      new Error("D1_ERROR: D1 DB is overloaded. Requests queued for too long.")
    );
    const unavailable = await refreshSpaceMemberNamesFromAuth({
      sql: snapshotInput.sql,
      env,
    });
    const afterBatchFailure = await listSpaceMembersSnapshotUseCase({
      ...snapshotInput,
      profileFacts: unavailable.profileFacts,
    });
    expect(resolveProfileById).not.toHaveBeenCalled();
    for (const agent of afterBatchFailure.agents) {
      expect(
        agent.ownerWakeDiagnostics?.agentExecutionReadiness?.facts.profile
      ).toMatchObject({
        active: false,
        reasonCodes: ["agent_profile.identity_lookup_failed"],
        source: "unavailable",
      });
      expect(
        readSpaceMemberRecord(snapshotInput.sql, agent.profileId)?.status
      ).toBe("active");
    }
    const retry = await refreshSpaceMemberNamesFromAuth({
      sql: snapshotInput.sql,
      env,
    });
    const afterRecovery = await listSpaceMembersSnapshotUseCase({
      ...snapshotInput,
      profileFacts: retry.profileFacts,
    });
    expect(resolveProfileById).not.toHaveBeenCalled();
    expect(
      afterRecovery.agents.map((agent) => agent.agentWakeAvailability?.status)
    ).toEqual(Array.from({ length: 5 }, () => "available_for_wake"));
    // A later request must read Auth again, not retain the previous snapshot.
    await listSpaceMembersSnapshotUseCase(snapshotInput);
    expect(resolveProfileById).toHaveBeenCalledTimes(5);
  });

  it.each([
    ["builtin:ops-bot", "owner-1"],
    [HOSTED_CENTER_AGENT_CONTROLLER_REF, "owner-1"],
    ["builtin:ops-bot", "stale-owner"],
  ])("preloads current Local bindings despite stored controller %s / owner %s", async (storedController, storedOwner) => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const lookupRoutesBatchSpy = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportRoutesBatch")
      .mockResolvedValue({
        routes: {
          agt_batch_available: {
            capabilities: {},
            connectionGeneration: 1,
            daemonSessionId: "session-batch",
            deviceId: "device-1",
            executionCompatibility: {
              expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
              reasonCode: "daemon.runtime_contract.compatible",
              status: "compatible",
            },
            lane: "dev-local",
            lastHeartbeatMs: 1,
            leaseEpoch: 1,
            online: true,
            serviceVersion: "999.0.0",
          },
          agt_batch_pending: {
            online: false,
            reasonCode: "daemon.profile.pending_first_report",
            ownerService: {
              capabilities: {},
              connectionGeneration: 1,
              daemonSessionId: "session-batch",
              deviceId: "device-1",
              executionCompatibility: {
                expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                reasonCode: "daemon.runtime_contract.compatible",
                status: "compatible",
              },
              lane: "dev-local",
              lastHeartbeatMs: 1,
              serviceVersion: "999.0.0",
            },
          },
        },
      });
    const lookupRouteSpy = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportRoute")
      .mockRejectedValue(new Error("single route lookup should not run"));
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportOwnerService"
    ).mockResolvedValue({
      online: true,
      sessions: [
        {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "session-batch",
          deviceId: "device-1",
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
          lane: "dev-local",
          lastHeartbeatMs: 1,
          serviceVersion: "999.0.0",
        },
      ],
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_batch_available",
      agentProfileIds: ["agt_batch_available", "agt_batch_pending"],
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          const profileId = input.openMeldProfileId ?? "agt_batch_available";
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: profileId,
              profileId,
              profileKind: "agent" as const,
              profileName:
                profileId === "agt_batch_pending"
                  ? "Batch Pending"
                  : "Batch Available",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-batch-routes",
      members: [
        {
          profileId: "agt_batch_available",
          profileName: "Batch Available",
          profileKind: "agent",
          ownerUserId: storedOwner,
          ownerName: "Owner One",
          agentControllerRef: storedController,
        },
        {
          profileId: "agt_batch_pending",
          profileName: "Batch Pending",
          profileKind: "agent",
          ownerUserId: storedOwner,
          ownerName: "Owner One",
          agentControllerRef: storedController,
        },
      ],
      actorProfileId: "hum-members-host-batch-routes",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:10:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-batch-routes",
      metaRecord: createReadinessMetaRecord(
        "space-members-batch-routes",
        "hum-members-host-batch-routes"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-batch-routes",
      liveSessions: [],
      nowIso: "2026-03-06T13:11:00.000Z",
    });

    expect(lookupRoutesBatchSpy).toHaveBeenCalledOnce();

    // The native read owner shares one request-level route lookup across members.
    expect(
      routeDb.querySpy.mock.calls.some(([, values]) => Array.isArray(values))
    ).toBe(true);
    expect(lookupRoutesBatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-1",
        profileIds: ["agt_batch_available", "agt_batch_pending"],
      })
    );
    expect(lookupRouteSpy).not.toHaveBeenCalled();
    expect(
      snapshot.agents.find((agent) => agent.profileId === "agt_batch_available")
    ).toMatchObject({
      agentWakeAvailability: {
        status: "checking_connection",
      },
    });
    expect(
      snapshot.agents.find((agent) => agent.profileId === "agt_batch_pending")
    ).toMatchObject({
      agentWakeAvailability: {
        reasonCode: "wake_route.registration_pending_first_report",
        status: "checking_connection",
      },
      ownerWakeDiagnostics: {
        state: "checking_wake_status",
        agentWakeRouteRegistration: {
          status: "pending",
        },
      },
    });
  });

  it("starts independent route and owner-service preloads together", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const routes =
      Promise.withResolvers<
        Awaited<
          ReturnType<
            typeof runtimeTransportClient.lookupRuntimeTransportRoutesBatch
          >
        >
      >();
    const ownerService =
      Promise.withResolvers<
        Awaited<
          ReturnType<
            typeof runtimeTransportClient.lookupRuntimeTransportOwnerService
          >
        >
      >();
    const lookupRoutesBatchSpy = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportRoutesBatch")
      .mockReturnValue(routes.promise);
    const lookupOwnerServiceSpy = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportOwnerService")
      .mockReturnValue(ownerService.promise);
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_parallel_preloads",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById() {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "parallel-preloads",
              profileId: "agt_parallel_preloads",
              profileKind: "agent" as const,
              profileName: "Parallel Preloads",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      actorDisplayName: "Owner One",
      actorProfileId: "hum-members-host-parallel-preloads",
      env: withProjectionBinding(env as unknown as CoreBindings),
      liveSessions: [],
      members: [
        {
          agentControllerRef: "builtin:ops-bot",
          ownerName: "Owner One",
          ownerUserId: "owner-1",
          profileId: "agt_parallel_preloads",
          profileKind: "agent",
          profileName: "Parallel Preloads",
        },
      ],
      nowIso: "2026-03-06T13:10:00.000Z",
      spaceId: "space-members-parallel-preloads",
      sql: sql as unknown as SqlStorage,
    });

    const snapshotPromise = listSpaceMembersSnapshotUseCase({
      env: withProjectionBinding(env as unknown as CoreBindings),
      liveSessions: [],
      metaRecord: createReadinessMetaRecord(
        "space-members-parallel-preloads",
        "hum-members-host-parallel-preloads"
      ),
      nowIso: "2026-03-06T13:11:00.000Z",
      spaceId: "space-members-parallel-preloads",
      sql: sql as unknown as SqlStorage,
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-parallel-preloads",
    });

    await vi.waitFor(() => {
      expect(lookupRoutesBatchSpy).toHaveBeenCalledOnce();
      expect(lookupOwnerServiceSpy).toHaveBeenCalledOnce();
    });

    routes.resolve({
      routes: {
        agt_parallel_preloads: {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "session-parallel-preloads",
          deviceId: "device-1",
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
          lane: "dev-local",
          lastHeartbeatMs: 1,
          leaseEpoch: 1,
          online: true,
          serviceVersion: "999.0.0",
        },
      },
    });
    ownerService.resolve({
      online: true,
      sessions: [
        {
          capabilities: {},
          connectionGeneration: 1,
          daemonSessionId: "session-parallel-preloads",
          deviceId: "device-1",
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
          lane: "dev-local",
          lastHeartbeatMs: 1,
          serviceVersion: "999.0.0",
        },
      ],
    });

    await expect(snapshotPromise).resolves.toMatchObject({
      agents: [{ profileId: "agt_parallel_preloads" }],
    });
  });

  it("does not show Checking availability when profile identity lookup is unavailable", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoute"
    ).mockResolvedValue({
      capabilities: {},
      connectionGeneration: 1,
      daemonSessionId: "session-identity-unavailable",
      deviceId: "device-identity-unavailable",
      lane: "dev-local",
      lastHeartbeatMs: 1,
      leaseEpoch: 1,
      online: true,
      executionCompatibility: {
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_identity_unavailable",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-identity-unavailable",
      members: [
        {
          profileId: "agt_identity_unavailable",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-identity-unavailable",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:14:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-identity-unavailable",
      metaRecord: createReadinessMetaRecord(
        "space-members-identity-unavailable",
        "hum-members-host-identity-unavailable"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-identity-unavailable",
      liveSessions: [],
      nowIso: "2026-03-06T13:15:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_identity_unavailable",
      agentWakeAvailability: {
        status: "unavailable_for_wake",
      },
      ownerWakeDiagnostics: {
        state: "action_required",
        agentExecutionReadiness: {
          displayState: "unknown",
          primaryAction: "check_status",
          facts: {
            profile: {
              source: "unavailable",
            },
            route: {
              online: false,
            },
          },
        },
      },
    });
  });

  it("shows a terminal removed state when the agent profile no longer exists", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: {
        agt_route_lease_reaped: {
          online: false,
          reasonCode: "daemon.profile.offline",
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
        },
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_profile_deleted",
    });
    let profileDeleted = false;
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          if (profileDeleted) {
            return Promise.resolve({
              ok: false as const,
              code: "profile.not_found",
              message: "profile not found",
            });
          }
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "dogfood-bot",
              profileId: input.openMeldProfileId ?? "agt_profile_deleted",
              profileKind: "agent" as const,
              profileName: "Dogfood Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-profile-deleted",
      members: [
        {
          profileId: "agt_profile_deleted",
          profileName: "Dogfood Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:codex",
        },
      ],
      actorProfileId: "hum-members-host-profile-deleted",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:20:00.000Z",
    });

    profileDeleted = true;
    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-profile-deleted",
      metaRecord: createReadinessMetaRecord(
        "space-members-profile-deleted",
        "hum-members-host-profile-deleted"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-profile-deleted",
      liveSessions: [],
      nowIso: "2026-03-06T13:21:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_profile_deleted",
      agentWakeAvailability: {
        badgeLabel: "Removed",
        label: "Agent profile deleted",
        reasonCode: "agent_profile.not_found",
        status: "unavailable_for_wake",
        summary: "This agent profile no longer exists.",
      },
    });
  });

  it("shows Reconnecting for a fresh-lease socket replacement without stable offline proof", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    // online:false with a fresh lease (lastHeartbeatMs present) is the daemon's
    // socket mid-replacement window. The fresh heartbeat lease -- ServiceRuntime
    // liveness evidence -- keeps the verdict on the transient checking path; a
    // missing socket alone does not flip a live service to Offline.
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: {
        agt_route_offline: {
          online: false,
          reasonCode: "daemon.profile.offline",
          lastHeartbeatMs: 1,
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
        },
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_route_offline",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "ops-bot",
              profileId: input.openMeldProfileId ?? "agt_route_offline",
              profileKind: "agent" as const,
              profileName: "Ops Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-offline",
      members: [
        {
          profileId: "agt_route_offline",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-route-offline",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:12:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-offline",
      metaRecord: createReadinessMetaRecord(
        "space-members-route-offline",
        "hum-members-host-route-offline"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-route-offline",
      liveSessions: [],
      nowIso: "2026-03-06T13:13:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_route_offline",
      agentWakeAvailability: {
        label: "Reconnecting Computer",
        reasonCode: "local_service.reconnecting",
        status: "checking_connection",
      },
      ownerWakeDiagnostics: {
        state: "checking_wake_status",
        wakeRouteEvidence: {
          reasonCode: "route.not_registered",
          status: "offline",
        },
      },
    });
    expect(snapshot.agents[0]).not.toHaveProperty("publicReplyPresence");
    expect(snapshot.agents[0]).not.toHaveProperty("daemonRouteObservation");
  });

  it("keeps a report-covered profile on Reconnecting while the lease is still fresh", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    // online:false while the daemon's last wake-route report STILL covers this
    // profile (its id is in includedProfileIds) but the lease is fresh
    // (lastHeartbeatMs present = socket mid-replacement, e.g. a Cloudflare 1006
    // blip). The report-covered branch must apply the same lease-freshness
    // split as every other offline-lookup branch, so the public verdict stays
    // on checking_connection instead of flipping to a terminal offline_for_wake
    // -- this report-covered + fresh-lease case was the production flap.
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: {
        agt_route_report_covered: {
          online: false,
          reasonCode: "daemon.profile.offline",
          lastHeartbeatMs: 1,
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            reasonCode: "daemon.runtime_contract.compatible",
            status: "compatible",
          },
          localWakeRouteReport: {
            daemonSessionId: "daemon-session-1",
            deviceId: "device-1",
            includedProfileIds: ["agt_route_report_covered"],
            lane: "dev-local",
            reportedAtMs: 1,
            skippedProfiles: [],
          },
        },
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_route_report_covered",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "ops-bot",
              profileId: input.openMeldProfileId ?? "agt_route_report_covered",
              profileKind: "agent" as const,
              profileName: "Ops Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-report-covered",
      members: [
        {
          profileId: "agt_route_report_covered",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-report-covered",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:12:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-report-covered",
      metaRecord: createReadinessMetaRecord(
        "space-members-report-covered",
        "hum-members-host-report-covered"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-report-covered",
      liveSessions: [],
      nowIso: "2026-03-06T13:13:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_route_report_covered",
      agentWakeAvailability: {
        label: "Reconnecting Computer",
        reasonCode: "local_service.reconnecting",
        status: "checking_connection",
      },
    });
  });

  it("shows Offline for Wake once the route lease has been reaped (stable offline proof)", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    // The owner service stopped: its lease aged past the freshness TTL and was
    // reaped, so the route lookup is online:false with no lastHeartbeatMs. A
    // reaped lease is stable liveness evidence that the route is not running,
    // so the badge must settle on Offline instead of stranding on a permanent
    // "Checking" (docs/architecture/facts.md: "Checking ... must not become a
    // stable sink that hides known service ... blockers").
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoute"
    ).mockResolvedValue({
      online: false,
      reasonCode: "daemon.profile.offline",
      executionCompatibility: {
        expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
        reasonCode: "daemon.runtime_contract.compatible",
        status: "compatible",
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_route_lease_reaped",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "ops-bot",
              profileId: input.openMeldProfileId ?? "agt_route_lease_reaped",
              profileKind: "agent" as const,
              profileName: "Ops Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-lease-reaped",
      members: [
        {
          profileId: "agt_route_lease_reaped",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-route-lease-reaped",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:12:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-lease-reaped",
      metaRecord: createReadinessMetaRecord(
        "space-members-route-lease-reaped",
        "hum-members-host-route-lease-reaped"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-route-lease-reaped",
      liveSessions: [],
      nowIso: "2026-03-06T13:13:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_route_lease_reaped",
      agentWakeAvailability: {
        label: "Offline for Wake",
        reasonCode: "agent_execution.route_offline",
        status: "offline_for_wake",
      },
      ownerWakeDiagnostics: {
        state: "action_required",
        wakeRouteEvidence: {
          reasonCode: "route.not_registered",
          status: "offline",
        },
      },
    });
  });

  it("shows Update OpenMeld Service instead of checking when the local service contract requires an update", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoutesBatch"
    ).mockResolvedValue({
      routes: {
        agt_route_update_required: {
          online: false,
          reasonCode: "daemon.profile.offline",
          executionCompatibility: {
            expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
            observedEpoch: "old-runtime-contract",
            reasonCode: "daemon.runtime_contract.mismatch",
            status: "update_required",
          },
        },
      },
    });
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_route_update_required",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "ops-bot",
              profileId: input.openMeldProfileId ?? "agt_route_update_required",
              profileKind: "agent" as const,
              profileName: "Ops Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-update-required",
      members: [
        {
          profileId: "agt_route_update_required",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-route-update-required",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:18:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-update-required",
      metaRecord: createReadinessMetaRecord(
        "space-members-route-update-required",
        "hum-members-host-route-update-required"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-route-update-required",
      liveSessions: [],
      nowIso: "2026-03-06T13:19:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_route_update_required",
      agentWakeAvailability: {
        status: "unavailable_for_wake",
      },
      ownerWakeDiagnostics: {
        state: "action_required",
        agentExecutionReadiness: {
          primaryAction: "update_service",
          facts: {
            service: {
              executionCompatible: false,
              reasonCodes: expect.arrayContaining([
                "service.update_required",
                "daemon.runtime_contract.mismatch",
              ]),
            },
          },
        },
      },
    });
  });

  it.each([
    "route batch",
    "owner service",
  ] as const)("keeps the member list available when one owner's %s lookup fails", async (failedLookup) => {
    resetCoreLocalComponentsReleaseCacheForTests();
    onTestFinished(resetCoreLocalComponentsReleaseCacheForTests);
    const sql = new MutableSqlStorage();
    const spaceId = "space-members-partial-transport";
    const nowIso = "2026-03-06T13:15:00.000Z";
    const affectedIds = ["agt_affected_1", "agt_affected_2"] as const;
    const healthyId = "agt_healthy";
    const affectedDb = createRouteTruthPostgresProjection({
      agentProfileId: affectedIds[0],
      agentProfileIds: affectedIds,
      ownerUserId: "owner-affected",
    });
    const healthyDb = createRouteTruthPostgresProjection({
      agentProfileId: healthyId,
      ownerUserId: "owner-healthy",
      deviceId: "device-healthy",
      openMeldServiceRuntimeId: "runtime-healthy",
      agentControllerReport: { status: "ready", reasonCodes: [] },
    });
    const db = createProjectionPostgresBinding(({ text, values }) => {
      if (text.includes('"openmeld_profiles"')) {
        return (values ?? []).flat().map((profileId) => ({
          profile_id: profileId,
          organization_id: "org-1",
          owner_user_id:
            profileId === healthyId ? "owner-healthy" : "owner-affected",
          profile_kind: "agent",
          profile_name: profileId,
          managed_role: null,
        }));
      }
      const healthy = (values ?? []).some((value) =>
        [
          healthyId,
          "owner-healthy",
          "device-healthy",
          "runtime-healthy",
        ].includes(String(value))
      );
      return (healthy ? healthyDb : affectedDb).querySpy(text, values ?? []);
    });
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    let unavailable = false;
    const routeLookup = vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoute"
    );
    const batchLookup = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportRoutesBatch")
      .mockImplementation(({ ownerUserId, profileIds }) => {
        if (
          unavailable &&
          ownerUserId === "owner-affected" &&
          failedLookup === "route batch"
        ) {
          return Promise.reject(new Error("Runtime Transport read timed out."));
        }
        return Promise.resolve({
          routes: Object.fromEntries(
            profileIds.map((profileId) => [
              profileId,
              ownerUserId === "owner-healthy"
                ? {
                    capabilities: {},
                    connectionGeneration: 1,
                    daemonSessionId: "session-healthy",
                    deviceId: "device-healthy",
                    lane: "dev-local" as const,
                    lastHeartbeatMs: 1,
                    leaseEpoch: 1,
                    online: true as const,
                    localWakeRouteReport: {
                      daemonSessionId: "session-healthy",
                      deviceId: "device-healthy",
                      expectedRoutesContractVersion: "v4" as const,
                      includedProfileIds: [healthyId],
                      lane: "dev-local" as const,
                      reportedAtMs: Date.parse(nowIso),
                      skippedProfiles: [],
                      workingFolderObservations: [
                        {
                          bindingId: "binding-route-truth",
                          configurationRevision: 1,
                          defaultProjectId: null,
                          localProjectBindingGeneration: null,
                          observedAtMs: Date.parse(nowIso),
                          profileId: healthyId,
                          reasonCode: null,
                          source: "profile_workspace" as const,
                          status: "ready" as const,
                        },
                      ],
                    },
                    executionCompatibility: {
                      expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                      observedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
                      reasonCode: "daemon.runtime_contract.compatible" as const,
                      status: "compatible" as const,
                    },
                    serviceVersion: "999.0.0",
                  }
                : {
                    online: false as const,
                    reasonCode: "daemon.profile.offline" as const,
                  },
            ])
          ),
        });
      });
    const ownerLookup = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportOwnerService")
      .mockImplementation(({ ownerUserId }) => {
        if (
          unavailable &&
          ownerUserId === "owner-affected" &&
          failedLookup === "owner service"
        ) {
          return Promise.reject(new Error("Runtime Transport read timed out."));
        }
        return Promise.resolve({
          online: false,
          reasonCode: "daemon.session.not_found",
        });
      });
    const env = withProjectionBinding({
      OPENMELD_CLI_RELEASES: createPublishedCliReleasesBucket(),
      OPENMELD_POSTGRESQL: db,
      OPENMELD_RUNTIME_TRANSPORT: TEST_RUNTIME_TRANSPORT,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById: async ({
          openMeldProfileId,
        }: {
          openMeldProfileId: string;
        }) => ({
          ok: true,
          profile: {
            ownerUserId:
              openMeldProfileId === healthyId
                ? "owner-healthy"
                : "owner-affected",
            profileHandle: openMeldProfileId,
            profileId: openMeldProfileId,
            profileKind: "agent",
            profileName: openMeldProfileId,
            status: "active",
            defaultProjectId: null,
          },
        }),
      } as unknown as CoreBindings["OPENMELD_AUTH_WORKER"],
    });
    upsertJoinedSpaceMember({
      sql: sql as unknown as SqlStorage,
      spaceId,
      profile: createHumanProfile("human-reader", "Reader"),
      nowIso,
    });
    for (const profileId of [...affectedIds, healthyId]) {
      upsertJoinedSpaceMember({
        sql: sql as unknown as SqlStorage,
        spaceId,
        profile: createAgentProfile({
          profileId,
          profileName: profileId,
          ownerUserId:
            profileId === healthyId ? "owner-healthy" : "owner-affected",
          agentControllerRef: "builtin:ops-bot",
        }),
        nowIso: "2026-03-06T13:14:00.000Z",
      });
    }
    const readMembers = () =>
      listSpaceMembersSnapshotUseCase({
        sql: sql as unknown as SqlStorage,
        env,
        spaceId,
        metaRecord: createReadinessMetaRecord(spaceId, "human-reader"),
        viewerOwnerUserId: "owner-affected",
        viewerProfileId: "human-reader",
        liveSessions: [],
        nowIso,
      });
    const before = await readMembers();
    expect(
      before.agents.find((agent) => agent.profileId === healthyId)
        ?.agentWakeAvailability?.status
    ).toBe("available_for_wake");
    expect(before.humans).toHaveLength(1);
    batchLookup.mockClear();
    ownerLookup.mockClear();
    unavailable = true;

    const snapshot = await readMembers();
    expect(snapshot.humans).toEqual(before.humans);
    expect(snapshot.agents.map((agent) => agent.profileId).sort()).toEqual(
      [...affectedIds, healthyId].sort()
    );
    expect(
      snapshot.agents.find((agent) => agent.profileId === healthyId)
    ).toEqual(before.agents.find((agent) => agent.profileId === healthyId));
    for (const profileId of affectedIds) {
      const agent = snapshot.agents.find(
        (member) => member.profileId === profileId
      );
      if (failedLookup === "route batch") {
        expect(agent?.agentWakeAvailability?.status).toBe(
          "unavailable_for_wake"
        );
        expect(agent?.ownerWakeDiagnostics?.wakeRouteEvidence).toMatchObject({
          status: "unavailable",
          reasonCode: "lookup_failed",
        });
      } else {
        // The independently read offline route remains authoritative even when
        // the supplemental owner-Service read is unavailable.
        expect(agent?.agentWakeAvailability).toMatchObject({
          status: "offline_for_wake",
        });
        expect(
          agent?.ownerWakeDiagnostics?.agentExecutionReadiness.reasonCodes
        ).toContain("local_service.unavailable");
      }
    }
    expect(batchLookup).toHaveBeenCalledTimes(2);
    expect(batchLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "owner-affected",
        readTimeoutMs: 5000,
      })
    );
    expect(ownerLookup).toHaveBeenCalledTimes(2);
    expect(routeLookup).not.toHaveBeenCalled();

    unavailable = false;
    expect(await readMembers()).toEqual(before);
  });

  it("preserves unavailable daemon route truth instead of collapsing lookup failures into offline", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoute"
    ).mockRejectedValue(new Error("runtime transport unavailable"));
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_route_unavailable",
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "ops-bot",
              profileId: input.openMeldProfileId ?? "agt_route_unavailable",
              profileKind: "agent" as const,
              profileName: "Ops Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-unavailable",
      members: [
        {
          profileId: "agt_route_unavailable",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-route-unavailable",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:14:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-route-unavailable",
      metaRecord: createReadinessMetaRecord(
        "space-members-route-unavailable",
        "hum-members-host-route-unavailable"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-route-unavailable",
      liveSessions: [],
      nowIso: "2026-03-06T13:15:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_route_unavailable",
      agentWakeAvailability: {
        status: "unavailable_for_wake",
      },
      ownerWakeDiagnostics: {
        state: "action_required",
        wakeRouteEvidence: {
          reasonCode: "lookup_failed",
          status: "unavailable",
        },
        agentExecutionReadiness: {
          facts: {
            route: {
              online: false,
              source: "daemon_route",
            },
          },
          reasonCodes: expect.arrayContaining([
            "agent_execution.route_unavailable",
            "lookup_failed",
          ]),
        },
      },
    });
    expect(snapshot.agents[0]).not.toHaveProperty("publicReplyPresence");
    expect(snapshot.agents[0]).not.toHaveProperty("agentExecutionReadiness");
    expect(snapshot.agents[0]).not.toHaveProperty("daemonRouteObservation");
  });

  it("does not fabricate daemon route truth when binding lookup fails", async () => {
    const sql = new MutableSqlStorage();
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const lookupRouteSpy = vi.spyOn(
      runtimeTransportClient,
      "lookupRuntimeTransportRoute"
    );
    const routeDb = createRouteTruthPostgresProjection({
      agentProfileId: "agt_binding_unavailable",
      failBindingRead: true,
    });
    const env = {
      OPENMELD_POSTGRESQL: routeDb.db,
      OPENMELD_AUTH_WORKER: {
        resolveProfileById(input: { openMeldProfileId?: string | null }) {
          return Promise.resolve({
            ok: true as const,
            profile: {
              ownerUserId: "owner-1",
              profileHandle: "ops-bot",
              profileId: input.openMeldProfileId ?? "agt_binding_unavailable",
              profileKind: "agent" as const,
              profileName: "Ops Bot",
              status: "active" as const,
            },
          });
        },
      },
    } satisfies Partial<CoreBindings>;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-binding-unavailable",
      members: [
        {
          profileId: "agt_binding_unavailable",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "hum-members-host-binding-unavailable",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:16:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding(env as unknown as CoreBindings),
      spaceId: "space-members-binding-unavailable",
      metaRecord: createReadinessMetaRecord(
        "space-members-binding-unavailable",
        "hum-members-host-binding-unavailable"
      ),
      viewerOwnerUserId: "owner-1",
      viewerProfileId: "hum-members-host-binding-unavailable",
      liveSessions: [],
      nowIso: "2026-03-06T13:17:00.000Z",
    });

    expect(snapshot.agents[0]).toMatchObject({
      profileId: "agt_binding_unavailable",
      agentWakeAvailability: {
        status: "unavailable_for_wake",
      },
      ownerWakeDiagnostics: {
        state: "action_required",
        wakeRouteEvidence: {
          reasonCode: "not_requested",
          status: "unavailable",
        },
        agentExecutionReadiness: {
          facts: {
            route: {
              online: false,
              source: "not_checked",
            },
          },
          reasonCodes: ["agent_profile_binding.read_unavailable"],
        },
      },
    });
    expect(snapshot.agents[0]).not.toHaveProperty("publicReplyPresence");
    expect(snapshot.agents[0]).not.toHaveProperty("agentExecutionReadiness");
    expect(snapshot.agents[0]).not.toHaveProperty("daemonRouteObservation");
    expect(lookupRouteSpy).not.toHaveBeenCalled();
  });

  it("surfaces mentionAlias on member snapshots and returns null when no alias exists", async () => {
    const sql = new MutableSqlStorage();

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-mention-alias-snapshot",
      members: [
        {
          profileId: "11111111-1111-4111-8111-111111111111",
          profileName: "Human Helper",
          profileKind: "human",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: null,
        },
        {
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          profileName: "Ops Bot",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:ops-bot",
        },
      ],
      actorProfileId: "22222222-2222-4222-8222-222222222222",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:00:00.000Z",
    });
    sql.seedCursor({
      profileId: "11111111-1111-4111-8111-111111111111",
      mentionAlias: "human_helper",
      createdAt: "2026-03-06T13:00:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-mention-alias-snapshot",
      liveSessions: [],
      nowIso: "2026-03-06T13:01:00.000Z",
    });

    expect(snapshot.humans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "11111111-1111-4111-8111-111111111111",
          mentionAlias: "human_helper",
        }),
      ])
    );
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          mentionAlias: null,
        }),
      ])
    );
  });

  it("does not synthesize duplicate mention aliases into member snapshots", async () => {
    const sql = new MutableSqlStorage();

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-duplicate-explicit-alias",
      members: [
        {
          profileId: "agt-members-helper",
          profileName: "Helper",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:helper",
        },
        {
          profileId: "agt-members-claude",
          profileName: "Claude Code",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:claude",
        },
      ],
      actorProfileId: "hum-members-host-duplicate-explicit-alias",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:05:00.000Z",
    });
    sql.seedCursor({
      profileId: "agt-members-helper",
      mentionAlias: "helper",
      createdAt: "2026-03-06T13:05:00.000Z",
    });
    sql.seedCursor({
      profileId: "agt-members-claude",
      mentionAlias: "helper",
      createdAt: "2026-03-06T13:06:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-duplicate-explicit-alias",
      liveSessions: [],
      nowIso: "2026-03-06T13:07:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt-members-helper",
          agentWakeAvailability: expect.objectContaining({
            status: "unavailable_for_wake",
          }),
        }),
        expect.objectContaining({
          profileId: "agt-members-claude",
          agentWakeAvailability: expect.objectContaining({
            status: "unavailable_for_wake",
          }),
        }),
      ])
    );
  });

  it.each([
    HOSTED_CENTER_AGENT_CONTROLLER_REF,
    "builtin:claude",
  ])("projects current Hosted availability independently of stored controller %s", async (storedController) => {
    const runtimeTransportClient = await import(
      "../src/dispatch/infrastructure/runtime-transport/runtime-transport-client"
    );
    const localRoute = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportRoutesBatch")
      .mockResolvedValue(null);
    const localService = vi
      .spyOn(runtimeTransportClient, "lookupRuntimeTransportOwnerService")
      .mockResolvedValue({
        online: false,
        reasonCode: "daemon.session.not_found",
      });
    const sql = new MutableSqlStorage();
    const spaceId = "space-members-hosted-center-agent-availability";
    const agentProfileId = "agt_members_hosted_center_agent";
    const routeTruth = createRouteTruthPostgresProjection({
      agentProfileId,
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      centerAgentDesignationOrganizationId: "org-1",
      ownerUserId: "owner-center-agent",
      profileOrganizationId: "org-1",
    });
    const env = {
      OPENMELD_RUNTIME_TRANSPORT: {},
      OPENMELD_AUTH_WORKER: {
        resolveProfileById: vi.fn(async () => ({
          ok: true,
          profile: {
            ownerUserId: "owner-center-agent",
            profileHandle: "center-agent",
            profileId: agentProfileId,
            profileKind: "agent",
            profileName: "Center Agent",
            status: "active",
          },
        })),
      },
      OPENMELD_POSTGRESQL: routeTruth.db,
      OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
      OPENMELD_REMOTE_AGENT_WORKER: {
        submitConversationTurn: vi.fn(),
      },
    } as unknown as CoreBindings;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env,
      spaceId,
      members: [
        {
          profileId: agentProfileId,
          profileName: "Center Agent",
          profileKind: "agent",
          ownerUserId: "owner-center-agent",
          ownerName: "OpenMeld",
          agentControllerRef: storedController,
        },
      ],
      actorProfileId: "hum-members-hosted-center-agent-host",
      actorDisplayName: "Space Host",
      liveSessions: [],
      nowIso: "2026-03-06T13:05:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env,
      spaceId,
      liveSessions: [],
      metaRecord: createMetaRecord({
        spaceId,
        createdAt: "2026-03-06T13:05:00.000Z",
        updatedAt: "2026-03-06T13:05:00.000Z",
        creator: createHumanCreator(
          "hum-members-hosted-center-agent-host",
          "Space Host"
        ),
      }),
      nowIso: "2026-03-06T13:06:00.000Z",
    });

    const hostedCenterAgent = snapshot.agents.find(
      (agent) => agent.profileId === agentProfileId
    );
    expect(hostedCenterAgent?.agentControllerRef).toBe(
      HOSTED_CENTER_AGENT_CONTROLLER_REF
    );
    expect(localRoute).not.toHaveBeenCalled();
    expect(localService).not.toHaveBeenCalled();
    expect(hostedCenterAgent?.agentWakeAvailability).toMatchObject({
      badgeLabel: "Available",
      category: "available",
      label: "Available for Wake",
      reasonCode: "remote_agent.available",
      status: "available_for_wake",
      summary: "This Agent can answer now.",
    });
    expect(
      JSON.stringify(hostedCenterAgent?.agentWakeAvailability)
    ).not.toContain("OpenMeld Service");
    expect(
      JSON.stringify(hostedCenterAgent?.agentWakeAvailability)
    ).not.toContain("Update");
  });

  it("projects a hosted Center Agent member as disconnected when designation is missing", async () => {
    const sql = new MutableSqlStorage();
    const spaceId = "space-members-hosted-center-agent-disconnected";
    const agentProfileId = "agt_members_hosted_center_agent_disconnected";
    const routeTruth = createRouteTruthPostgresProjection({
      agentProfileId,
      agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
      ownerUserId: "owner-center-agent",
      profileOrganizationId: "org-1",
    });
    const env = {
      OPENMELD_AUTH_WORKER: {
        resolveProfileById: vi.fn(async () => ({
          ok: true,
          profile: {
            ownerUserId: "owner-center-agent",
            profileHandle: "center-agent",
            profileId: agentProfileId,
            profileKind: "agent",
            profileName: "Center Agent",
            status: "active",
          },
        })),
      },
      OPENMELD_POSTGRESQL: routeTruth.db,
      OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
      OPENMELD_REMOTE_AGENT_WORKER: {
        submitConversationTurn: vi.fn(),
      },
    } as unknown as CoreBindings;

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env,
      spaceId,
      members: [
        {
          profileId: agentProfileId,
          profileName: "Center Agent",
          profileKind: "agent",
          ownerUserId: "owner-center-agent",
          ownerName: "OpenMeld",
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        },
      ],
      actorProfileId: "hum-members-hosted-center-agent-host",
      actorDisplayName: "Space Host",
      liveSessions: [],
      nowIso: "2026-03-06T13:05:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env,
      spaceId,
      liveSessions: [],
      metaRecord: createMetaRecord({
        spaceId,
        createdAt: "2026-03-06T13:05:00.000Z",
        updatedAt: "2026-03-06T13:05:00.000Z",
        creator: createHumanCreator(
          "hum-members-hosted-center-agent-host",
          "Space Host"
        ),
      }),
      nowIso: "2026-03-06T13:06:00.000Z",
    });

    const hostedCenterAgent = snapshot.agents.find(
      (agent) => agent.profileId === agentProfileId
    );
    expect(hostedCenterAgent?.agentWakeAvailability).toMatchObject({
      badgeLabel: "Disconnected",
      category: "unavailable",
      label: "Disconnected",
      reasonCode: "center_agent.designation_required",
      status: "unavailable_for_wake",
      summary: "Connect the Center Agent before waking it from this Space.",
    });
  });

  it("keeps stored mention aliases opaque in member snapshots", async () => {
    const sql = new MutableSqlStorage();

    await addSpaceMembersUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-legacy-mention-alias",
      members: [
        {
          profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Claude Code",
          profileKind: "agent",
          ownerUserId: "owner-1",
          ownerName: "Owner One",
          agentControllerRef: "builtin:claude",
        },
      ],
      actorProfileId: "hum-members-host-legacy-mention-alias",
      actorDisplayName: "Owner One",
      liveSessions: [],
      nowIso: "2026-03-06T13:08:00.000Z",
    });
    sql.seedCursor({
      profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
      mentionAlias: "claude-code-aaaaaaaa",
      createdAt: "2026-03-06T13:08:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-legacy-mention-alias",
      liveSessions: [],
      nowIso: "2026-03-06T13:09:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt_aaaaaaaa-0000-0000-0000-000000000000",
          agentWakeAvailability: expect.objectContaining({
            status: "unavailable_for_wake",
          }),
        }),
      ])
    );
  });

  it("keeps active member snapshots stable when an earlier duplicate member was removed", async () => {
    const sql = new MutableSqlStorage();
    const removedAt = "2026-03-06T13:10:00.000Z";

    upsertSpaceMemberRecord(sql as unknown as SqlStorage, {
      spaceId: "space-members-removed-handle",
      profileId: "agt-members-removed",
      profileKindSnapshot: "agent",
      profileNameSnapshot: "Claude Code",
      ownerUserIdSnapshot: "owner-1",
      ownerNameSnapshot: "Owner One",
      controllerRefSnapshot: "builtin:claude",
      status: "removed",
      memberSource: "joined_directly",
      addedAt: "2026-03-06T13:00:00.000Z",
      removedAt,
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayNameSnapshot: null,
      removedByProfileId: "hum-members-host-removed",
      removedByOwnerUserId: "owner-1",
      removalReason: "left",
      firstEnteredAt: "2026-03-06T13:00:00.000Z",
      lastEnteredAt: "2026-03-06T13:05:00.000Z",
      createdAt: "2026-03-06T13:00:00.000Z",
      updatedAt: removedAt,
    });
    upsertSpaceMemberRecord(sql as unknown as SqlStorage, {
      spaceId: "space-members-removed-handle",
      profileId: "agt-members-active",
      profileKindSnapshot: "agent",
      profileNameSnapshot: "Claude Code",
      ownerUserIdSnapshot: "owner-1",
      ownerNameSnapshot: "Owner One",
      controllerRefSnapshot: "builtin:claude-active",
      status: "active",
      memberSource: "joined_directly",
      addedAt: "2026-03-06T13:01:00.000Z",
      removedAt: null,
      addedByProfileId: null,
      addedByOwnerUserId: null,
      addedByDisplayNameSnapshot: null,
      removedByProfileId: null,
      removedByOwnerUserId: null,
      removalReason: null,
      firstEnteredAt: "2026-03-06T13:01:00.000Z",
      lastEnteredAt: "2026-03-06T13:02:00.000Z",
      createdAt: "2026-03-06T13:01:00.000Z",
      updatedAt: "2026-03-06T13:02:00.000Z",
    });

    const snapshot = await listSpaceMembersSnapshotUseCase({
      sql: sql as unknown as SqlStorage,
      env: withProjectionBinding({} as CoreBindings),
      spaceId: "space-members-removed-handle",
      liveSessions: [],
      nowIso: "2026-03-06T13:03:00.000Z",
    });

    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profileId: "agt-members-active",
          agentWakeAvailability: expect.objectContaining({
            status: "unavailable_for_wake",
          }),
        }),
      ])
    );
  });
});

function createMetaRecord(input: {
  spaceId: string;
  createdAt: string;
  updatedAt: string;
  creator: SpaceCreator;
}): SpaceMetaRecord {
  return {
    v: 1,
    spaceId: input.spaceId,
    organizationId: "org-1",
    visibility: "private",
    accessMode: "public",
    creator: input.creator,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

function createReadinessMetaRecord(
  spaceId: string,
  creatorProfileId: string
): SpaceMetaRecord {
  return createMetaRecord({
    spaceId,
    createdAt: "2026-03-06T13:00:00.000Z",
    updatedAt: "2026-03-06T13:00:00.000Z",
    creator: createHumanCreator(creatorProfileId, "Owner One", {
      ownerUserId: "owner-1",
      ownerName: "Owner One",
    }),
  });
}

function createHumanCreator(
  profileId: string,
  profileName: string,
  input?: {
    ownerUserId?: string;
    ownerName?: string;
  }
): SpaceCreator {
  return {
    profileId,
    profileName,
    kind: "human",
    profile: profileId,
    ...(input?.ownerUserId ? { ownerUserId: input.ownerUserId } : {}),
    ...(input?.ownerName ? { ownerName: input.ownerName } : {}),
  };
}

function createHumanProfile(
  profileId: string,
  profileName: string,
  input?: {
    ownerUserId?: string;
    ownerName?: string;
  }
): Profile {
  return {
    kind: "human",
    profileId,
    profileName,
    ...(input?.ownerUserId ? { owner: input.ownerUserId } : {}),
    ...(input?.ownerName ? { ownerName: input.ownerName } : {}),
  };
}

function createAgentProfile(input: {
  profileId: string;
  profileName: string;
  ownerUserId: string;
  agentControllerRef: string;
}): Profile {
  return {
    kind: "agent",
    profileId: input.profileId,
    profileName: input.profileName,
    owner: input.ownerUserId,
    agentControllerRef: input.agentControllerRef,
  };
}

function createTextSignal(input: {
  signalId: string;
  spaceId: string;
  ts: string;
  profile: Profile;
  text: string;
  meta?: Record<string, unknown>;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.signalId,
    spaceId: input.spaceId,
    ts: Date.parse(input.ts),
    profile: input.profile,
    type: "signal.text",
    data: {
      text: input.text,
      ...(input.meta ? { meta: input.meta } : {}),
    },
  };
}

function createStatusSignal(input: {
  signalId: string;
  spaceId: string;
  ts: string;
  profile: Profile;
  status: "working" | "needs_input" | "done" | "blocked" | "handoff";
  text: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.signalId,
    spaceId: input.spaceId,
    ts: Date.parse(input.ts),
    profile: input.profile,
    type: "signal.status",
    data: {
      actorProfileId: input.profile.profileId,
      status: input.status,
      dispatchId: `dispatch:${input.signalId}`,
      text: input.text,
      generatedBy: "openmeld",
    },
  };
}

function createSystemNoticeSignal(input: {
  signalId: string;
  spaceId: string;
  ts: string;
  actorProfileId: string;
  actorName?: string;
  text: string;
}): SignalEnvelope {
  return {
    v: 1,
    id: input.signalId,
    spaceId: input.spaceId,
    ts: Date.parse(input.ts),
    profile: {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld System",
    },
    type: "signal.system_notice",
    data: {
      noticeType: "stay_silent",
      actorProfileId: input.actorProfileId,
      ...(input.actorName ? { actorName: input.actorName } : {}),
      dispatchId: `dispatch:${input.signalId}`,
      text: input.text,
      generatedBy: "openmeld",
    },
  };
}

function createOneShotIterable<T>(values: T[]): Iterable<T> {
  let consumed = false;
  return {
    [Symbol.iterator](): Iterator<T> {
      if (consumed) {
        return [][Symbol.iterator]();
      }
      consumed = true;
      return values[Symbol.iterator]();
    },
  };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Number(value);
}

function toNullableText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
