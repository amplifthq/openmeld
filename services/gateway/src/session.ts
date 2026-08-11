import type { Profile } from "@openmeld/protocol";
import {
  parseHello,
  parseJsonObject,
  parseSignalText,
  SPACE_STREAM_KEEPALIVE_PING,
} from "@openmeld/protocol";

export type SessionState = {
  hasHello: boolean;
};

export type SessionAction =
  | { kind: "forward"; payload: string }
  | { kind: "reject"; error: string }
  | { kind: "close"; code: number; reason: string };

type HandleClientFrameOptions = {
  enforcedHelloProfile: Profile;
};

export function createInitialState(): SessionState {
  return { hasHello: false };
}

export function handleClientFrame(
  state: SessionState,
  raw: string,
  options: HandleClientFrameOptions
): SessionAction {
  if (raw === SPACE_STREAM_KEEPALIVE_PING) {
    // Forward the transport keepalive PING upstream unmodified so the Space DO
    // can auto-answer it (setWebSocketAutoResponse). Require hello first: a ping
    // must not be able to hold the proxy -> DO chain open without completing the
    // handshake, so a pre-hello ping is treated like any other non-hello first
    // frame (reuses the existing hello_required close mapping in ws-stream).
    if (!state.hasHello) {
      return { kind: "close", code: 1008, reason: "hello_required" };
    }
    return { kind: "forward", payload: raw };
  }

  const parsed = parseJsonObject(raw);
  if (!parsed.ok) {
    return { kind: "reject", error: parsed.error };
  }

  if (!state.hasHello) {
    const hello = parseHello(parsed.value);
    if (!hello.ok) {
      return { kind: "close", code: 1008, reason: "hello_required" };
    }

    state.hasHello = true;
    const profile = options.enforcedHelloProfile;
    return {
      kind: "forward",
      payload: JSON.stringify({
        type: "hello",
        profile,
        ...(hello.value.capabilities
          ? { capabilities: hello.value.capabilities }
          : {}),
      }),
    };
  }

  const signal = parseSignalText(parsed.value);
  if (!signal.ok) {
    return { kind: "reject", error: signal.error };
  }

  return { kind: "forward", payload: JSON.stringify(signal.value) };
}
