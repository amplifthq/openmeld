// biome-ignore-all lint/suspicious/noMisplacedAssertion: Native acceptance exits nonzero on failure.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";

assert.equal(process.platform, "win32", "Native Windows execution is required");
const repo = path.resolve(import.meta.dirname, "../..");
const desktop = path.join(repo, "clients/desktop");
const requireDesktop = createRequire(path.join(desktop, "package.json"));
const electron = requireDesktop("electron");
const root = await mkdtemp(path.join(tmpdir(), "OpenMeld Startup Test "));
const scratch = path.join(desktop, "dev-tmp");
await mkdir(scratch, { recursive: true });
const fixture = await mkdtemp(path.join(scratch, "startup-native-"));
try {
  // Exercise the installed Electron version from a realistic path with spaces.
  const runtime = path.join(root, "Electron Runtime");
  await cp(path.dirname(electron), runtime, { recursive: true });
  const source = await readFile(
    path.join(desktop, "src/main/startup-settings.ts"),
    "utf8"
  );
  await writeFile(
    path.join(fixture, "startup.cjs"),
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText
  );
  const result = path.join(root, "result.json");
  await writeFile(
    path.join(fixture, "main.cjs"),
    `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { app } = require('electron');
const { createStartupSettings } = require('./startup.cjs');
app.setAppUserModelId('OpenMeld.StartupAcceptance.' + process.pid);
app.setPath('userData', ${JSON.stringify(root)});
app.whenReady().then(() => {
  let error;
  try {
    assert.ok(process.execPath.includes(' '));
    const settings = createStartupSettings(app);
    assert.equal(settings.getOpenAtLogin(), false);
    settings.setOpenAtLogin(true);
    assert.equal(settings.getOpenAtLogin(), true);
    // Task Manager can disable a registered entry without deleting it.
    app.setLoginItemSettings({ openAtLogin: true, args: ['--openmeld-login'], enabled: false });
    assert.equal(settings.getOpenAtLogin(), false);
    settings.setOpenAtLogin(true);
    assert.equal(settings.getOpenAtLogin(), true);
    // Upgrade a pre-existing entry that has no login argument.
    app.setLoginItemSettings({ openAtLogin: true, args: [], enabled: true });
    assert.equal(settings.getOpenAtLogin(), true);
    assert.equal(app.getLoginItemSettings({
      path: '"' + process.execPath + '"', args: ['--openmeld-login'],
    }).openAtLogin, false);
    settings.setStartInBackground(true);
    // launchItems.args excludes Chromium switches. openAtLogin compares the full command.
    assert.equal(app.getLoginItemSettings({
      path: '"' + process.execPath + '"', args: ['--openmeld-login'],
    }).openAtLogin, true);
    assert.equal(createStartupSettings(app, 'win32', [process.execPath]).shouldStartInBackground(), false);
    assert.equal(createStartupSettings(app, 'win32', [process.execPath, '--openmeld-login']).shouldStartInBackground(), true);
    settings.setOpenAtLogin(false);
    assert.equal(settings.getOpenAtLogin(), false);
  } catch (caught) { error = String(caught.stack || caught); }
  finally {
    app.setLoginItemSettings({ openAtLogin: false });
    fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ error, electron: process.versions.electron }));
  }
  app.exit(error ? 1 : 0);
});
`
  );
  const env = { ...process.env };
  env.ELECTRON_RUN_AS_NODE = undefined;
  const run = spawnSync(
    path.join(runtime, "electron.exe"),
    [path.join(fixture, "main.cjs")],
    {
      env,
      encoding: "utf8",
      timeout: 60_000,
    }
  );
  assert.ifError(run.error);
  const outcome = JSON.parse(await readFile(result, "utf8"));
  assert.equal(outcome.error, undefined, outcome.error);
  assert.equal(run.status, 0, run.stderr);
  console.log(
    `Native Windows startup settings passed on Electron ${outcome.electron}: spaced path, system-disabled entry, legacy entry, background preference and cleanup.`
  );
} finally {
  await rm(fixture, { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
}
