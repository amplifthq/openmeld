import type { Profile } from "@openmeld/protocol";
import { getSpaceStatusResponseSchema } from "@openmeld/schemas";
import type {
  GetSpaceStatusResponse,
  SpaceContract,
  SpaceMembersSnapshot,
  SpaceStatusMembersSummary,
} from "@openmeld/schemas/types";
import type { AuthProfileFacts } from "../../auth/application/profile-facts-reader";
import { readCenterAgentDesignationRecord } from "../../center-agent/center-agent-repository";
import { type CoreBindings, identityDb } from "../../lib/bindings";
import type { SpaceMetaRecord } from "../infrastructure/sql/space-meta-repo";
import type { SpaceBootstrapTimingCollector } from "./space-bootstrap-timing";
import { readSpaceContractOrDefaultUseCase } from "./space-contract-service";
import { readLatestVisibleFormalUpdate } from "./space-latest-visible-update-service";
import {
  buildSpaceStatusMembersSummaryFromSnapshot,
  readSpaceStatusMembersSummaryUseCase,
} from "./space-members-service";

type LiveSessionLike = {
  profile?: Profile;
  enforcedProfile?: Profile;
};

type SpaceStatusSummaryTiming = {
  collector: SpaceBootstrapTimingCollector;
  descriptionPrefix: string;
  metricPrefix: string;
};

export async function readSpaceStatusSummaryUseCase(input: {
  profileFacts?: AuthProfileFacts | null;
  sql: SqlStorage;
  env: CoreBindings;
  spaceId: string;
  metaRecord: SpaceMetaRecord;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  liveSessions: Iterable<LiveSessionLike>;
  nowIso?: string;
  timing?: SpaceStatusSummaryTiming;
  contractStore: {
    readSpaceContract: () => SpaceContract | null;
  };
}): Promise<GetSpaceStatusResponse> {
  const generatedAt = input.nowIso ?? new Date().toISOString();
  const centerAgentProfileIdPromise = readCenterAgentProfileId({
    env: input.env,
    organizationId: input.metaRecord.organizationId,
  });
  const contract = measureSpaceStatusSummaryTiming(
    input.timing,
    "contract",
    "read space contract",
    () =>
      readSpaceContractOrDefaultUseCase({
        store: input.contractStore,
        nowIso: generatedAt,
      })
  );
  const members = await measureSpaceStatusSummaryTimingAsync(
    input.timing,
    "members_summary",
    "read members summary",
    () =>
      readSpaceStatusMembersSummaryUseCase({
        profileFacts: input.profileFacts,
        sql: input.sql,
        env: input.env,
        spaceId: input.spaceId,
        liveSessions: input.liveSessions,
        metaRecord: input.metaRecord,
        nowIso: generatedAt,
        viewerOwnerUserId: input.viewerOwnerUserId,
        viewerProfileId: input.viewerProfileId,
        ...(input.timing
          ? {
              timing: {
                collector: input.timing.collector,
                descriptionPrefix: "Status members summary",
                metricPrefix: `${input.timing.metricPrefix}_members`,
              },
            }
          : {}),
      })
  );
  const latestVisibleUpdate = await measureSpaceStatusSummaryTimingAsync(
    input.timing,
    "latest_visible_update",
    "read latest visible update",
    () =>
      readLatestVisibleFormalUpdate({
        sql: input.sql,
        env: input.env,
        viewerOwnerUserId: input.viewerOwnerUserId,
        viewerProfileId: input.viewerProfileId,
      })
  );

  return buildSpaceStatusSummaryResponse({
    accessMode: input.metaRecord.accessMode,
    organizationVisibility: input.metaRecord.visibility,
    centerAgentProfileId: await centerAgentProfileIdPromise,
    contract,
    generatedAt,
    latestVisibleUpdate,
    members,
    name: input.metaRecord.name,
    directMessageConvertedAt: input.metaRecord.directMessage?.convertedAt,
    spacePurpose: input.metaRecord.purpose,
    spaceId: input.spaceId,
  });
}

export async function readSpaceStatusSummaryFromMembersSnapshotUseCase(input: {
  sql: SqlStorage;
  env: CoreBindings;
  spaceId: string;
  metaRecord: SpaceMetaRecord;
  membersSnapshot: SpaceMembersSnapshot;
  viewerOwnerUserId?: string;
  viewerProfileId?: string;
  nowIso?: string;
  timing?: SpaceStatusSummaryTiming;
  contractStore: {
    readSpaceContract: () => SpaceContract | null;
  };
  // Optional pre-started read: bootstrap kicks this off in parallel with the
  // members branch (it never depended on members), so awaiting it here no
  // longer serializes it behind the members snapshot.
  latestVisibleUpdate?: Promise<
    GetSpaceStatusResponse["latestVisibleUpdate"] | undefined
  >;
}): Promise<GetSpaceStatusResponse> {
  const generatedAt = input.nowIso ?? input.membersSnapshot.generatedAt;
  const centerAgentProfileIdPromise = readCenterAgentProfileId({
    env: input.env,
    organizationId: input.metaRecord.organizationId,
  });
  const contract = measureSpaceStatusSummaryTiming(
    input.timing,
    "contract",
    "read space contract",
    () =>
      readSpaceContractOrDefaultUseCase({
        store: input.contractStore,
        nowIso: generatedAt,
      })
  );
  const members = measureSpaceStatusSummaryTiming(
    input.timing,
    "members_summary",
    "derive members summary from bootstrap members snapshot",
    () => buildSpaceStatusMembersSummaryFromSnapshot(input.membersSnapshot)
  );
  const latestVisibleUpdate = input.latestVisibleUpdate
    ? await input.latestVisibleUpdate
    : await measureSpaceStatusSummaryTimingAsync(
        input.timing,
        "latest_visible_update",
        "read latest visible update",
        () =>
          readLatestVisibleFormalUpdate({
            sql: input.sql,
            env: input.env,
            viewerOwnerUserId: input.viewerOwnerUserId,
            viewerProfileId: input.viewerProfileId,
          })
      );

  return buildSpaceStatusSummaryResponse({
    accessMode: input.metaRecord.accessMode,
    organizationVisibility: input.metaRecord.visibility,
    centerAgentProfileId: await centerAgentProfileIdPromise,
    contract,
    generatedAt,
    latestVisibleUpdate,
    members,
    name: input.metaRecord.name,
    directMessageConvertedAt: input.metaRecord.directMessage?.convertedAt,
    spacePurpose: input.metaRecord.purpose,
    spaceId: input.spaceId,
  });
}

function buildSpaceStatusSummaryResponse(input: {
  accessMode: SpaceMetaRecord["accessMode"];
  organizationVisibility: SpaceMetaRecord["visibility"];
  centerAgentProfileId: GetSpaceStatusResponse["centerAgentProfileId"];
  contract: SpaceContract;
  generatedAt: string;
  latestVisibleUpdate: GetSpaceStatusResponse["latestVisibleUpdate"] | null;
  members: SpaceStatusMembersSummary;
  name: SpaceMetaRecord["name"];
  directMessageConvertedAt: string | undefined;
  spacePurpose: SpaceMetaRecord["purpose"];
  spaceId: string;
}): GetSpaceStatusResponse {
  const parsed = getSpaceStatusResponseSchema.safeParse({
    spaceId: input.spaceId,
    generatedAt: input.generatedAt,
    ...(input.centerAgentProfileId
      ? { centerAgentProfileId: input.centerAgentProfileId }
      : {}),
    ...(input.name ? { name: input.name } : {}),
    ...(input.spacePurpose ? { spacePurpose: input.spacePurpose } : {}),
    ...(input.directMessageConvertedAt
      ? { directMessageConvertedAt: input.directMessageConvertedAt }
      : {}),
    organizationVisibility: input.organizationVisibility,
    accessMode: input.accessMode,
    passwordProtected: input.accessMode === "protected",
    dispatchPolicy: input.contract.dispatchPolicy,
    publicationMode: input.contract.publicationMode,
    allowedActions: input.contract.allowedActions,
    resultArchivePolicy: input.contract.resultArchivePolicy,
    entryBrief: input.contract.entryBrief,
    dispatchBrief: input.contract.dispatchBrief,
    members: input.members,
    ...(input.latestVisibleUpdate
      ? { latestVisibleUpdate: input.latestVisibleUpdate }
      : {}),
  });
  if (!parsed.success) {
    throw new Error("space status summary is invalid");
  }
  return parsed.data;
}

async function readCenterAgentProfileId(input: {
  env: CoreBindings;
  organizationId: string;
}): Promise<GetSpaceStatusResponse["centerAgentProfileId"]> {
  const db = identityDb(input.env);
  if (!db) {
    return undefined;
  }
  const designation = await readCenterAgentDesignationRecord({
    db,
    organizationId: input.organizationId,
  });
  return designation?.agentProfileId;
}

function measureSpaceStatusSummaryTiming<T>(
  timing: SpaceStatusSummaryTiming | undefined,
  metricSuffix: string,
  description: string,
  read: () => T
): T {
  if (!timing) {
    return read();
  }
  return timing.collector.measureSync(
    {
      name: `${timing.metricPrefix}_${metricSuffix}`,
      description: `${timing.descriptionPrefix}: ${description}`,
    },
    read
  );
}

async function measureSpaceStatusSummaryTimingAsync<T>(
  timing: SpaceStatusSummaryTiming | undefined,
  metricSuffix: string,
  description: string,
  read: () => Promise<T>
): Promise<T> {
  if (!timing) {
    return await read();
  }
  return await timing.collector.measure(
    {
      name: `${timing.metricPrefix}_${metricSuffix}`,
      description: `${timing.descriptionPrefix}: ${description}`,
    },
    read
  );
}
