import type {
  HelloAck,
  Profile,
  ServerErrorFrame,
  SignalEnvelope,
  SpaceAgentStreamDeltaFrame,
  SpaceAgentStreamTerminalFrame,
  SpaceLiveInvalidationFrame,
  SpaceLiveSignalFrame,
} from "@openmeld/protocol";
import {
  MAX_TEXT_LENGTH,
  parseEnvelope as parseProtocolEnvelope,
  parseIncoming as parseProtocolIncoming,
  parseServerErrorFrame as parseProtocolServerErrorFrame,
} from "@openmeld/protocol";
import type {
  MessageEnvelope,
  SpaceAgentStreamPartFrame,
} from "@openmeld/schemas/types";

type ParsedIncomingServerMessage = NonNullable<
  ReturnType<typeof parseProtocolIncoming>
>;
type CliIgnoredIncomingFrame =
  | ServerErrorFrame
  | SpaceAgentStreamDeltaFrame
  | SpaceAgentStreamPartFrame
  | SpaceAgentStreamTerminalFrame
  | SpaceLiveInvalidationFrame
  | SpaceLiveSignalFrame;

export function makeHello(profile: Profile) {
  return {
    type: "hello",
    profile,
    capabilities: { spaceMessageAddressing: true },
  };
}

export function makeTextSignal(
  text: string,
  options?: {
    messageEnvelope?: MessageEnvelope;
    meta?: Record<string, unknown>;
  }
) {
  return {
    type: "signal.text",
    data: {
      text,
      ...(options?.messageEnvelope
        ? { messageEnvelope: options.messageEnvelope }
        : {}),
      ...(options?.meta ? { meta: options.meta } : {}),
    },
  };
}

export function sanitizeText(
  value: string
): { ok: true; value: string } | { ok: false; reason: string } {
  const text = String(value ?? "").trim();
  if (text.length === 0) {
    return { ok: false, reason: "empty" };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return { ok: false, reason: `too long (>${MAX_TEXT_LENGTH} chars)` };
  }
  return { ok: true, value: text };
}

export function parseEnvelope(value: unknown): SignalEnvelope | null {
  return parseProtocolEnvelope(value);
}

export function parseIncoming(
  value: unknown
): SignalEnvelope | HelloAck | null {
  const parsed = parseProtocolIncoming(value);
  if (!parsed || isCliIgnoredIncomingFrame(parsed)) {
    return null;
  }
  return parsed;
}

export function parseServerErrorFrame(value: unknown): ServerErrorFrame | null {
  return parseProtocolServerErrorFrame(value);
}

function isCliIgnoredIncomingFrame(
  parsed: ParsedIncomingServerMessage
): parsed is CliIgnoredIncomingFrame {
  return (
    "error" in parsed ||
    parsed.type === "space.agent_stream_delta" ||
    parsed.type === "space.agent_stream_part" ||
    parsed.type === "space.agent_stream_terminal" ||
    parsed.type === "space.signal" ||
    parsed.type === "space.members.changed" ||
    parsed.type === "space.meta.changed" ||
    parsed.type === "agent.readiness.invalidated"
  );
}
