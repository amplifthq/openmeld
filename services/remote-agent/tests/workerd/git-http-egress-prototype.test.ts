import { CloudflareContainerBackend } from "@cloudflare/computer/backends/container";
import { describe, expect, it } from "vitest";

// Feasibility probe for a tokenless Git smart-HTTP transport. This exercises
// the installed Computer SDK's actual gateway forwarding path with a binary
// upload-pack POST and response; it does not grant repository access.
describe("Computer Git HTTP egress feasibility", () => {
  it("forwards a large streaming POST and response without exposing the gateway token upstream", async () => {
    let egressToken = "";
    let upstreamRequest: Request | undefined;
    const chunk = new Uint8Array(1024 * 1024);
    const chunkCount = 32;
    const gateway = {
      fetch: async (request: Request) => {
        upstreamRequest = request;
        let receivedBytes = 0;
        if (request.body) {
          const reader = request.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              break;
            }
            receivedBytes += value.byteLength;
          }
        }
        expect(receivedBytes).toBe(chunk.byteLength * chunkCount);
        let sent = 0;
        return new Response(
          new ReadableStream({
            pull(controller) {
              if (sent++ < chunkCount) {
                controller.enqueue(chunk);
              } else {
                controller.close();
              }
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/x-git-upload-pack-result" },
          }
        );
      },
    } as Fetcher;
    const backend = new CloudflareContainerBackend({
      container: () => ({
        getWorkspaceContainer: () =>
          ({
            exitInfo: async () => null,
            start: async () => ({ runtimeId: "test" }),
            restart: async () => ({ runtimeId: "test" }),
            status: async () => ({ running: true, exit: null }),
            fetchPort: async () => new Response("unused"),
            port: () => ({ fetch: async () => new Response("unused") }),
            interceptOutboundHttp: async () => undefined,
            interceptAllOutboundHttp: (_ref: unknown, token: string) => {
              egressToken = token;
              throw new Error("Stop before opening a real container");
            },
          }) as never,
      }),
      egress: { mode: "http-gateway", gateway },
      workspace: { binding: "AGENT_COMPUTER", id: "test" },
    });
    await expect(backend.connect()).rejects.toThrow(
      "Stop before opening a real container"
    );
    expect(egressToken).not.toBe("");

    let produced = 0;
    const response = await backend.handleFetch(
      new Request("https://workspace.internal/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request",
          "x-workspace-egress-token": egressToken,
          "x-workspace-egress-url":
            "https://github.com/example/repo.git/git-upload-pack",
        },
        body: new ReadableStream({
          pull(controller) {
            if (produced++ < chunkCount) {
              controller.enqueue(chunk);
            } else {
              controller.close();
            }
          },
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/x-git-upload-pack-result"
    );
    expect(upstreamRequest?.headers.has("x-workspace-egress-token")).toBe(
      false
    );
    expect(upstreamRequest?.headers.has("x-workspace-egress-url")).toBe(false);
    let returnedBytes = 0;
    if (response.body) {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        returnedBytes += value.byteLength;
      }
    }
    expect(returnedBytes).toBe(chunk.byteLength * chunkCount);
  });
});
