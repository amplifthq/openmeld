import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { afterEach, mock } from "node:test";
import { verifyOpenCodeLaunchContract } from "../dist/index.js";

const fixtureRoots = new Set();
afterEach(async () => {
  mock.timers.reset();
  for (const root of fixtureRoots) {
    await rm(root, { recursive: true, force: true });
    fixtureRoots.delete(root);
  }
});

async function createInstallation(kind = "node_script") {
  const root = await mkdtemp(join(tmpdir(), "opencode-install-verification-"));
  fixtureRoots.add(root);
  const scriptPath = join(root, "opencode.cjs");
  const startsPath = join(root, "starts");
  const failurePath = join(root, "failure");
  const script = `#!${process.execPath}
const fs = require("node:fs");
fs.appendFileSync(${JSON.stringify(startsPath)}, "start" + String.fromCharCode(10));
if (fs.existsSync(${JSON.stringify(failurePath)})) {
  if (fs.readFileSync(${JSON.stringify(failurePath)}, "utf8") === "signal") {
    process.kill(process.pid, "SIGTERM");
  } else {
    process.exitCode = 1;
  }
} else {
  console.log("1.1.31");
}
`;
  await writeFile(scriptPath, script);
  await chmod(scriptPath, 0o755);
  const launchContract =
    kind === "executable"
      ? { kind, commandPath: scriptPath }
      : { kind, nodePath: process.execPath, scriptPath };
  return {
    root,
    script,
    scriptPath,
    startsPath,
    failurePath,
    input: {
      cwd: root,
      launchContract,
      reuseSuccessfulResult: true,
      timeoutMs: 5000,
    },
    starts: async () =>
      (await readFile(startsPath, "utf8")).trim().split("\n").length,
  };
}

// The direct executable fixture uses a POSIX shebang. Delegated Node launch
// contracts below exercise argsPrefix on every platform.
const reusableKinds =
  process.platform === "win32"
    ? ["node_script"]
    : ["executable", "node_script"];
for (const kind of reusableKinds) {
  test(`${kind} installation discovery reuses and coalesces successful probes while explicit checks stay fresh`, async () => {
    const fixture = await createInstallation(kind);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        verifyOpenCodeLaunchContract(fixture.input)
      )
    );
    assert.ok(results.every((result) => result.ok));
    assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
    assert.equal(await fixture.starts(), 1);

    assert.equal(
      (
        await verifyOpenCodeLaunchContract({
          ...fixture.input,
          reuseSuccessfulResult: false,
        })
      ).ok,
      true
    );
    assert.equal(await fixture.starts(), 2);
  });
}

for (const change of ["removed", "broken"]) {
  test(`delegated executable checks stay fresh when their script is ${change}`, async () => {
    const fixture = await createInstallation();
    const input = {
      ...fixture.input,
      launchContract: {
        kind: "executable",
        commandPath: process.execPath,
        argsPrefix: [fixture.scriptPath],
      },
    };
    assert.equal((await verifyOpenCodeLaunchContract(input)).ok, true);
    assert.equal((await verifyOpenCodeLaunchContract(input)).ok, true);
    assert.equal(await fixture.starts(), 2);

    if (change === "removed") {
      await rm(fixture.scriptPath);
    } else {
      await writeFile(fixture.scriptPath, "process.exitCode = 1;");
    }
    assert.equal((await verifyOpenCodeLaunchContract(input)).ok, false);
  });
}

test("installation verification invalidates replaced files, permissions, and missing commands", async () => {
  const fixture = await createInstallation();
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);

  const replacement = join(fixture.root, "replacement.cjs");
  await writeFile(replacement, fixture.script);
  await chmod(replacement, 0o755);
  await rename(replacement, fixture.scriptPath);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 2);

  if (process.platform !== "win32") {
    await chmod(fixture.scriptPath, 0o000);
    assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, false);
    await chmod(fixture.scriptPath, 0o755);
    assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
    assert.equal(await fixture.starts(), 3);
  }

  await rm(fixture.scriptPath);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, false);
});

test("installation verification invalidates a retargeted command symlink", async () => {
  const fixture = await createInstallation();
  const alias = join(fixture.root, "selected.cjs");
  await symlink(fixture.scriptPath, alias);
  fixture.input.launchContract.scriptPath = alias;
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);

  const replacement = join(fixture.root, "replacement.cjs");
  await writeFile(replacement, fixture.script);
  await rm(alias);
  await symlink(replacement, alias);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 2);
});

test("node package versions and vendored native payload changes invalidate discovery verification", async () => {
  const fixture = await createInstallation();
  const packageName = `opencode-${process.platform}-${process.arch}`;
  const manifestPath = join(fixture.root, "package.json");
  const manifest = {
    name: "opencode-ai",
    version: "1.1.31",
    optionalDependencies: { [packageName]: "1.1.31" },
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  const packageRoot = join(fixture.root, "node_modules", packageName);
  const payloadPath = join(
    packageRoot,
    "bin",
    process.platform === "win32" ? "opencode.exe" : "opencode"
  );
  await mkdir(dirname(payloadPath), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({ name: packageName })
  );
  await writeFile(payloadPath, "native payload v1");
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 1);

  await writeFile(payloadPath, "native payload v2");
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 2);

  await writeFile(
    manifestPath,
    JSON.stringify({ ...manifest, version: "1.1.32" })
  );
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 3);
});

for (const failure of ["exit", "signal"]) {
  test(`a ${failure} failure is retried without changing installation files`, async () => {
    const fixture = await createInstallation();
    await writeFile(fixture.failurePath, failure);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      assert.equal(
        (await verifyOpenCodeLaunchContract(fixture.input)).ok,
        false
      );
    }
    assert.equal(await fixture.starts(), 2);

    await rm(fixture.failurePath);
    assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
    assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
    assert.equal(await fixture.starts(), 3);

    await writeFile(fixture.failurePath, failure);
    assert.equal(
      (
        await verifyOpenCodeLaunchContract({
          ...fixture.input,
          reuseSuccessfulResult: false,
        })
      ).ok,
      false
    );
    assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, false);
    assert.equal(await fixture.starts(), 5);
  });
}

test("a file changed during a successful check is verified again", async () => {
  const fixture = await createInstallation();
  const markerPath = join(fixture.root, "updated");
  await writeFile(
    fixture.scriptPath,
    `${fixture.script}
if (!fs.existsSync(${JSON.stringify(markerPath)})) {
  fs.appendFileSync(__filename, String.fromCharCode(10));
  fs.writeFileSync(${JSON.stringify(markerPath)}, "updated");
}
`
  );
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 2);
});

test("discovery verification expires without turning launch evidence into permanent readiness", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1000 });
  const fixture = await createInstallation();
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  mock.timers.tick(15 * 60_000 - 1);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 1);
  mock.timers.tick(1);
  assert.equal((await verifyOpenCodeLaunchContract(fixture.input)).ok, true);
  assert.equal(await fixture.starts(), 2);
});
