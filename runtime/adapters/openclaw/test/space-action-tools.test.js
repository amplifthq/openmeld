import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { withOpenClawDispatchSpaceActionPlugin } from "../dist/transport/openclaw-space-action-plugin-config.js";
import { buildOpenClawSpaceActionPluginSource } from "../dist/transport/openclaw-space-action-plugin-source.js";
import {
  capability,
  writeSpaceToolFixture,
} from "./fixtures/space-tool-fixture.js";

function environment(home, command) {
  return {
    HOME: home,
    OPENCLAW_CONFIG_PATH: join(home, "openclaw.json"),
    OPENMELD_OPENCLAW_TOOL_SESSION_ID: "current-session",
    OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(home, "context.json"),
    OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: command,
    OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
  };
}

test("OpenClaw gets current schemas in a temporary config without changing user configuration", async () => {
  const home = await mkdtemp(join(tmpdir(), "openclaw-action-config-"));
  const { command } = await writeSpaceToolFixture(home);
  const env = environment(home, command);
  const original = '{"tools":{"profile":"minimal"}}\n';
  await writeFile(env.OPENCLAW_CONFIG_PATH, original);
  let temporaryConfigPath;
  try {
    await withOpenClawDispatchSpaceActionPlugin({
      env,
      spaceActionTools: capability(),
      run: async (input) => {
        assert.equal(input.active, true);
        temporaryConfigPath = input.env.OPENCLAW_CONFIG_PATH;
        const config = JSON.parse(await readFile(temporaryConfigPath, "utf8"));
        assert.equal(
          config.$include,
          `./${basename(env.OPENCLAW_CONFIG_PATH)}`
        );
        assert.deepEqual(config.plugins.allow, ["openmeld-space-action"]);
        assert.equal(Object.hasOwn(config.plugins, "enabled"), false);
        assert.equal(
          config.plugins.entries["openmeld-space-action"].enabled,
          true
        );
      },
    });
    await assert.rejects(stat(temporaryConfigPath), { code: "ENOENT" });
    assert.equal(await readFile(env.OPENCLAW_CONFIG_PATH, "utf8"), original);
    await assert.rejects(
      withOpenClawDispatchSpaceActionPlugin({
        env,
        run: () => {
          throw new Error("Must not run");
        },
      }),
      { code: "space.action.delivery_only_unverified" }
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

for (const scenario of ["normal", "delivery-only", "lost-receipt"]) {
  test(`OpenClaw forwards common receipts and fences native calls: ${scenario}`, async () => {
    const home = await mkdtemp(join(tmpdir(), "openclaw-action-tool-"));
    const deliveryOnly = scenario !== "normal";
    const { command, capture, definitions } = await writeSpaceToolFixture(
      home,
      deliveryOnly
    );
    const pluginPath = join(home, "plugin.mjs");
    await writeFile(
      pluginPath,
      buildOpenClawSpaceActionPluginSource(definitions, deliveryOnly)
    );
    const previous = { ...process.env };
    Object.assign(process.env, environment(home, command));
    const hooks = new Map();
    let factory;
    const config = {
      tools: {
        allow: ["exec", "openmeld_space_reply", "openmeld_space_read_receipt"],
        deny: ["openmeld_space_stay_silent"],
        byProvider: { fixture: { deny: ["openmeld_space_reply"] } },
      },
    };
    try {
      const { default: plugin } = await import(pathToFileURL(pluginPath).href);
      plugin.register({
        config,
        on: (name, callback) => hooks.set(name, callback),
        registerTool: (value) => {
          factory = value;
        },
      });
      assert.deepEqual(config.tools.deny, ["openmeld_space_stay_silent"]);
      assert.deepEqual(config.tools.byProvider.fixture.deny, [
        "openmeld_space_reply",
      ]);
      if (deliveryOnly) {
        assert.deepEqual(config.tools.allow, [
          "openmeld_space_reply",
          "openmeld_space_read_receipt",
        ]);
      }
      assert.deepEqual(factory({ sessionId: "foreign-session" }), []);
      const tools = factory({ sessionId: "current-session" });
      assert.deepEqual(
        tools.map((tool) => tool.name),
        definitions.map((tool) => `openmeld_space_${tool.name}`)
      );
      const call = (name, args = {}) =>
        tools
          .find((tool) => tool.name === `openmeld_space_${name}`)
          .execute("call", args);
      if (scenario === "lost-receipt") {
        assert.equal(
          (await call("reply", { message: "lose the receipt" })).isError,
          true
        );
        const before = await readFile(capture, "utf8");
        assert.equal(
          (await call("reply", { message: "must not replay" })).isError,
          true
        );
        assert.equal(await readFile(capture, "utf8"), before);
        const reconciled = await call("read_receipt");
        assert.equal(
          reconciled.structuredContent.receipt.message,
          "lose the receipt"
        );
      } else {
        const rejected = await call("reply", {});
        assert.equal(rejected.isError, true);
        assert.equal(
          rejected.structuredContent.receipt.status,
          "rejected_before_recording"
        );
        const saved = await call("reply", {
          message: 'A complete answer with "quotes", spaces and 中文.',
        });
        assert.equal(
          saved.structuredContent.receipt.status,
          "proposal_saved_locally"
        );
        assert.equal(
          saved.structuredContent.receipt.publication,
          "unconfirmed"
        );
        assert.deepEqual(
          (await call("read_receipt")).structuredContent.receipt,
          saved.structuredContent.receipt
        );
        if (!deliveryOnly) {
          const result = await call("read_history");
          assert.equal(
            result.structuredContent.result.text,
            `complete-${"😀".repeat(10_000)}-end`
          );
          const page = await call("read_result");
          assert.deepEqual(page.structuredContent, result.structuredContent);
        }
        const starts = (await readFile(capture, "utf8"))
          .trim()
          .split("\n")
          .map(JSON.parse)
          .filter((entry) => entry.started);
        assert.equal(starts.length, 1);
        assert.deepEqual(starts[0].argv, ["space", "action", "tool-server"]);
      }
      if (deliveryOnly) {
        assert.equal(
          hooks.get("before_tool_call")(
            { toolName: "exec" },
            { sessionId: "current-session" }
          ).block,
          true
        );
      }
      hooks.get("agent_end")({}, { sessionId: "current-session" });
      const before = await readFile(capture, "utf8");
      assert.equal((await call("reply", { message: "late" })).isError, true);
      assert.equal(await readFile(capture, "utf8"), before);
    } finally {
      hooks.get("agent_end")?.({}, { sessionId: "current-session" });
      for (const key of Object.keys(process.env)) {
        if (!(key in previous)) {
          delete process.env[key];
        }
      }
      Object.assign(process.env, previous);
      await rm(home, { recursive: true, force: true });
    }
  });
}
