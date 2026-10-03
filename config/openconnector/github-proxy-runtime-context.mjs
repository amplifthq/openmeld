import { AsyncLocalStorage } from "node:async_hooks";

// The reviewed upstream ProxyRunner omits runtimeConfig from its public
// provider context, unlike ActionRunner. Supply only GitHub App configuration
// through the public executor registry, scoped to this request's Worker env.
// Remove this adapter when the upstream proxy owns that propagation.
export function withGitHubProxyRuntimeContext(upstream, executorModules) {
  const requestConfig = new AsyncLocalStorage();
  const loadGitHub = executorModules.github;
  if (typeof loadGitHub !== "function") {
    throw new Error("The reviewed GitHub executor is unavailable.");
  }
  executorModules.github = async () => {
    const module = await loadGitHub();
    if (typeof module.proxy !== "function") {
      throw new Error("The reviewed GitHub proxy is unavailable.");
    }
    return {
      ...module,
      proxy: (input, context) =>
        module.proxy(input, {
          ...context,
          runtimeConfig: context.runtimeConfig ?? requestConfig.getStore(),
        }),
    };
  };
  return {
    ...upstream,
    fetch(request, env, context) {
      const runtimeConfig = (name) => {
        if (name === "OOMOL_CONNECT_GITHUB_APP_ID") {
          return env.OOMOL_CONNECT_GITHUB_APP_ID;
        }
        if (name === "OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY") {
          return env.OOMOL_CONNECT_GITHUB_APP_PRIVATE_KEY;
        }
        return undefined;
      };
      return requestConfig.run(runtimeConfig, () =>
        upstream.fetch(request, env, context)
      );
    },
  };
}
