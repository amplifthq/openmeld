import { describe, expect, it, vi } from "vitest";
import {
  GitHubWorkingCopyProvider,
  gitBlobSha,
} from "../connectors/github-working-copy-provider";

const SHA = "a".repeat(40);
const BRANCH = `openmeld/work-${"b".repeat(32)}`;
function fixture(data: unknown, status = 200) {
  // OpenConnector c6f45596 runtime-api.md: a proxy success wraps status/headers/data.
  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({
      success: true,
      message: "OK",
      data: { status, headers: {}, data },
    })
  );
  const authorize = vi.fn(async (_effect: "read" | "write") => undefined);
  const provider = new GitHubWorkingCopyProvider({
    owner: "acme",
    repo: "private",
    connectionName: "selected-connection",
    runtime: {
      baseUrl: "https://connector.example",
      runtimeToken: "server-runtime-secret",
      fetch: fetchMock,
    },
    authorize,
  });
  return { fetchMock, authorize, provider };
}

describe("fixed GitHub working-copy proxy adapter", () => {
  it("uses the named Plugin connection and rechecks access around the exact repository read", async () => {
    const f = fixture({
      id: 42,
      full_name: "acme/private",
      default_branch: "main",
    });
    await f.provider.repository();
    expect(f.authorize.mock.calls).toEqual([["read"], ["read"]]);
    const call = f.fetchMock.mock.calls[0];
    if (!call?.[1]) {
      throw new Error("Expected one provider request");
    }
    const [url, options] = call;
    expect(url).toBe(
      "https://connector.example/v1/openmeld/github-working-copy"
    );
    expect(new Headers(options?.headers).get("x-oo-connector-alias")).toBe(
      "selected-connection"
    );
    expect(JSON.parse(options?.body as string)).toEqual({
      endpoint: "/repos/acme/private",
      method: "GET",
    });
    // Workers fetch rejects redirect: "error"; manual keeps redirects unfollowed.
    expect(options?.redirect).toBe("manual");
  });
  it("fails closed instead of following a redirect from the connection runtime", async () => {
    const f = fixture({});
    f.fetchMock.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://elsewhere.example/steal" },
      })
    );
    await expect(f.provider.repository()).rejects.toThrow(
      "github.checkout.unexpected_redirect"
    );
    expect(f.fetchMock.mock.calls).toHaveLength(1);
  });
  it("rejects incomplete trees instead of presenting a partial repository as ready", async () => {
    const f = fixture({ sha: SHA, truncated: true, tree: [] });
    await expect(f.provider.tree(SHA)).rejects.toThrow("incomplete_tree");
  });
  it("checks binary blob length and Git's content hash", async () => {
    const bytes = Buffer.from([0, 255, 3, 128]);
    const sha = await gitBlobSha(bytes);
    const f = fixture({
      sha,
      encoding: "base64",
      content: bytes.toString("base64"),
      size: bytes.length,
    });
    expect(await f.provider.blob(sha)).toEqual(Uint8Array.from(bytes));
    await expect(f.provider.blob(SHA)).rejects.toThrow("integrity_failed");
  });
  it("never force-pushes or exposes an arbitrary branch-writing endpoint", async () => {
    const f = fixture({});
    await expect(f.provider.publish("main", SHA, true)).rejects.toThrow(
      "task_branch_required"
    );
    expect(f.fetchMock).not.toHaveBeenCalled();
    await f.provider.publish(BRANCH, SHA, true);
    expect(f.authorize.mock.calls).toEqual([["write"], ["write"]]);
    const body = JSON.parse(f.fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(body).toMatchObject({
      method: "PATCH",
      body: { sha: SHA, force: false },
    });
  });
  it("withholds results when authorization is revoked during a request", async () => {
    const f = fixture({
      id: 42,
      full_name: "acme/private",
      default_branch: "main",
    });
    f.authorize
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("revoked"));
    await expect(f.provider.repository()).rejects.toThrow("revoked");
  });
  it("reports proxy permission failures without echoing raw provider secrets", async () => {
    const f = fixture({});
    f.fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          success: false,
          errorCode: "proxy_not_allowed",
          message: "sensitive-provider-data",
        },
        { status: 403 }
      )
    );
    await expect(f.provider.repository()).rejects.toThrow("proxy_not_allowed");
    f.fetchMock.mockResolvedValueOnce(
      Response.json(
        {
          success: false,
          errorCode: "proxy_not_allowed",
          message: "sensitive-provider-data",
        },
        { status: 403 }
      )
    );
    await expect(f.provider.repository()).rejects.not.toThrow(
      "sensitive-provider-data"
    );
  });
  it("does not leak malformed authenticated response text through JSON parser errors", async () => {
    const f = fixture({});
    f.fetchMock.mockResolvedValueOnce(
      new Response("private-secret-invalid-json")
    );
    await expect(f.provider.repository()).rejects.toThrow(
      "github.checkout.invalid_provider_response"
    );
  });

  it("only treats an actual provider 404 as an absent task branch", async () => {
    const f = fixture({}, 404);
    expect(await f.provider.branch(BRANCH)).toBeNull();
    const denied = fixture({}, 403);
    await expect(denied.provider.branch(BRANCH)).rejects.toThrow("HTTP 403");
    const mismatched = fixture({
      ref: "refs/tags/main",
      object: { type: "commit", sha: SHA },
    });
    await expect(mismatched.provider.branch("main")).rejects.toThrow(
      "unexpected_ref"
    );
  });
  it("refuses a created tree different from the immutable local snapshot before updating a branch", async () => {
    const f = fixture({ sha: "b".repeat(40) });
    await expect(f.provider.createTree([], SHA)).rejects.toThrow(
      "tree_integrity_failed"
    );
    expect(f.fetchMock.mock.calls).toHaveLength(1);
  });
});
