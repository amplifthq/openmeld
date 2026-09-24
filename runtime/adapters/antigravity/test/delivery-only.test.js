import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { invokeAntigravityCliTransport } from "../dist/transport/antigravity-cli-transport.js";
import { assertAntigravityDeliveryConfiguration } from "../dist/transport/antigravity-delivery-only.js";

test(
  "correction rejects ambient global, inherited-workspace and settings hooks without executing them",
  {},
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "antigravity-scope-config-"));
    t.after(() => rm(home, { recursive: true, force: true }));
    const workdir = join(home, "project", "child");
    await mkdir(workdir, { recursive: true });
    const root = join(home, ".gemini/config");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "mcp_config.json"), '{"mcpServers":{}}');
    await assertAntigravityDeliveryConfiguration(home, workdir);
    for (const path of [
      join(root, "hooks.json"),
      join(home, "project/.agents/hooks.json"),
      join(home, ".gemini/antigravity-cli/settings.json"),
    ]) {
      const directory = dirname(path);
      await mkdir(directory, { recursive: true });
      await writeFile(
        path,
        JSON.stringify({ hooks: { configured: { command: "never-execute" } } })
      );
      await assert.rejects(
        assertAntigravityDeliveryConfiguration(home, workdir),
        { code: "space.action.delivery_only_unverified" }
      );
      await rm(path);
    }
  }
);

test("Antigravity cannot use structured output as permission to rerun business work", async () => {
  for (const agentControllerPermissionMode of [
    "antigravity:default",
    "antigravity:plan",
    "antigravity:bypassPermissions",
  ]) {
    const request = Object.freeze({
      agentControllerPermissionMode,
      timeoutMs: 1000,
      workdir: "/must-not-access",
      env: Object.freeze({ OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" }),
      launchContract: { kind: "executable", commandPath: "/must-not-execute" },
      jsonSchema: JSON.stringify({ type: "object" }),
      prompt: "Deliver the existing result only",
      sessionId: "canonical-session",
      onProcessControlEvent() {
        assert.fail("No controller may be started");
      },
    });
    await assert.rejects(invokeAntigravityCliTransport(request), {
      code: "space.action.delivery_only_unsupported",
    });
    assert.equal(
      request.agentControllerPermissionMode,
      agentControllerPermissionMode
    );
    assert.equal(request.sessionId, "canonical-session");
  }
});
