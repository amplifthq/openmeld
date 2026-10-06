import type { ConnectorConnection } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { forwardGitConnectionRequest } from "../connectors/github-connection-transport";

function fixture(scope: "member" | "shared" = "member") {
  const connection: ConnectorConnection = {
    canDisconnect: true,
    connectionName:
      scope === "member"
        ? "org_jDP24TXqHDw4QFPNXJ__user_6FQDVzWXOz5qutcJ8L__github"
        : "org_jDP24TXqHDw4QFPNXJ__shared__github",
    createdAtMs: 1000,
    updatedAtMs: 1000,
    disconnectedAtMs: null,
    organizationId: "org_test",
    userId: "user_one",
    ownerDisplayName: "Requester",
    service: "github",
    status: "active",
    scope,
  };
  const authorize = vi.fn(
    async (): Promise<unknown> => ({
      connection,
      permission: "read",
      selection: scope === "member" ? "requester" : "shared",
    })
  );
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response("0000", {
        headers: {
          "content-type": "application/x-git-upload-pack-advertisement",
        },
      })
  );
  return {
    request: new Request(
      "https://git.openmeld.invalid/op/acme/private.git/info/refs?service=git-upload-pack",
      {
        headers: {
          authorization: "shell-secret",
          cookie: "session=secret",
          "x-oo-connector-alias": "other-account",
        },
      }
    ),
    endpoint: "info/refs" as const,
    owner: "acme",
    repo: "private",
    organizationId: "org_test",
    requesterUserId: "user_one",
    operationId: "op",
    connection,
    authorize,
    transport,
    connectorExecution: {
      baseUrl: "https://connector.example",
      runtimeToken: "host-runtime-secret",
      fetch: transport,
    },
  };
}

describe("selected GitHub connection transport", () => {
  it.each([
    "member",
    "shared",
  ] as const)("uses the verified %s connection and replaces untrusted headers", async (scope) => {
    const f = fixture(scope);
    const response = await forwardGitConnectionRequest(f);
    expect(response.status).toBe(200);
    const call = f.transport.mock.calls[0];
    if (!call) {
      throw new Error("Expected a connector request");
    }
    const [url, init] = call;
    expect(String(url)).toBe(
      "https://connector.example/v1/openmeld/git-connections/acme/private/info/refs?service=git-upload-pack"
    );
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer host-runtime-secret");
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("x-openmeld-connection-scope")).toBe(scope);
    expect(headers.get("x-oo-connector-alias")).toBe(
      f.connection.connectionName
    );
    expect(init?.redirect).toBe("manual");
    expect(await response.text()).toBe("0000");
    expect(response.headers.get("authorization")).toBeNull();
  });

  it.each([
    { status: "disconnected" },
    { updatedAtMs: 1001 },
    { connectionName: "different-account" },
    { organizationId: "other-org" },
    { userId: "other-member" },
    { scope: "shared" },
    { service: "gmail" },
  ])("rejects a connection change before network access: %j", async (change) => {
    const f = fixture();
    f.authorize.mockResolvedValue({
      connection: { ...f.connection, ...change },
      permission: "read",
      selection: "requester",
    });
    expect((await forwardGitConnectionRequest(f)).status).toBe(403);
    expect(f.transport).not.toHaveBeenCalled();
  });

  it("requires fresh execution and connection authorization for every exchange", async () => {
    const f = fixture();
    expect((await forwardGitConnectionRequest(f)).status).toBe(200);
    f.authorize.mockRejectedValueOnce(new Error("execution revoked"));
    expect((await forwardGitConnectionRequest(f)).status).toBe(403);
    f.authorize.mockResolvedValueOnce({
      connection: f.connection,
      selection: "requester",
    });
    expect((await forwardGitConnectionRequest(f)).status).toBe(403);
    expect(f.authorize).toHaveBeenCalledTimes(3);
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it("streams pack bytes and propagates cancellation", async () => {
    const f = fixture();
    const controller = new AbortController();
    let finish: (() => void) | undefined;
    const body = new ReadableStream({
      start(stream) {
        stream.enqueue(new TextEncoder().encode("first"));
        finish = () => {
          stream.enqueue(new TextEncoder().encode("last"));
          stream.close();
        };
      },
    });
    f.transport.mockResolvedValueOnce(
      new Response(body, {
        headers: {
          "content-type": "application/x-git-upload-pack-result",
          "set-cookie": "secret",
        },
      })
    );
    const request = new Request(
      "https://git.openmeld.invalid/op/acme/private.git/git-upload-pack",
      {
        method: "POST",
        body: "0000",
        signal: controller.signal,
        headers: {
          "content-type": "application/x-git-upload-pack-request",
          "git-protocol": "version=2",
        },
      }
    );
    const response = await forwardGitConnectionRequest({
      ...f,
      request,
      endpoint: "git-upload-pack",
    });
    expect(response.status).toBe(200);
    expect(f.transport.mock.calls[0]?.[1]?.body).toBe(request.body);
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Expected a pack stream");
    }
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("first");
    finish?.();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("last");
    controller.abort();
    expect(f.transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each([
    302, 404, 200,
  ])("rejects redirects, old endpoints, and non-Git responses (%s) without retry", async (status) => {
    const f = fixture();
    f.transport.mockResolvedValueOnce(
      new Response("not a pack", {
        status,
        headers: { location: "https://other.example" },
      })
    );
    expect((await forwardGitConnectionRequest(f)).status).toBe(502);
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it("rejects receive-pack before authorization or network access", async () => {
    const f = fixture();
    f.request = new Request(
      "https://git.openmeld.invalid/op/acme/private.git/info/refs?service=git-receive-pack"
    );
    expect((await forwardGitConnectionRequest(f)).status).toBe(400);
    expect(f.authorize).not.toHaveBeenCalled();
    expect(f.transport).not.toHaveBeenCalled();
  });
});
