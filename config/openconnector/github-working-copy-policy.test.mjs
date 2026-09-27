import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isAllowedGitWorkingCopyRequest,
  OPENMELD_GIT_PROXY_PATH,
  OPENMELD_GIT_PROXY_UPSTREAM_SHA,
  withGitWorkingCopyPolicy,
} from "./github-working-copy-policy.mjs";

const SHA = "a".repeat(40);
const BRANCH = `openmeld/work-${"b".repeat(32)}`;
const ROOT = "/repos/acme/repository";
const reads = [
  "",
  "/commits/main",
  "/commits/topic%2Fbranch",
  "/git/ref/heads/main",
  "/git/ref/heads/release%2Fstable",
  `/git/blobs/${SHA}`,
  `/git/trees/${SHA}`,
  `/git/ref/heads/${encodeURIComponent(BRANCH)}`,
];

describe("reviewed Git working-copy ingress", () => {
  it("admits only required repository reads and non-force task-branch writes", () => {
    for (const path of reads) {
      assert.equal(
        isAllowedGitWorkingCopyRequest({
          endpoint: ROOT + path,
          method: "GET",
        }),
        true,
        path
      );
    }
    assert.equal(
      isAllowedGitWorkingCopyRequest({
        endpoint: `${ROOT}/git/refs`,
        method: "POST",
        body: { ref: `refs/heads/${BRANCH}`, sha: SHA },
      }),
      true
    );
    assert.equal(
      isAllowedGitWorkingCopyRequest({
        endpoint: `${ROOT}/git/refs/heads/${encodeURIComponent(BRANCH)}`,
        method: "PATCH",
        body: { sha: SHA, force: false },
      }),
      true
    );
    assert.equal(
      isAllowedGitWorkingCopyRequest({
        endpoint: `${ROOT}/git/commits`,
        method: "POST",
        body: { tree: SHA, parents: [SHA], message: "One task change" },
      }),
      true
    );
  });
  it("rejects destructive APIs, arbitrary hosts, header injection, repository traversal and identity spoofing", () => {
    const denied = [
      { endpoint: ROOT, method: "DELETE" },
      { endpoint: `${ROOT}/releases`, method: "POST", body: {} },
      {
        endpoint: `${ROOT}/git/refs`,
        method: "POST",
        body: { ref: "refs/heads/main", sha: SHA },
      },
      {
        endpoint: `${ROOT}/git/refs/heads/${encodeURIComponent(BRANCH)}`,
        method: "PATCH",
        body: { sha: SHA, force: true },
      },
      {
        endpoint: `${ROOT}/git/commits`,
        method: "POST",
        body: {
          tree: SHA,
          parents: [SHA],
          message: "spoof",
          author: { name: "Another person" },
        },
      },
      { endpoint: "https://evil.example/repos/acme/repository", method: "GET" },
      { endpoint: "/repos/acme/../user", method: "GET" },
      { endpoint: `${ROOT}/commits/..`, method: "GET" },
      { endpoint: `${ROOT}/commits/%252e%252e`, method: "GET" },
      { endpoint: `${ROOT}/git/ref/heads/..`, method: "GET" },
      { endpoint: `${ROOT}/git/ref/heads/%252e%252e`, method: "GET" },
      { endpoint: `${ROOT}/git/matching-refs/heads/main`, method: "GET" },
      { endpoint: `${ROOT}/git/ref/tags/main`, method: "GET" },
      {
        endpoint: `${ROOT}/git/refs/heads/main`,
        method: "PATCH",
        body: { sha: SHA, force: false },
      },
      { endpoint: ROOT, method: "GET", headers: { authorization: "guessed" } },
      {
        endpoint: ROOT,
        method: "GET",
        query: { redirect: "https://evil.example" },
      },
    ];
    for (const value of denied) {
      assert.equal(
        isAllowedGitWorkingCopyRequest(value),
        false,
        JSON.stringify(value)
      );
    }
  });
  it("retains upstream authentication and does not broaden ordinary API or MCP policy", async () => {
    const calls = [];
    const upstream = {
      fetch: async (request, env) => {
        calls.push({ request, env });
        // The actual upstream owns token verification; the wrapper must preserve it.
        return await Promise.resolve(
          new Response("upstream auth denied", { status: 401 })
        );
      },
    };
    const worker = withGitWorkingCopyPolicy(upstream);
    const env = {
      OOMOL_CONNECT_BLOCKED_PROXIES: "*",
      OOMOL_CONNECT_RUNTIME_TOKEN: "real-token",
    };
    const response = await worker.fetch(
      new Request(`https://connector.example${OPENMELD_GIT_PROXY_PATH}`, {
        method: "POST",
        headers: {
          authorization: "Bearer wrong-token",
          "x-oo-connector-alias": "selected",
        },
        body: JSON.stringify({ endpoint: ROOT, method: "GET" }),
      }),
      env,
      {}
    );
    assert.equal(response.status, 401);
    assert.equal(
      calls[0].request.headers.get("authorization"),
      "Bearer wrong-token"
    );
    assert.equal(new URL(calls[0].request.url).pathname, "/v1/proxy/github");
    assert.equal(calls[0].env.OOMOL_CONNECT_ALLOWED_PROXIES, "github");
    assert.equal(calls[0].env.OOMOL_CONNECT_BLOCKED_PROXIES, "");
    assert.equal(env.OOMOL_CONNECT_BLOCKED_PROXIES, "*");
    for (const path of [
      "/v1/proxy/github",
      "/mcp",
      "/v1/actions/github.create_release",
    ]) {
      await worker.fetch(
        new Request(`https://connector.example${path}`),
        env,
        {}
      );
      assert.equal(calls.at(-1).env, env);
    }
  });
  it("rejects invalid requests before reaching the credential owner", async () => {
    let calls = 0;
    const worker = withGitWorkingCopyPolicy({
      fetch: () => {
        calls += 1;
        throw new Error("must not reach upstream");
      },
    });
    const response = await worker.fetch(
      new Request(`https://connector.example${OPENMELD_GIT_PROXY_PATH}`, {
        method: "POST",
        headers: { "x-oo-connector-alias": "selected" },
        body: JSON.stringify({ endpoint: ROOT, method: "DELETE" }),
      }),
      {},
      {}
    );
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
  });
  it("pins the reviewed upstream contract and keeps the broad proxy block in both deploy configs", () => {
    assert.equal(
      OPENMELD_GIT_PROXY_UPSTREAM_SHA,
      "c6f45596a8e018285d2799ccd08e6a251444c25d"
    );
    for (const lane of ["staging", "production"]) {
      const config = JSON.parse(
        readFileSync(new URL(`wrangler.${lane}.jsonc`, import.meta.url), "utf8")
      );
      assert.equal(config.main, ".openmeld-working-copy-worker.mjs");
      assert.equal(config.vars.OOMOL_CONNECT_BLOCKED_PROXIES, "*");
      assert.equal(config.vars.OOMOL_CONNECT_ALLOWED_PROXIES, undefined);
    }
  });
});
