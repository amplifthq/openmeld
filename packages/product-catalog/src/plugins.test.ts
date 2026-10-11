import { connectorAppCatalogProviderSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import capturedExpansionProviders from "../test-support/openconnector-expansion-providers.json";
import capturedProviders from "../test-support/openconnector-providers.json";
import {
  findPluginDefinition,
  pluginFromProvider,
  pluginsForCatalog,
} from "./plugins";

const LOCAL_BRAND_MARK = /^\/app-logos\/.+\.(?:svg|png)$/;

// Captured from OpenConnector runtimes on 2026-10-09 and 2026-10-10.
// connectionAuth.oauth is readiness; authTypes declares OAuth support.
describe("Plugin sign-in readiness", () => {
  it("limits browsing to selected, ready providers and preserves existing account management", () => {
    const parse = (service: string) =>
      connectorAppCatalogProviderSchema
        .strip()
        .parse(
          [...capturedProviders.data, ...capturedExpansionProviders.data].find(
            (item) => item.service === service
          )
        );
    const teams = {
      ...parse("microsoft_teams"),
      connectionAuth: { oauth: false, credentials: [] },
    };
    const s3 = parse("aws_s3");
    const unfeatured = {
      ...s3,
      service: "17track",
      displayName: "17TRACK",
      iconUrl: null,
    };
    const providers = [unfeatured, teams, s3];
    expect(
      pluginsForCatalog(providers).map((plugin) => plugin.service)
    ).toEqual(["aws_s3"]);
    expect(
      pluginsForCatalog(providers, new Set(["microsoft_teams", "17track"])).map(
        (plugin) => plugin.service
      )
    ).toEqual(["aws_s3", "microsoft_teams", "17track"]);
    expect(pluginsForCatalog([{ ...s3, connectionAuth: undefined }])).toEqual(
      []
    );
    expect(pluginsForCatalog([])).toEqual([]);
    const readyTeams = {
      ...teams,
      connectionAuth: { oauth: true, credentials: [] },
    };
    expect(pluginsForCatalog([readyTeams])[0]?.service).toBe("microsoft_teams");
    const slack = parse("slack");
    expect(pluginsForCatalog([slack])[0]?.service).toBe("slack");
  });
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
