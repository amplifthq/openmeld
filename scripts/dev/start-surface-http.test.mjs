import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildCreateSpaceBody,
  buildJoinSpaceBody,
  normalizeStoredTokenFileKey,
  readStoredAccessToken,
} from "./start-surface-http.mjs";

const INVALID_TOKEN_KEY_ERROR_RE = /stored token key is invalid/u;
const UNATTENDED_KEYCHAIN_ERROR_RE = /must not open authorization windows/u;

test("normalizes only canonical file token keys", () => {
  assert.equal(
    normalizeStoredTokenFileKey(
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    ),
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  );
  assert.equal(normalizeStoredTokenFileKey("../escape"), null);
  assert.equal(normalizeStoredTokenFileKey("token/escape"), null);
  assert.equal(normalizeStoredTokenFileKey("not-hex"), null);
});

test("rejects traversal-like insecure token keys before reading the file", async () => {
  await assert.rejects(
    () =>
      readStoredAccessToken({
        openMeldHome: "/tmp/openmeld-dev",
        tokenRef: {
          provider: "insecure-file",
          key: "../escape",
        },
      }),
    INVALID_TOKEN_KEY_ERROR_RE
  );
});

test("reads a valid insecure token file by its validated key", async () => {
  const openMeldHome = await mkdtemp(join(tmpdir(), "start-surface-http-"));
  try {
    const tokenKey =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    const tokenDirectory = join(openMeldHome, "auth", "tokens");
    await mkdir(tokenDirectory, { recursive: true });
    await writeFile(join(tokenDirectory, `${tokenKey}.token`), "token-123\n");

    const accessToken = await readStoredAccessToken({
      openMeldHome,
      tokenRef: {
        provider: "insecure-file",
        key: tokenKey,
      },
    });

    assert.equal(accessToken, "token-123");
  } finally {
    await rm(openMeldHome, { force: true, recursive: true });
  }
});

test("refuses to open macOS Keychain authorization UI from an unattended dev command", async () => {
  await assert.rejects(
    () =>
      readStoredAccessToken({
        openMeldHome: "/tmp/openmeld-dev",
        tokenRef: {
          provider: "macos-keychain",
          service: "sh.openmeld.test.start-surface-http",
          account: "missing-test-account",
        },
      }),
    UNATTENDED_KEYCHAIN_ERROR_RE
  );
});

test("create-space keeps the body minimal and literal", () => {
  const body = buildCreateSpaceBody({
    name: "  Demo Space  ",
    password: "secret-pass",
  });

  assert.deepEqual(body, {
    name: "Demo Space",
    password: "secret-pass",
  });
});

test("join-space builds the canonical memberProfileIds body", () => {
  const body = buildJoinSpaceBody({
    "member-profile-ids": "prof-1, prof-2",
  });

  assert.deepEqual(body, {
    memberProfileIds: ["prof-1", "prof-2"],
  });
});
