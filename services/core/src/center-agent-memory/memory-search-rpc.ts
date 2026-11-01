import {
  CENTER_AGENT_RETAINED_MEMORY_MAX_ITEMS,
  CENTER_AGENT_RETAINED_MEMORY_MAX_SOURCES,
  CENTER_AGENT_RETAINED_MEMORY_MAX_TEXT_CHARS,
  centerAgentMemorySourceReferenceSchema,
  centerAgentSearchMemoryResponseSchema,
  centerAgentSearchMemoryRpcInputSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentMemorySourceReference,
  CenterAgentSearchMemoryResponse,
  CenterAgentSearchMemoryRpcInput,
} from "@openmeld/schemas/types";
import { createCenterAgentEvidenceSourceAccess } from "../center-agent/application/evidence-source-access";
import { prepareCenterAgentRepresentedMemberRequest } from "../center-agent/application/represented-member-request";
import type { CoreBindings } from "../lib/bindings";
import { createCoreRpcHttpError } from "../rpc/errors";
import type { CenterAgentMemoryDetailedSearchItem } from "./contract";
import { readCoreCenterAgentRetainedMemory } from "./core-memory-service";

const MAX_MEMORY_SEARCH_RESULT_BYTES = 32 * 1024;
const encoder = new TextEncoder();

export async function rpcCenterAgentSearchMemory(
  env: CoreBindings,
  input: CenterAgentSearchMemoryRpcInput
) {
  const parsed = centerAgentSearchMemoryRpcInputSchema.safeParse(input);
  if (!parsed.success) {
    throw createCoreRpcHttpError({
      code: "invalid_payload",
      reason:
        "A nonempty bounded memory query and verified member are required.",
      status: 400,
    });
  }
  const request = parsed.data;
  const prepared = await prepareCenterAgentRepresentedMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  const initialAccess = await createCenterAgentEvidenceSourceAccess({
    env,
    prepared,
  });
  await requireMemoryAudience(initialAccess);
  const limit = request.limit ?? CENTER_AGENT_RETAINED_MEMORY_MAX_ITEMS;
  const organizationId =
    prepared.authorization.activeOrganization.organizationId;
  const recalled = await readCoreCenterAgentRetainedMemory(env, {
    organizationId,
    speakerMember: request.speakerMember,
    query: request.query,
    limit,
    ...(initialAccess.audience === "organization_shared" &&
    initialAccess.envelope?.space.kind === "space"
      ? { spaceId: initialAccess.envelope.space.id }
      : {}),
  });
  // Provider latency must not turn a now-revoked represented member into a
  // successful read. The Agent identity is never replaced by the member.
  const current = await prepareCenterAgentRepresentedMemberRequest(
    env,
    request.context,
    request.speakerMember
  );
  const access = await createCenterAgentEvidenceSourceAccess({
    env,
    prepared: current,
  });
  await requireMemoryAudience(access);
  const items: CenterAgentSearchMemoryResponse["items"] = [];
  for (const candidate of recalled.items) {
    const sources = await authorizeSources(candidate, access);
    if (!sources) {
      continue;
    }
    const normalized = candidate.text.trim();
    if (!normalized) {
      continue;
    }
    const shortened = boundedMemoryText(normalized);
    items.push({
      text: shortened,
      textShortened: shortened !== normalized,
      scope: candidate.subject,
      interpretation: "remembered_summary_not_quote",
      currentness: "not_verified",
      sources,
    });
    if (items.length >= limit) {
      break;
    }
  }
  let status: CenterAgentSearchMemoryResponse["status"] =
    recalled.status === "complete" ? "no_match" : recalled.status;
  if (items.length > 0 && recalled.status === "complete") {
    status = "matched";
  }
  const response: CenterAgentSearchMemoryResponse = {
    organizationId,
    observedAtMs: Date.now(),
    status,
    items,
    coverage: {
      kind: "bounded_retained_memory_search",
      access: "all_sources_and_reply_audience_checked",
      completeHistory: false,
      cursorSupported: false,
      supportedSources: ["ca_dm", "space_conversation"],
      unsupportedSources: [
        "slack_conversation",
        "message_channel_conversation",
        "legacy_explicit_tool_without_conversation_origin",
      ],
      currentDecisionVerification:
        "read_original_sources_and_current_organization_document_revisions",
    },
  };
  while (
    encoder.encode(JSON.stringify(response)).byteLength >
      MAX_MEMORY_SEARCH_RESULT_BYTES &&
    response.items.length > 0
  ) {
    response.items.pop();
  }
  if (response.status === "matched" && response.items.length === 0) {
    response.status = "partial";
  }
  return centerAgentSearchMemoryResponseSchema.parse(response);
}

function boundedMemoryText(text: string): string {
  let bounded = "";
  for (const point of text) {
    if (
      bounded.length + point.length >
      CENTER_AGENT_RETAINED_MEMORY_MAX_TEXT_CHARS
    ) {
      break;
    }
    bounded += point;
  }
  return bounded;
}

async function requireMemoryAudience(
  access: Awaited<ReturnType<typeof createCenterAgentEvidenceSourceAccess>>
) {
  const envelope = access.envelope;
  // Explicit recall neither expands capture nor inherits Routine/channel authority.
  if (
    !envelope ||
    envelope.sender.kind !== "member" ||
    (envelope.trigger.source !== "web_dm" &&
      envelope.trigger.source !== "space_wake") ||
    (access.audience !== "requester_private" &&
      access.audience !== "organization_shared")
  ) {
    throw unsupportedSurface();
  }
  // The source-access owner checks the current DM audience. Public metadata
  // intentionally does not contain the private DM record.
  if (!(await access.readPermittedSpace(envelope.space.id))) {
    throw unsupportedSurface();
  }
}

async function authorizeSources(
  candidate: CenterAgentMemoryDetailedSearchItem,
  access: Awaited<ReturnType<typeof createCenterAgentEvidenceSourceAccess>>
): Promise<CenterAgentMemorySourceReference[] | null> {
  if (
    candidate.sources.length === 0 ||
    candidate.sources.length > CENTER_AGENT_RETAINED_MEMORY_MAX_SOURCES
  ) {
    return null;
  }
  const references: CenterAgentMemorySourceReference[] = [];
  for (const source of candidate.sources) {
    if (
      candidate.subject === "space" &&
      (source.sourceConversationId !== access.envelope?.space.id ||
        !source.sourceVersion)
    ) {
      return null;
    }
    if (source.source !== "ca_dm" && source.source !== "space_conversation") {
      return null;
    }
    const reference = centerAgentMemorySourceReferenceSchema.safeParse({
      source: source.source,
      spaceId: source.sourceConversationId,
      signalId: source.sourceMessageId,
      occurredAtMs: source.occurredAtMs,
      captureMethod: source.captureMethod,
      availability: "readable",
      ...(source.sourceVersion ? { version: source.sourceVersion } : {}),
      ...(source.sourceAuthorKind
        ? { authorKind: source.sourceAuthorKind }
        : {}),
    });
    if (
      !(
        reference.success &&
        (await access.canReadSignal(
          reference.data.spaceId,
          reference.data.signalId,
          reference.data.version,
          reference.data.authorKind
        ))
      )
    ) {
      return null;
    }
    references.push(reference.data);
  }
  return references;
}

function unsupportedSurface() {
  return createCoreRpcHttpError({
    code: "center_agent.memory_search_surface_unsupported",
    reason:
      "Explicit retained-memory search requires a verified interactive member in a currently readable OpenMeld conversation. Routine, external-channel, and unverifiable reply audiences are not supported.",
    status: 403,
  });
}
