import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// Use the installed deployment tool's runtime, not a hand-written RPC mock.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { Miniflare } = await import(
  pathToFileURL(wranglerRequire.resolve("miniflare")).href
);
const coreRequire = createRequire(
  new URL("../../core/package.json", import.meta.url)
);
const { build } = coreRequire("esbuild");
const buildRoot = fileURLToPath(
  new URL("../dist/openmeld_remote_agent/", import.meta.url)
);
const resolverPath = fileURLToPath(
  new URL(
    "../../core/src/remote-agent/application/remote-agent-worker-admission.ts",
    import.meta.url
  )
);

test("the real Core resolver negotiates through the built Remote service binding", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "openmeld-capability-rpc-")
  );
  let runtime = null;
  try {
    const config = JSON.parse(
      await readFile(path.join(buildRoot, "wrangler.json"), "utf8")
    );
    const caller = path.join(directory, "caller.mjs");
    await build({
      stdin: {
        contents: `
        import { resolveRemoteAgentWorkerTaskAttribution } from ${JSON.stringify(resolverPath)};
        export default { async fetch(request, env) {
          try {
            const invalid = new URL(request.url).pathname === "/invalid";
            if (new URL(request.url).pathname === "/approval-recovery") {
              return Response.json(await env.REMOTE.readSubmitTurnCapabilities({
                v: 1, includePluginActionRecovery: true,
              }));
            }
            if (new URL(request.url).pathname === "/legacy-capabilities") {
              return Response.json(await env.REMOTE.readSubmitTurnCapabilities({ v: 1 }));
            }
            const result = invalid
              ? await env.REMOTE.readSubmitTurnCapabilities({ v: 1, unexpected: true })
              : await resolveRemoteAgentWorkerTaskAttribution(env.REMOTE, "task-rpc");
            return Response.json(result);
          } catch (error) { return Response.json({ error: error.message }, { status: 500 }); }
        }};
      `,
        resolveDir: path.dirname(resolverPath),
        loader: "ts",
      },
      bundle: true,
      format: "esm",
      platform: "neutral",
      target: "es2022",
      // Match Workers' native Node module resolution for Core's pg dependency.
      alias: Object.fromEntries(
        builtinModules
          .filter((name) => !name.startsWith("node:"))
          .map((name) => [name, `node:${name}`])
      ),
      banner: {
        // This in-memory module has no import.meta.url; require resolves builtins.
        js: 'import { createRequire as createWorkerRequire } from "node:module"; const require = createWorkerRequire("/caller.mjs");',
      },
      external: ["cloudflare:*", "node:*"],
      outfile: caller,
    });
    const files = (await readdir(buildRoot, { recursive: true })).filter(
      (file) => file.endsWith(".js")
    );
    const modules = Object.fromEntries(
      await Promise.all(
        files.map(async (file) => [
          file,
          {
            type: "esm",
            contents: await readFile(path.join(buildRoot, file), "utf8"),
          },
        ])
      )
    );
    runtime = new Miniflare({
      workers: [
        {
          config: {
            name: "caller",
            manifest: {
              mainModule: "caller.mjs",
              modules: {
                "caller.mjs": {
                  type: "esm",
                  contents: await readFile(caller, "utf8"),
                },
              },
            },
            compatibilityDate: config.compatibility_date,
            compatibilityFlags: config.compatibility_flags,
            env: { REMOTE: { type: "worker", worker: "remote" } },
          },
        },
        {
          config: {
            name: "remote",
            manifest: {
              mainModule: config.main,
              modulesRoot: buildRoot,
              modules,
            },
            compatibilityDate: config.compatibility_date,
            compatibilityFlags: config.compatibility_flags,
          },
        },
      ],
    });
    const response = await runtime.dispatchFetch("https://caller.example/");
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.deepEqual(result, { taskId: "task-rpc" });
    assert.deepEqual(
      await (
        await runtime.dispatchFetch(
          "https://caller.example/legacy-capabilities"
        )
      ).json(),
      { v: 1, taskId: true }
    );
    assert.deepEqual(
      await (
        await runtime.dispatchFetch("https://caller.example/approval-recovery")
      ).json(),
      { v: 1, taskId: true, pluginActionRecovery: true }
    );
    const invalid = await runtime.dispatchFetch(
      "https://caller.example/invalid"
    );
    assert.equal(invalid.status, 500);
    // workerd serializes the custom validation error by its name.
    assert.equal((await invalid.json()).error, "ZodError");
  } finally {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  }
});
