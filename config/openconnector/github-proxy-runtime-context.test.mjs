import assert from "node:assert/strict";
import { it } from "node:test";
import { withGitHubProxyRuntimeContext } from "./github-proxy-runtime-context.mjs";

it("supplies GitHub proxy configuration without crossing concurrent requests or changing actions", async () => {
  const action = async () => "original action";
  const module = {
    executors: { action },
    async proxy(_input, context) {
      await Promise.resolve();
      return {
        app: context.runtimeConfig?.("OOMOL_CONNECT_GITHUB_APP_ID"),
        keyMatchesRequest:
          context.runtimeConfig?.("OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY") ===
          context.expectedKey,
        unrelatedSecret: context.runtimeConfig?.("UNRELATED_SECRET"),
        connectionName: context.connectionName,
      };
    },
  };
  const registry = { github: async () => module };
  const upstream = {
    async fetch(request, env) {
      const github = await registry.github();
      assert.equal(github.executors.action, action);
      const result = await github.proxy(
        {},
        {
          expectedKey: env.OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY,
          connectionName: new URL(request.url).pathname,
        }
      );
      return Response.json(result);
    },
  };
  const worker = withGitHubProxyRuntimeContext(upstream, registry);
  const results = await Promise.all(
    ["first", "second"].map(async (id) => {
      const response = await worker.fetch(
        new Request(`https://connector.test/${id}`),
        {
          OOMOL_CONNECT_GITHUB_APP_ID: id,
          OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY: `synthetic-${id}`,
          UNRELATED_SECRET: "must not reach the provider",
        }
      );
      return response.json();
    })
  );
  assert.deepEqual(
    results,
    ["first", "second"].map((id) => ({
      app: id,
      keyMatchesRequest: true,
      connectionName: `/${id}`,
    }))
  );
  const outsideRequest = await (await registry.github()).proxy({}, {});
  assert.equal(outsideRequest.app, undefined);
});
