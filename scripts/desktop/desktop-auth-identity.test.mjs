import assert from "node:assert/strict";
import test from "node:test";
import { desktopAuthIdentity } from "../../packages/schemas/src/desktop-auth-identity.ts";

const PRODUCTION_REJECTION = /not allowed in production/u;

test("worktree callbacks are stable and distinct across worktrees and ports", () => {
  const a = "http://wt-aaaaaaaaaaaa.localhost:31000";
  const b = "http://wt-bbbbbbbbbbbb.localhost:31000";
  assert.deepEqual(desktopAuthIdentity(false, undefined, a), {
    clientId: "electron",
    authScheme: "sh.openmeld.desktop.dev.wt-aaaaaaaaaaaa.p31000",
  });
  assert.notEqual(
    desktopAuthIdentity(false, undefined, a).authScheme,
    desktopAuthIdentity(false, undefined, b).authScheme
  );
  assert.notEqual(
    desktopAuthIdentity(false, undefined, a).authScheme,
    desktopAuthIdentity(false, undefined, a.replace("31000", "31016"))
      .authScheme
  );
});

test("installed identities and non-worktree private environments do not change", () => {
  assert.equal(
    desktopAuthIdentity(
      true,
      undefined,
      "http://wt-aaaaaaaaaaaa.localhost:31000"
    ).authScheme,
    "sh.openmeld.desktop"
  );
  assert.equal(
    desktopAuthIdentity(
      false,
      "disposable",
      "http://wt-aaaaaaaaaaaa.localhost:31000"
    ).authScheme,
    "sh.openmeld.desktop.test"
  );
  for (const origin of [
    undefined,
    "http://localhost:3000",
    "https://wt-aaaaaaaaaaaa.localhost:31000",
    "http://wt-aaaaaaaaaaaa.localhost.evil:31000",
    "http://user@wt-aaaaaaaaaaaa.localhost:31000",
    "http://wt-aaaaaaaaaaaa.localhost:31000/path",
  ]) {
    assert.equal(
      desktopAuthIdentity(false, undefined, origin).authScheme,
      "sh.openmeld.desktop.dev"
    );
  }
  assert.throws(
    () => desktopAuthIdentity(true, "private"),
    PRODUCTION_REJECTION
  );
});
