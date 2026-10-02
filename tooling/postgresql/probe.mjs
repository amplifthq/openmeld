// biome-ignore-all lint/suspicious/noMisplacedAssertion: Standalone operational acceptance uses node:assert and fails the command on contract violations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { verifyPostgresqlEnvironment } from "./verify.mjs";

verifyPostgresqlEnvironment(new URL("../../", import.meta.url).pathname);
const deployedUrlPattern =
  /https:\/\/openmeld-postgresql-probe-stg\.[a-z0-9-]+\.workers\.dev/u;
const versionPattern = /Current Version ID: ([a-f0-9-]+)/u;

const config = JSON.parse(
  await readFile(new URL("./wrangler.jsonc", import.meta.url), "utf8")
);
const inventory = JSON.parse(
  await readFile(new URL("./resources.json", import.meta.url), "utf8")
);
if (
  config.name !== "openmeld-postgresql-probe-stg" ||
  config.account_id !== inventory.accountId ||
  config.hyperdrive[0]?.id !== inventory.environments.staging.hyperdriveId
) {
  throw new Error("Probe target mismatch");
}
function run(program, args, input) {
  const result = spawnSync(program, args, { encoding: "utf8", input });
  if (result.status !== 0) {
    throw new Error(
      `${program} failed (exit ${result.status}); credential-bearing output suppressed`
    );
  }
  return result.stdout;
}
const token = run("doppler", [
  "secrets",
  "get",
  "POSTGRESQL_OPENMELD_PROBE_TOKEN",
  "--plain",
  "--project",
  "openmeld-release",
  "--config",
  "stg",
  "--silent",
]).trim();
if (process.argv[2] === "deploy") {
  if (Date.parse(config.vars.POSTGRESQL_PROBE_EXPIRES_AT) <= Date.now()) {
    throw new Error("Probe expiry has passed; review the acceptance window");
  }
  const auth = JSON.parse(
    run("pnpm", ["exec", "wrangler", "auth", "token", "--json"])
  );
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${inventory.accountId}/hyperdrive/configs/${inventory.environments.staging.hyperdriveId}`,
    { headers: { Authorization: `Bearer ${auth.token}` }, redirect: "error" }
  );
  const remote = await response.json();
  assert(remote.success);
  assert.equal(remote.result.caching.disabled, true);
  assert.equal(remote.result.origin.host, inventory.environments.staging.host);
  assert.equal(
    remote.result.origin.user,
    `${inventory.environments.staging.runtimeRole}.${inventory.environments.staging.branchId}`
  );
  const hash = createHash("sha256");
  for (const name of [
    "worker.ts",
    "acceptance.mjs",
    "wrangler.jsonc",
    "package.json",
    "../../pnpm-lock.yaml",
  ]) {
    hash.update(name);
    hash.update(await readFile(new URL(name, import.meta.url)));
  }
  const flags = [
    "--config",
    new URL("./wrangler.jsonc", import.meta.url).pathname,
  ];
  run(
    "pnpm",
    ["exec", "wrangler", "secret", "bulk", ...flags],
    JSON.stringify({ POSTGRESQL_OPENMELD_PROBE_TOKEN: token })
  );
  const output = run("pnpm", ["exec", "wrangler", "deploy", ...flags]);
  inventory.environments.staging.probe = {
    url: output.match(deployedUrlPattern)?.[0],
    versionId: output.match(versionPattern)?.[1],
    sourceSha256: hash.digest("hex"),
    status: "deployed",
  };
  assert(
    inventory.environments.staging.probe.url &&
      inventory.environments.staging.probe.versionId
  );
  await writeFile(
    new URL("./resources.json", import.meta.url),
    `${JSON.stringify(inventory, null, 2)}\n`
  );
  console.log(output);
} else if (process.argv[2] === "check") {
  const url = new URL(process.argv[3]);
  if (
    url.protocol !== "https:" ||
    !url.hostname.startsWith(`${config.name}.`) ||
    !url.hostname.endsWith(".workers.dev") ||
    url.origin !== inventory.environments.staging.probe?.url
  ) {
    throw new Error("Expected isolated probe URL");
  }
  url.pathname = "/acceptance";
  assert.equal(
    (await fetch(url, { method: "POST", redirect: "error" })).status,
    401
  );
  for (let i = 0; i < 2; i++) {
    assert.equal(
      (
        await fetch(url, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: `Bearer ${token}` },
        })
      ).status,
      204
    );
  }
  console.log(
    "PASS cloud Worker → Hyperdrive → PostgreSQL: auth, repeated transactions, rollback, immediate reads, CRUD and denied DDL/ledger/TRUNCATE"
  );
  inventory.environments.staging.probe.status = "verified";
  inventory.environments.staging.probe.verifiedAt = new Date().toISOString();
  inventory.environments.staging.status = "foundation-verified";
  await writeFile(
    new URL("./resources.json", import.meta.url),
    `${JSON.stringify(inventory, null, 2)}\n`
  );
} else if (process.argv[2] === "cleanup") {
  assert.equal(inventory.environments.staging.probe?.status, "verified");
  console.log(
    run(
      "pnpm",
      [
        "exec",
        "wrangler",
        "delete",
        "--config",
        new URL("./wrangler.jsonc", import.meta.url).pathname,
      ],
      "y\n"
    )
  );
  inventory.environments.staging.probe.status = "verified-and-removed";
  inventory.environments.staging.probe.removedAt = new Date().toISOString();
  await writeFile(
    new URL("./resources.json", import.meta.url),
    `${JSON.stringify(inventory, null, 2)}\n`
  );
} else {
  throw new Error(
    "Usage: probe.mjs deploy | check <isolated workers.dev URL> | cleanup"
  );
}
