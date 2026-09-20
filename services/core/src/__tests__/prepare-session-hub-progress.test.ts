import type { PrepareSessionSnapshot } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { PrepareSessionHub } from "../prepare-session/transport/do/prepare-session-hub";

const SESSION_ID = "prepare-session-progress";

class FakeSocket {
  readonly readyState = WebSocket.OPEN;
  readonly sent: string[] = [];
  private attachment: unknown;
  private readonly failSend: boolean;
  constructor(attachment: unknown, failSend = false) {
    this.attachment = attachment;
    this.failSend = failSend;
  }
  deserializeAttachment() {
    return this.attachment;
  }
  serializeAttachment(value: unknown) {
    this.attachment = value;
  }
  send(value: string) {
    if (this.failSend) {
      throw new Error("viewer closed while progress was sent");
    }
    this.sent.push(value);
  }
  close() {
    return undefined;
  }
}

type HubHarness = {
  activeTerminalBindings: Map<
    string,
    { connectionEpoch: number; lastProgressSequence: number | null }
  >;
  latestConnectionProgress: Map<string, unknown>;
  syncTerminalBinding(snapshot: PrepareSessionSnapshot): void;
  webSocketMessage(webSocket: WebSocket, message: string): Promise<void>;
};

function createHub(sockets: FakeSocket[]) {
  const hub = Object.create(PrepareSessionHub.prototype) as HubHarness;
  Object.assign(hub, {
    ctx: { getWebSockets: () => sockets },
    activeTerminalBindings: new Map([
      [SESSION_ID, { connectionEpoch: 2, lastProgressSequence: null }],
    ]),
    latestConnectionProgress: new Map(),
  });
  return hub;
}

function terminal(epoch: number) {
  return new FakeSocket({
    connectionEpoch: epoch,
    prepareSessionId: SESSION_ID,
    role: "terminal",
  });
}

function viewer(failSend = false) {
  return new FakeSocket(
    { connectionEpoch: null, prepareSessionId: SESSION_ID, role: "web" },
    failSend
  );
}

function progressFrame(epoch: number, sequence: number) {
  return JSON.stringify({
    type: "terminal.connection_progress.write",
    payload: {
      schemaVersion: 1,
      operationId: "operation-2",
      attemptId: "attempt-2",
      prepareSessionId: SESSION_ID,
      connectionEpoch: epoch,
      sequence,
      startedAt: "2026-09-17T00:00:00.000Z",
      observedAt: "2026-09-17T00:00:01.000Z",
      phase: "connecting_service",
      state: "active",
      code: "prepare.session.progress.refresh_service",
    },
  });
}

describe("PrepareSessionHub connection progress", () => {
  it("isolates a failed observer while the active Terminal and healthy observer continue", async () => {
    const publisher = terminal(2);
    const failedViewer = viewer(true);
    const healthyViewer = viewer();
    const hub = createHub([publisher, failedViewer, healthyViewer]);

    await hub.webSocketMessage(
      publisher as unknown as WebSocket,
      progressFrame(2, 1)
    );

    expect(publisher.sent).toEqual([]);
    expect(healthyViewer.sent).toHaveLength(1);
    expect(JSON.parse(healthyViewer.sent[0] ?? "{}")).toMatchObject({
      type: "connection_progress",
      payload: { connectionEpoch: 2, sequence: 1 },
    });
    expect(hub.latestConnectionProgress.get(SESSION_ID)).toMatchObject({
      connectionEpoch: 2,
      sequence: 1,
    });
  });

  it("rejects retired and duplicate Terminal progress and clears progress when the session ends", async () => {
    const oldPublisher = terminal(1);
    const currentPublisher = terminal(2);
    const healthyViewer = viewer();
    const hub = createHub([oldPublisher, currentPublisher, healthyViewer]);

    await hub.webSocketMessage(
      currentPublisher as unknown as WebSocket,
      progressFrame(2, 2)
    );
    await hub.webSocketMessage(
      currentPublisher as unknown as WebSocket,
      progressFrame(2, 2)
    );
    await hub.webSocketMessage(
      oldPublisher as unknown as WebSocket,
      progressFrame(1, 99)
    );

    expect(healthyViewer.sent).toHaveLength(1);
    expect(oldPublisher.sent.map((value) => JSON.parse(value))).toContainEqual(
      expect.objectContaining({
        type: "server.error",
        payload: expect.objectContaining({
          code: "prepare.session.terminal_stale",
        }),
      })
    );
    expect(hub.latestConnectionProgress.get(SESSION_ID)).toMatchObject({
      connectionEpoch: 2,
      sequence: 2,
    });

    hub.syncTerminalBinding({
      prepareSessionId: SESSION_ID,
      lifecycleStatus: "completed",
      terminalConnection: { connectionEpoch: 2, status: "connected" },
    } as PrepareSessionSnapshot);

    expect(hub.latestConnectionProgress.has(SESSION_ID)).toBe(false);
    expect(hub.activeTerminalBindings.has(SESSION_ID)).toBe(false);
  });
});
