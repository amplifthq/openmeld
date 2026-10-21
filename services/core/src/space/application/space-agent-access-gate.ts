import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import { decideAgentAccess } from "../../agent-access/application/agent-access-policy";
import {
  type AgentAccessRoot,
  type AgentAccessTarget,
  asQueryable,
  readActiveAgentAccessGrants,
  readAgentAccessRoot,
  readAgentAccessTargets,
} from "../../agent-access/infrastructure/postgresql/agent-access-repo";
import { isMemberAgentsEnabled } from "../../member-agent/member-agents-feature";
import { readRequestChainRootProfileId } from "../../request-chain/request-chain";
import type { SpaceMemberRecord } from "../infrastructure/sql/space-member-repo";
import type { SignalPublishContext } from "./types";

/** A Wake target held for its owner's consent. */
export type HeldAgentAccessTarget = {
  kind: "direct_message" | "external_message";
  root: AgentAccessRoot;
  target: AgentAccessTarget;
};

/**
 * The human root of a signal's Wakes, as the Space can know it: the human
 * author, or the root of the chain an Agent continues. Without a trusted
 * chain, the authoring Agent's owner stands in (one hop).
 */
function resolveAgentAccessRootProfile(input: {
  activeMembers: readonly SpaceMemberRecord[];
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
}):
  | { kind: "profile"; profileId: string }
  | { kind: "owner"; userId: string }
  | null {
  if (input.signal.profile.kind === "human") {
    return { kind: "profile", profileId: input.signal.profile.profileId };
  }
  const basis = input.signalContext?.requestChainBasis;
  if (input.signal.profile.kind === "agent" && basis?.kind === "parent") {
    return {
      kind: "profile",
      profileId: readRequestChainRootProfileId(basis.requestChain),
    };
  }
  const author = input.activeMembers.find(
    (member) => member.profileId === input.signal.profile.profileId
  );
  return author?.ownerUserIdSnapshot
    ? { kind: "owner", userId: author.ownerUserIdSnapshot }
    : null;
}

/**
 * The Wake targets of this signal that must wait for their owner
 * (design-plans/member-agent-program.md §4.6). Empty while MemberAgents
 * are off. A Space whose Agents all belong to the root never reads Core.
 */
export async function evaluateSpaceAgentAccessGate(input: {
  activeMembers: readonly SpaceMemberRecord[];
  db: PostgresDatabase | null;
  directMessage: boolean;
  organizationId: string;
  /** Core's caller relationship for the author, when the Space read it. */
  relationship?: string;
  signal: SignalEnvelope;
  signalContext?: SignalPublishContext;
  spaceId: string;
}): Promise<Map<string, HeldAgentAccessTarget>> {
  const held = new Map<string, HeldAgentAccessTarget>();
  if (
    !isMemberAgentsEnabled() ||
    input.signal.type !== "signal.text" ||
    // An anonymous caller never reaches an owner: the request chain
    // rejects its Wake at the entrance.
    input.relationship === "anonymous"
  ) {
    return held;
  }
  const rootProfile = resolveAgentAccessRootProfile(input);
  if (!rootProfile) {
    return held;
  }
  const rootUserIdSnapshot =
    rootProfile.kind === "owner"
      ? rootProfile.userId
      : (input.activeMembers.find(
          (member) => member.profileId === rootProfile.profileId
        )?.ownerUserIdSnapshot ?? null);
  const candidates = input.activeMembers.filter(
    (member) =>
      member.status === "active" &&
      member.profileKindSnapshot === "agent" &&
      member.profileId !== input.signal.profile.profileId &&
      (rootUserIdSnapshot === null ||
        member.ownerUserIdSnapshot !== rootUserIdSnapshot)
  );
  if (candidates.length === 0) {
    return held;
  }
  if (!input.db) {
    throw new Error("Agent access storage is unavailable.");
  }
  const db = asQueryable(input.db);
  const targets = await readAgentAccessTargets({
    db,
    organizationId: input.organizationId,
    profileIds: candidates.map((member) => member.profileId),
  });
  if (targets.size === 0) {
    return held;
  }
  const root =
    rootProfile.kind === "profile"
      ? await readAgentAccessRoot({
          db,
          organizationId: input.organizationId,
          profileId: rootProfile.profileId,
        })
      : await readOwnerRoot(db, input.organizationId, rootProfile.userId);
  if (!root) {
    // No human behind the Wake; the request chain rejects it at admission.
    return held;
  }
  for (const target of targets.values()) {
    if (target.ownerUserId === root.userId) {
      continue;
    }
    const grants =
      input.directMessage && root.kind === "member"
        ? await readActiveAgentAccessGrants({
            db,
            granteeUserId: root.userId,
            profileId: target.profileId,
            spaceId: input.spaceId,
          })
        : { always: false, session: false };
    const decision = decideAgentAccess({
      directMessage: input.directMessage,
      grants,
      ownerUserId: target.ownerUserId,
      root,
    });
    if (decision.outcome === "hold") {
      held.set(target.profileId, { kind: decision.kind, root, target });
    }
  }
  return held;
}

async function readOwnerRoot(
  db: ReturnType<typeof asQueryable>,
  organizationId: string,
  userId: string
): Promise<AgentAccessRoot | null> {
  const result = await db.query<{
    profile_id: string;
    name: string | null;
    member: boolean;
  }>({
    text: `SELECT profile.profile_id, account.name,
        EXISTS (
          SELECT 1 FROM "openmeld"."members" AS membership
          WHERE membership.organization_id = $1 AND membership.user_id = $2
        ) AS member
      FROM "openmeld"."users" AS account
      INNER JOIN "openmeld"."openmeld_profiles" AS profile
        ON profile.owner_user_id = account.id AND profile.profile_kind = 'human'
        AND profile.status = 'active'
      WHERE account.id = $2
      ORDER BY profile.created_at
      LIMIT 1`,
    values: [organizationId, userId],
  });
  const row = result.rows[0];
  return row
    ? {
        profileId: row.profile_id,
        userId,
        name: row.name?.trim() || "Someone",
        kind: row.member ? "member" : "external",
      }
    : null;
}
