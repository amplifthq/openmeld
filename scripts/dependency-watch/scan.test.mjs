import assert from "node:assert/strict";
import test from "node:test";
import {
  collectCurrent,
  marker,
  publication,
  render,
  scan,
  updateKind,
} from "./scan.mjs";

const errors = {
  unstable: /not stable/,
  missing: /missing/,
  format: /format/,
  workspace: /clients\/web/,
  patch: /pnpm patch/,
  unavailable: /503/,
  identity: /identity/,
};

const watch = { agents: "Review peer compatibility." };
const lock = {
  lockfileVersion: "9.0",
  importers: {
    "services/remote-agent": {
      dependencies: {
        agents: { specifier: "^0.20.0", version: "0.28.1(peer@1.0.0)" },
      },
    },
    "clients/web": {
      devDependencies: { agents: { specifier: "catalog:", version: "0.27.0" } },
    },
  },
  patchedDependencies: { "agents@0.28.1": { path: "example.patch" } },
};

test("compares installed stable versions, never proposes a downgrade or preview", () => {
  assert.equal(updateKind("2.9.9", "2.10.0"), "minor");
  assert.equal(updateKind("2.9.9", "3.0.0"), "major");
  assert.equal(updateKind("2.9.9", "2.9.10"), "patch");
  assert.equal(updateKind("2.9.9", "2.9.9"), null);
  assert.equal(updateKind("3.0.0", "2.9.10"), null);
  assert.equal(updateKind("3.0.0-rc.1", "3.0.0"), "stable");
  assert.throws(() => updateKind("2.9.9", "3.0.0-beta.1"), errors.unstable);
});

test("uses actual importer versions including catalog and peer-qualified resolutions", () => {
  assert.deepEqual(collectCurrent(lock, watch).get("agents"), [
    { workspace: "services/remote-agent", version: "0.28.1" },
    { workspace: "clients/web", version: "0.27.0" },
  ]);
  assert.throws(
    () => collectCurrent(lock, { missing: "Review" }),
    errors.missing
  );
  assert.throws(
    () => collectCurrent({ ...lock, lockfileVersion: "10" }, watch),
    errors.format
  );
});

test("reports only newer direct versions with patch review and workspace context", async () => {
  const rows = await scan(lock, watch, (url) => {
    assert.equal(url, "https://registry.npmjs.org/agents/latest");
    return Response.json({ name: "agents", version: "0.28.1" });
  });
  assert.deepEqual(rows[0].changes, [{ version: "0.27.0", kind: "minor" }]);
  assert.equal(rows[0].patched, true);
  const body = render(rows);
  assert.ok(body.startsWith(marker));
  assert.match(body, errors.workspace);
  assert.match(body, errors.patch);
  assert.equal(
    render(rows),
    body,
    "Repeated scans must not generate timestamp churn"
  );
});

test("fails a partial registry scan instead of publishing a misleading empty list", async () => {
  await assert.rejects(
    scan(lock, watch, async () => new Response("down", { status: 503 })),
    errors.unavailable
  );
  await assert.rejects(
    scan(lock, watch, async () =>
      Response.json({ name: "wrong", version: "1.0.0" })
    ),
    errors.identity
  );
});

test("one issue is created, updated only on change, and closed when resolved", () => {
  assert.equal(publication(null, "report", false), "none");
  assert.equal(publication(null, "report", true), "create");
  assert.equal(
    publication({ body: "report", state: "open" }, "report", true),
    "none"
  );
  assert.equal(
    publication({ body: "report", state: "closed" }, "report", true),
    "none"
  );
  assert.equal(
    publication({ body: "old", state: "closed" }, "new", true),
    "update"
  );
  assert.equal(
    publication({ body: "old", state: "open" }, "none", false),
    "close"
  );
  assert.equal(
    publication({ body: "old", state: "closed" }, "none", false),
    "none"
  );
});
