import { connectorAppCatalogProviderSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import capturedProviders from "../test-support/openconnector-providers.json";
import { pluginFromProvider } from "./plugins";

// Captured from the pinned OpenConnector runtime on 2026-10-09. The runtime's
// connectionAuth.oauth is readiness; authTypes declares OAuth support.
describe("Plugin sign-in readiness", () => {
  it.each([
    "slack",
    "lark",
    "feishu",
  ])("keeps %s discoverable without claiming OAuth is ready", (service) => {
    const provider = connectorAppCatalogProviderSchema
      .strip()
      .parse(capturedProviders.data.find((item) => item.service === service));
    const plugin = pluginFromProvider(provider);
    expect(plugin.availability).toBe("available");
    expect(plugin.connection?.auth).toMatchObject({
      kind: "oauth",
      configured: false,
    });
    expect(
      pluginFromProvider({
        ...provider,
        connectionAuth: {
          ...provider.connectionAuth,
          credentials: provider.connectionAuth?.credentials ?? [],
          oauth: true,
        },
      }).connection?.auth
    ).toMatchObject({ kind: "oauth", configured: true });
  });
});
