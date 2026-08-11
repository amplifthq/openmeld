import type { SpaceMeta } from "@openmeld/protocol";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import { toSpaceCursorUrl } from "../protocol/urls";
import {
  normalizeMentionAliasInput,
  normalizeRoleInput,
} from "./command-input-normalizers";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { parseSpaceMetaPayload } from "./space-meta-response";

const PLAN_DONE_PREFIX_RE = /^(PLAN|DONE)\b/i;
const ACK_SIGNAL_REFERENCE_RE = /\bACK\s*[:：]\s*[-_a-z0-9]{6,}/i;
const TEXT_NEWLINE_SPLIT_RE = /\r?\n/u;

export function resolveWorkflowAckHint(text: string): string | null {
  const leadingMarker = resolveLeadingWorkflowMarker(text);
  if (!leadingMarker) {
    return null;
  }
  if (ACK_SIGNAL_REFERENCE_RE.test(text)) {
    return null;
  }
  return "Directive guard: PLAN/DONE updates should include ACK:<owner-signal-id> after syncing latest history. If unclear, send BLOCKED: and wait for owner decision.";
}

function resolveLeadingWorkflowMarker(text: string): "PLAN" | "DONE" | null {
  for (const line of text.split(TEXT_NEWLINE_SPLIT_RE)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const match = PLAN_DONE_PREFIX_RE.exec(trimmed);
    if (!match) {
      continue;
    }
    const marker = match[1];
    if (!marker) {
      continue;
    }
    if (marker.toUpperCase() === "PLAN") {
      return "PLAN";
    }
    return "DONE";
  }
  return null;
}

export function parseCreateSpaceResponse(raw: string): {
  spaceId: string;
  meta?: SpaceMeta;
} {
  let parsed: { spaceId?: unknown; meta?: unknown };
  try {
    parsed = JSON.parse(raw) as { spaceId?: unknown; meta?: unknown };
  } catch {
    throw new Error("Unexpected response: invalid JSON");
  }
  if (
    typeof parsed.spaceId !== "string" ||
    parsed.spaceId.trim().length === 0
  ) {
    throw new Error("Unexpected response: missing spaceId");
  }

  if (parsed.meta !== undefined) {
    return {
      spaceId: parsed.spaceId,
      meta: parseSpaceMetaPayload({
        data: parsed.meta,
        endpoint: "createSpace",
        operation: "createSpaceMeta",
      }),
    };
  }

  return {
    spaceId: parsed.spaceId,
  };
}

export async function fetchSpaceCursor(input: {
  requestContext: import("@openmeld/schemas/types").OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
}): Promise<{
  role?: string;
  mentionAlias?: string;
}> {
  const endpoint = toSpaceCursorUrl(
    input.baseUrl,
    input.space,
    input.requestContext.actorContext.openMeldProfileId
  );
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
    spacePassword: input.password,
  });
  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.fetch_cursor",
    init: {
      method: "GET",
      headers,
    },
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${raw}`);
  }

  return parseSpaceCursorResponse({
    raw,
    endpoint,
    operation: "fetchSpaceCursor",
  });
}

export function parseSpaceCursorResponse(input: {
  raw: string;
  endpoint: string;
  operation: "fetchSpaceCursor" | "updateSpaceCursor";
}): {
  role?: string;
  mentionAlias?: string;
} {
  try {
    const parsed = JSON.parse(input.raw) as {
      role?: unknown;
      mentionAlias?: unknown;
    };
    const role = normalizeRoleInput(
      typeof parsed.role === "string" ? parsed.role : undefined
    );
    const mentionAlias = normalizeMentionAliasInput(
      typeof parsed.mentionAlias === "string" ? parsed.mentionAlias : undefined
    );
    return {
      ...(role ? { role } : {}),
      ...(mentionAlias ? { mentionAlias } : {}),
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `${input.operation} received invalid JSON from ${input.endpoint}: ${reason}; raw=${input.raw}`
    );
  }
}
