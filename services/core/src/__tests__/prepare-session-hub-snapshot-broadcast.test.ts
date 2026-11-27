import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { PrepareSessionHub } from "../prepare-session/transport/do/prepare-session-hub";

const SESSION_ID = "prepare-session-snapshot";

class FakeSocket {
  readonly closes: Array<{ code: number; reason: string }> = [];
  readonly sent: string[] = [];
  readyState: number = WebSocket.OPEN;
  private readonly attachment: unknown;
  private readonly failSend: boolean;
  constructor(attachment: unknown, failSend = false) {
    this.attachment = attachment;
    this.failSend = failSend;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  send(value: string) {
    if (this.failSend) {
      throw new Error("socket closed while the snapshot was sent");
    }
    this.sent.push(value);
  }
  close(code: number, reason: string) {
    this.closes.push({ code, reason });
  }
}

type HubHarness = {
  broadcastSnapshot(
    snapshot: PrepareSessionSnapshot,
    exceptSocket?: WebSocket
  ): void;
};

// The recipient loop is under test, not the frame contract, so the harness
// replaces schema serialization and terminal-binding bookkeeping.
function createHub(sockets: FakeSocket[]) {
  const hub = Object.create(PrepareSessionHub.prototype) as HubHarness;
  Object.assign(hub, {
    ctx: { getWebSockets: () => sockets },
    serializeFrame: (frame: unknown) => JSON.stringify(frame),
    syncTerminalBinding: () => undefined,
  });
  return hub;
}

function socketFor(
  role: "terminal" | "web",
  input: { failSend?: boolean; prepareSessionId?: string } = {}
) {
  return new FakeSocket(
    {
      connectionEpoch: role === "terminal" ? 1 : null,
      prepareSessionId: input.prepareSessionId ?? SESSION_ID,
      role,
    },
    input.failSend
  );
}

const snapshot = { prepareSessionId: SESSION_ID } as PrepareSessionSnapshot;

describe("PrepareSessionHub snapshot broadcast", () => {
  it("still delivers to later recipients when an earlier socket fails", () => {
    const brokenTerminal = socketFor("terminal", { failSend: true });
    const viewer = socketFor("web");
    const hub = createHub([brokenTerminal, viewer]);

    hub.broadcastSnapshot(snapshot);

    expect(viewer.sent).toHaveLength(1);
    expect(JSON.parse(viewer.sent[0] ?? "{}")).toMatchObject({
      type: "snapshot_changed",
      payload: { snapshot: { prepareSessionId: SESSION_ID } },
    });
    expect(brokenTerminal.closes).toEqual([
      { code: 1011, reason: "snapshot_delivery_failed" },
    ]);
    expect(viewer.closes).toEqual([]);
  });

  it("skips sockets that are closing, excluded, or bound to another session", () => {
    const closing = socketFor("web");
    closing.readyState = WebSocket.CLOSING;
    const excluded = socketFor("terminal");
    const otherSession = socketFor("web", { prepareSessionId: "other" });
    const viewer = socketFor("web");
    const hub = createHub([closing, excluded, otherSession, viewer]);

    hub.broadcastSnapshot(snapshot, excluded as unknown as WebSocket);

    expect(closing.sent).toEqual([]);
    expect(excluded.sent).toEqual([]);
    expect(otherSession.sent).toEqual([]);
    expect(viewer.sent).toHaveLength(1);
  });
});
