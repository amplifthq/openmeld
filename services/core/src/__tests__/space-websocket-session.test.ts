import type {
  Profile,
  SignalEnvelope,
  SpaceLiveSignalFrame,
} from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  acceptSpaceWebSocketHello,
  buildSpaceWebSocketSessionAttachment,
  createPendingSpaceWebSocketSession,
  removeFailedSpaceWebSocketSession,
  restoreSpaceWebSocketSessionFromAttachment,
  shouldSendSpaceLiveSignalFrameToSession,
} from "../space/transport/do/space-websocket-session";

const ENFORCED_PROFILE: Profile = {
  kind: "human",
  profileId: "hum-viewer-1",
  profileName: "Felix",
};

const HELLO_PROFILE: Profile = {
  kind: "human",
  profileId: "hum-other-1",
  profileName: "Other",
};

const MAIN_TIMELINE_SIGNAL: SignalEnvelope = {
  v: 1,
  id: "sig-main-1",
  spaceId: "space-1",
  ts: 1_762_874_400_000,
  type: "signal.text",
  profile: ENFORCED_PROFILE,
  data: {
    text: "Hello",
  },
};

describe("space websocket session", () => {
  it("starts pending sessions without a completed hello handshake", () => {
    const session = createPendingSpaceWebSocketSession({
      enforcedProfile: ENFORCED_PROFILE,
      viewerOwnerUserId: "owner-1",
      blocked: [],
    });

    expect(session.helloAccepted).toBe(false);
    expect(session.supportsLiveSignalHistory).toBe(false);
    expect(session.supportsSpaceMessageAddressing).toBe(false);
    expect(session.profile).toBeUndefined();
    expect(session.enforcedProfile).toEqual(ENFORCED_PROFILE);
  });

  it("marks the session ready after hello and keeps the enforced profile", () => {
    const session = createPendingSpaceWebSocketSession({
      callerPrincipalId: "authenticated-user-1",
      enforcedProfile: ENFORCED_PROFILE,
      blocked: [],
    });

    const acceptedProfile = acceptSpaceWebSocketHello({
      session,
      hello: {
        type: "hello",
        profile: HELLO_PROFILE,
      },
    });

    expect(acceptedProfile).toEqual(ENFORCED_PROFILE);
    expect(session.helloAccepted).toBe(true);
    expect(session.profile).toEqual(ENFORCED_PROFILE);
    expect(buildSpaceWebSocketSessionAttachment(session)).toMatchObject({
      helloAccepted: true,
      profile: ENFORCED_PROFILE,
      enforcedProfile: ENFORCED_PROFILE,
    });
    expect(
      restoreSpaceWebSocketSessionFromAttachment(
        buildSpaceWebSocketSessionAttachment(session)
      ).callerPrincipalId
    ).toBe("authenticated-user-1");
    expect(buildSpaceWebSocketSessionAttachment(session)).not.toHaveProperty(
      "viewerCreatorProfileIdsByProfileId"
    );
  });

  it("stores and restores live history support from hello capabilities", () => {
    const session = createPendingSpaceWebSocketSession({
      enforcedProfile: ENFORCED_PROFILE,
      blocked: [],
    });

    acceptSpaceWebSocketHello({
      session,
      hello: {
        type: "hello",
        profile: HELLO_PROFILE,
        capabilities: {
          liveSignalHistory: true,
          agentWorkOutcomes: true,
          spaceMessageAddressing: true,
          spaceImageGeometry: true,
        },
      },
    });

    expect(session.supportsLiveSignalHistory).toBe(true);
    expect(session.supportsAgentWorkOutcomes).toBe(true);
    expect(session.supportsSpaceMessageAddressing).toBe(true);
    expect(session.supportsSpaceImageGeometry).toBe(true);
    const attachment = buildSpaceWebSocketSessionAttachment(session);
    expect(attachment).toMatchObject({
      supportsLiveSignalHistory: true,
      supportsAgentWorkOutcomes: true,
      supportsSpaceMessageAddressing: true,
      supportsSpaceImageGeometry: true,
    });

    const restored = restoreSpaceWebSocketSessionFromAttachment(attachment);
    expect(restored.supportsLiveSignalHistory).toBe(true);
    expect(restored.supportsAgentWorkOutcomes).toBe(true);
    expect(restored.supportsSpaceMessageAddressing).toBe(true);
    expect(restored.supportsSpaceImageGeometry).toBe(true);
  });

  it("restores accepted sessions from legacy attachments without helloAccepted", () => {
    const restored = restoreSpaceWebSocketSessionFromAttachment({
      profile: ENFORCED_PROFILE,
      enforcedProfile: ENFORCED_PROFILE,
      viewerProfileId: "hum-viewer-1",
    });

    expect(restored.helloAccepted).toBe(true);
    expect(restored.profile).toEqual(ENFORCED_PROFILE);
    expect(restored.enforcedProfile).toEqual(ENFORCED_PROFILE);
    expect(restored.supportsSpaceImageGeometry).toBe(false);
    expect(restored.supportsAgentWorkOutcomes).toBe(false);
  });

  it("restores accepted sessions from enforced profile when the serialized profile is missing", () => {
    const restored = restoreSpaceWebSocketSessionFromAttachment({
      enforcedProfile: ENFORCED_PROFILE,
      helloAccepted: true,
    });

    expect(restored.helloAccepted).toBe(true);
    expect(restored.profile).toEqual(ENFORCED_PROFILE);
  });

  it("stores and restores canonical protected Space passwords", () => {
    const session = createPendingSpaceWebSocketSession({
      enforcedProfile: ENFORCED_PROFILE,
      spacePassword: "  pw-space  ",
      blocked: [],
    });

    expect(session.spacePassword).toBe("pw-space");
    expect(buildSpaceWebSocketSessionAttachment(session).spacePassword).toBe(
      "pw-space"
    );
    expect(
      restoreSpaceWebSocketSessionFromAttachment({
        enforcedProfile: ENFORCED_PROFILE,
        helloAccepted: true,
        spacePassword: "  restored-pw  ",
      }).spacePassword
    ).toBe("restored-pw");
  });

  it("sends live history frames only to capable sessions while preserving thread frames", () => {
    const session = createPendingSpaceWebSocketSession({
      enforcedProfile: ENFORCED_PROFILE,
      blocked: [],
    });
    const frame: SpaceLiveSignalFrame = {
      type: "space.signal",
      signal: MAIN_TIMELINE_SIGNAL,
      history: {
        persisted: true,
      },
    };

    expect(
      shouldSendSpaceLiveSignalFrameToSession({
        frame,
        session,
      })
    ).toBe(false);

    session.supportsLiveSignalHistory = true;
    expect(
      shouldSendSpaceLiveSignalFrameToSession({
        frame,
        session,
      })
    ).toBe(true);

    session.supportsLiveSignalHistory = false;
    expect(
      shouldSendSpaceLiveSignalFrameToSession({
        frame: {
          ...frame,
          threadContext: {
            threadId: "thr_11111111-1111-4111-8111-111111111111",
            rootSignalId: "sig-root-1",
          },
          threadPlacement: {
            threadId: "thr_11111111-1111-4111-8111-111111111111",
            signalId: MAIN_TIMELINE_SIGNAL.id,
            placement: "thread",
            createdAt: "2026-06-19T00:00:00.000Z",
          },
        },
        session,
      })
    ).toBe(true);
  });

  it("closes and removes sessions after a websocket send failure", () => {
    const session = createPendingSpaceWebSocketSession({
      enforcedProfile: ENFORCED_PROFILE,
      blocked: [],
    });
    const closeCalls: Array<{ code?: number; reason?: string }> = [];
    const webSocket = {
      close: (code?: number, reason?: string) => {
        closeCalls.push({ code, reason });
      },
    } as WebSocket;
    const sessions = new Map<WebSocket, typeof session>([[webSocket, session]]);

    removeFailedSpaceWebSocketSession({
      closeCode: 1011,
      closeReason: "broadcast_send_failed",
      session,
      sessions,
      webSocket,
    });

    expect(session.quit).toBe(true);
    expect(sessions.has(webSocket)).toBe(false);
    expect(closeCalls).toEqual([
      { code: 1011, reason: "broadcast_send_failed" },
    ]);
  });

  it("still removes failed sessions when the websocket is already closed", () => {
    const session = createPendingSpaceWebSocketSession({
      enforcedProfile: ENFORCED_PROFILE,
      blocked: [],
    });
    const webSocket = {
      close: () => {
        throw new Error("already closed");
      },
    } as unknown as WebSocket;
    const sessions = new Map<WebSocket, typeof session>([[webSocket, session]]);

    removeFailedSpaceWebSocketSession({
      closeCode: 1011,
      closeReason: "broadcast_send_failed",
      session,
      sessions,
      webSocket,
    });

    expect(session.quit).toBe(true);
    expect(sessions.has(webSocket)).toBe(false);
  });
});
