import { SPACE_STREAM_KEEPALIVE_PING } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import { createInitialState, handleClientFrame } from "../src/session";

describe("gateway session", () => {
  const enforcedProfile = {
    kind: "human" as const,
    profileId: "resolved-id",
    profileName: "Resolved",
  };

  it("requires hello first", () => {
    const state = createInitialState();
    const action = handleClientFrame(
      state,
      JSON.stringify({ type: "signal.text", data: { text: "hi" } }),
      { enforcedHelloProfile: enforcedProfile }
    );
    expect(action.kind).toBe("close");
  });

  it("forwards hello then signal.text", () => {
    const state = createInitialState();

    const hello = handleClientFrame(
      state,
      JSON.stringify({
        type: "hello",
        profile: { kind: "agent", profileId: "mira", profileName: "Mira" },
      }),
      { enforcedHelloProfile: enforcedProfile }
    );
    expect(hello.kind).toBe("forward");

    const msg = handleClientFrame(
      state,
      JSON.stringify({ type: "signal.text", data: { text: "hi" } }),
      { enforcedHelloProfile: enforcedProfile }
    );
    expect(msg.kind).toBe("forward");
  });

  it("forwards hello with enforced profile when provided", () => {
    const state = createInitialState();
    const hello = handleClientFrame(
      state,
      JSON.stringify({
        type: "hello",
        profile: {
          kind: "agent",
          profileId: "forged-id",
          profileName: "Forged",
        },
      }),
      {
        enforcedHelloProfile: {
          kind: "human",
          profileId: "resolved-id",
          profileName: "Resolved",
        },
      }
    );

    expect(hello.kind).toBe("forward");
    if (hello.kind !== "forward") {
      return;
    }

    const payload = JSON.parse(hello.payload) as {
      type: string;
      profile?: { profileId?: string; profileName?: string };
    };
    expect(payload.type).toBe("hello");
    expect(payload.profile?.profileId).toBe("resolved-id");
    expect(payload.profile?.profileName).toBe("Resolved");
  });

  it("preserves hello capabilities while enforcing the resolved profile", () => {
    const state = createInitialState();
    const hello = handleClientFrame(
      state,
      JSON.stringify({
        type: "hello",
        profile: {
          kind: "agent",
          profileId: "forged-id",
          profileName: "Forged",
        },
        capabilities: {
          liveSignalHistory: true,
        },
      }),
      {
        enforcedHelloProfile: {
          kind: "human",
          profileId: "resolved-id",
          profileName: "Resolved",
        },
      }
    );

    expect(hello.kind).toBe("forward");
    if (hello.kind !== "forward") {
      return;
    }

    expect(JSON.parse(hello.payload)).toEqual({
      type: "hello",
      profile: {
        kind: "human",
        profileId: "resolved-id",
        profileName: "Resolved",
      },
      capabilities: {
        liveSignalHistory: true,
      },
    });
  });

  it("rejects unknown message types after hello", () => {
    const state = createInitialState();

    handleClientFrame(
      state,
      JSON.stringify({
        type: "hello",
        profile: { kind: "agent", profileId: "mira", profileName: "Mira" },
      }),
      { enforcedHelloProfile: enforcedProfile }
    );

    const action = handleClientFrame(state, JSON.stringify({ type: "ping" }), {
      enforcedHelloProfile: enforcedProfile,
    });
    expect(action.kind).toBe("reject");
  });

  it("closes a pre-hello keepalive ping but forwards it unmodified after hello", () => {
    const state = createInitialState();

    const beforeHello = handleClientFrame(state, SPACE_STREAM_KEEPALIVE_PING, {
      enforcedHelloProfile: enforcedProfile,
    });
    expect(beforeHello.kind).toBe("close");

    handleClientFrame(
      state,
      JSON.stringify({
        type: "hello",
        profile: { kind: "agent", profileId: "mira", profileName: "Mira" },
      }),
      { enforcedHelloProfile: enforcedProfile }
    );

    const afterHello = handleClientFrame(state, SPACE_STREAM_KEEPALIVE_PING, {
      enforcedHelloProfile: enforcedProfile,
    });
    expect(afterHello.kind).toBe("forward");
    if (afterHello.kind === "forward") {
      expect(afterHello.payload).toBe(SPACE_STREAM_KEEPALIVE_PING);
    }
  });
});
