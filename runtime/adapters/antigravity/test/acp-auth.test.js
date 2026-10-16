import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkAntigravityAcpAccount } from "../dist/index.js";

const launchContract = {
  kind: "node_script",
  nodePath: process.execPath,
  scriptPath: fileURLToPath(
    new URL("./fixtures/acp-auth-server.cjs", import.meta.url)
  ),
};

test("native account lifecycle: signed out, explicit login, fresh process, logout, expired and network error", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openmeld-acp-auth-"));
  const input = {
    cwd,
    launchContract,
    env: { GEMINI_HOME: cwd },
    timeoutMs: 5000,
  };
  try {
    assert.equal(
      (await checkAntigravityAcpAccount(input)).authStatus,
      "unauthenticated"
    );
    const urls = [];
    assert.equal(
      (
        await checkAntigravityAcpAccount({
          ...input,
          login: {
            methodId: "oauth-personal",
            onAuthorizationUrl: (url) => urls.push(url),
          },
        })
      ).authStatus,
      "authenticated"
    );
    assert.equal(urls.length, 1);
    assert.equal(
      (await checkAntigravityAcpAccount(input)).authStatus,
      "authenticated"
    );
    await rm(join(cwd, "signed-in"));
    assert.equal(
      (await checkAntigravityAcpAccount(input)).authStatus,
      "unauthenticated"
    );
    assert.equal(
      (
        await checkAntigravityAcpAccount({
          ...input,
          env: { ...input.env, FIXTURE_EXPIRED: "1" },
        })
      ).authStatus,
      "unauthenticated"
    );
    await assert.rejects(
      checkAntigravityAcpAccount({
        ...input,
        env: { ...input.env, FIXTURE_NETWORK: "1" },
      }),
      { code: "protocol.request_failed" }
    );
    const methods = (await readFile(join(cwd, "requests.jsonl"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(
      methods.filter((method) => method === "authenticate").length,
      1
    );
    assert.equal(methods.includes("session/prompt"), false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("cancel and timeout terminate a pending native login without reporting success", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openmeld-acp-cancel-"));
  try {
    const signal = new AbortController();
    const input = {
      cwd,
      launchContract,
      env: { GEMINI_HOME: cwd, FIXTURE_WAIT: "1" },
      timeoutMs: 5000,
    };
    await assert.rejects(
      checkAntigravityAcpAccount({
        ...input,
        signal: signal.signal,
        login: {
          methodId: "oauth-personal",
          onAuthorizationUrl: () => signal.abort(),
        },
      }),
      { code: "auth.cancelled" }
    );
    await assert.rejects(
      checkAntigravityAcpAccount({
        ...input,
        timeoutMs: 300,
        login: {
          methodId: "oauth-personal",
          onAuthorizationUrl() {
            /* Leave login pending to exercise the deadline. */
          },
        },
      }),
      { code: "process.timeout" }
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
