import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_APP_ORIGIN } from "@openmeld/schemas";
import { expect, it } from "vitest";
import { createPilotProtocol } from "../src/main/pilot-protocol";
import { createTransportDiagnostics } from "../src/main/transport-diagnostics";

const PRIVATE_VALUES = /private-(credential|message|space)|search=/u;

it("retains bounded private transport evidence without credentials, query values or message text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "desktop-diagnostics-"));
  const diagnostics = createTransportDiagnostics({
    directory,
    version: "0.1.6",
    webBuild: "a".repeat(64),
  });
  try {
    let status = 401;
    const handle = createPilotProtocol({
      assets: "/unused",
      webOrigin: "https://web.example",
      webBuild: "a".repeat(64),
      cookie: () => "private-credential",
      fetch,
      cloudRequest: () => {
        if (!status) {
          return Promise.reject(
            new TypeError("network failed with private-credential")
          );
        }
        return Promise.resolve(
          new Response("private-message", {
            status,
            headers: {
              "x-openmeld-request-id": "10000000-0000-4000-8000-000000000001",
            },
          })
        );
      },
      observe: diagnostics.record,
    });
    // Saturate the ring, then exercise real response and exception boundaries.
    for (let i = 0; i < 205; i++) {
      diagnostics.record({
        kind: "stream",
        spaceId: "private-space",
        event: "connecting",
      });
    }
    for (status of [401, 503, 200, 0]) {
      const request = new Request(
        `${DESKTOP_APP_ORIGIN}/v1/spaces/private-space/members?search=private-message`
      );
      if (status) {
        expect((await handle(request)).status).toBe(status);
      } else {
        await expect(handle(request)).rejects.toThrow("network failed");
      }
    }
    diagnostics.record({
      kind: "stream",
      spaceId: "private-space",
      event: "close",
      code: 1006,
    });
    diagnostics.record({
      kind: "stream",
      spaceId: "private-space",
      event: "open",
    });
    await diagnostics.flush();
    const raw = await readFile(join(directory, "transport.json"), "utf8");
    expect(raw).not.toMatch(PRIVATE_VALUES);
    const saved = JSON.parse(raw);
    expect(saved.version).toBe("0.1.6");
    expect(saved.events).toHaveLength(200);
    const requests = saved.events.filter(
      (event: { kind: string }) => event.kind === "request"
    );
    expect(requests.map((event: { outcome: string }) => event.outcome)).toEqual(
      ["authentication", "http", "ok", "network"]
    );
    expect(requests[0]).toMatchObject({
      route: "/v1/spaces/:space/members",
      status: 401,
      requestId: "10000000-0000-4000-8000-000000000001",
    });
    const [closed, opened] = saved.events.slice(-2);
    expect(closed.stream).toBe(opened.stream);
    expect(closed.code).toBe(1006);
    if (process.platform !== "win32") {
      expect(
        (await stat(join(directory, "transport.json"))).mode % 0o1000
      ).toBe(0o600);
    }
  } finally {
    await diagnostics.flush();
    await rm(directory, { recursive: true, force: true });
  }
});
