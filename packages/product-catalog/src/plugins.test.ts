import { connectorAppCatalogProviderSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import capturedExpansionProviders from "../test-support/openconnector-expansion-providers.json";
import capturedProviders from "../test-support/openconnector-providers.json";
import { findPluginDefinition, pluginFromProvider } from "./plugins";

const LOCAL_BRAND_MARK = /^\/app-logos\/.+\.(?:svg|png)$/;

// Captured from OpenConnector runtimes on 2026-10-09 and 2026-10-10.
// connectionAuth.oauth is readiness; authTypes declares OAuth support.
describe("Plugin sign-in readiness", () => {
  it.each(
    capturedExpansionProviders.data
  )("uses the real connection contract for $service", (captured) => {
    const provider = connectorAppCatalogProviderSchema.strip().parse(captured);
    const plugin = pluginFromProvider(provider);
    expect(findPluginDefinition(provider.service)).not.toBeNull();
    expect(plugin.logoPath).toMatch(LOCAL_BRAND_MARK);
    if (provider.authTypes.includes("oauth2")) {
      expect(plugin.connection?.auth).toMatchObject({
        kind: "oauth",
        configured: provider.connectionAuth?.oauth,
      });
      const fallback = provider.connectionAuth?.credentials[0];
      if (fallback) {
        expect(plugin.connection?.auth).toMatchObject({
          credentialFallback: { kind: "credential", ...fallback },
        });
      }
    } else {
      expect(plugin.connection?.auth).toEqual({
        kind: "credential",
        ...provider.connectionAuth?.credentials[0],
      });
    }
    expect(plugin.connection?.credentials).toEqual(
      provider.connectionAuth?.credentials.map((option) => ({
        kind: "credential",
        ...option,
      }))
    );
  });
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
