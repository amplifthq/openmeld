import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { INBOX_CONTEXT_LABEL_MAX_CHARS } from "@openmeld/schemas";
import {
  type AgentModelInboxScope,
  readAgentModelInboxRecords,
} from "../infrastructure/postgresql/agent-model-inbox-repo";
import {
  ensureInboxItem,
  resolveInboxItemsBySource,
} from "./inbox-item-service";
import { truncateInboxText } from "./inbox-text";
/** Projection input from the model/binding owner, not another execution policy. */
export type AgentModelInboxSnapshot = AgentModelInboxScope & {
  identity: string;
  verdict: "blocked" | "clear" | "unknown";
  occurredAtMs: number;
  message: string;
  profileName: string;
};
export async function reconcileAgentModelInboxProjection(input: {
  db: PostgresDatabase;
  nowMs: number;
  readCurrent: () => Promise<AgentModelInboxSnapshot | null>;
}): Promise<void> {
  const source = await input.readCurrent();
  if (!source) {
    return;
  }
  const organizationId = source.organizationId;
  const prefix = `agent-model:${await digest(source.identity)}:`;
  const scope = {
    db: input.db,
    organizationId: source.organizationId,
    ownerUserId: source.ownerUserId,
    profileId: source.profileId,
  };
  const open = await readAgentModelInboxRecords(scope);
  // Normal reports usually have no model notice to change. With no write to
  // perform, there is no stale projection to fence with another owner read.
  if (source.verdict !== "blocked" && open.length === 0) {
    return;
  }
  const latest =
    source.verdict === "blocked"
      ? (await readAgentModelInboxRecords({ ...scope, prefix }))[0]
      : undefined;
  // Re-read the owner after asynchronous projection reads; old reports cannot
  // restore an issue for a model the user has already changed.
  if (!sameSource(source, await input.readCurrent())) {
    return;
  }
  let retainedKey: string | null = null;
  if (source.verdict === "blocked") {
    retainedKey =
      latest?.resolvedAtMs === null
        ? latest.sourceKey
        : `${prefix}${await digest(latest?.sourceKey ?? "initial")}`;
    await ensureInboxItem({
      db: input.db,
      nowMs: input.nowMs,
      candidate: {
        attention: "action_required",
        importance: "normal",
        kind: "system_issue",
        occurredAtMs:
          latest?.resolvedAtMs ?? latest?.occurredAtMs ?? source.occurredAtMs,
        organizationId: source.organizationId,
        recipientUserId: source.ownerUserId,
        title: "Change this agent's model",
        preview: source.message,
        contextLabel: truncateInboxText(
          source.profileName,
          INBOX_CONTEXT_LABEL_MAX_CHARS
        ),
        sourceKind: "system_attention_event",
        sourceKey: retainedKey,
        sourceTarget: { kind: "agent_profile", profileId: source.profileId },
        sourceFacts: {
          version: 1,
          recipientReasons: ["agent_owner"],
          agentProfileIds: [source.profileId],
          personalAgentProfileIds: [source.profileId],
          requestCategory: "action",
        },
      },
    });
    if (!sameSource(source, await input.readCurrent())) {
      await resolve(retainedKey);
      return;
    }
  }
  for (const record of open) {
    if (record.sourceKey === retainedKey) {
      continue;
    }
    // Unknown account evidence must not clear the same still-configured model.
    if (source.verdict === "unknown" && record.sourceKey.startsWith(prefix)) {
      continue;
    }
    if (!sameSource(source, await input.readCurrent())) {
      return;
    }
    await resolve(record.sourceKey);
  }
  function resolve(sourceKey: string) {
    return resolveInboxItemsBySource({
      db: input.db,
      organizationId,
      resolvedAtMs: input.nowMs,
      sourceKind: "system_attention_event",
      sourceKey,
    });
  }
}
function sameSource(
  a: AgentModelInboxSnapshot,
  b: AgentModelInboxSnapshot | null
): boolean {
  return Boolean(
    b &&
      a.identity === b.identity &&
      a.verdict === b.verdict &&
      a.organizationId === b.organizationId &&
      a.ownerUserId === b.ownerUserId &&
      a.profileId === b.profileId
  );
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
