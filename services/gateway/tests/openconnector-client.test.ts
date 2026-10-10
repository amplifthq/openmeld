import { describe, expect, it, vi } from "vitest";
import capturedProviders from "../../../packages/product-catalog/test-support/openconnector-providers.json";
import {
  OpenConnectorClient,
  OpenConnectorClientError,
} from "../src/lib/openconnector-client";

describe("OpenConnectorClient", () => {
  it("reads the live runtime provider catalog", async () => {
    const fetchMock = vi.fn(async () => Response.json(capturedProviders));
    const client = new OpenConnectorClient({
      adminToken: "admin-token",
      baseUrl: "https://connectors.example.test",
      fetch: fetchMock,
      runtimeToken: "runtime-token",
    });

    await expect(client.listProviders()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: "GitHub", service: "github" }),
      ])
    );
    expect(
      (await client.listProviders()).some((provider) => "scenario" in provider)
    ).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/v1/providers?includeConnectionAuth=true",
      expect.objectContaining({
        method: "GET",
        headers: { authorization: "Bearer runtime-token" },
      })
    );
  });

  it("completes a GitHub App installation through the dedicated admin endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        configured: true,
        connectionName: "org_target_shared_github",
        service: "github",
      })
    );
    const client = new OpenConnectorClient({
      adminToken: "admin-token",
      baseUrl: "https://connectors.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.completeGitHubAppInstallation({
        installationId: "987654",
        targetConnectionName: "org_target_shared_github",
        verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
      })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/api/providers/github/installations",
      expect.objectContaining({
        body: JSON.stringify({
          installationId: "987654",
          targetConnectionName: "org_target_shared_github",
          verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
        }),
        method: "POST",
      })
    );
  });

  it("preserves the provider-safe error message returned by OpenConnector", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          error: {
            code: "credential_verification_failed",
            message:
              "The provider rejected this credential during verification.",
          },
        },
        { status: 400 }
      )
    );
    const client = new OpenConnectorClient({
      adminToken: "admin-token",
      baseUrl: "https://connectors.example.test",
      fetch: fetchMock,
    });

    await expect(
      client.configureConnection({
        authType: "api_key",
        connectionName: "connection",
        service: "posthog",
        values: { apiKey: "provider-secret" },
      })
    ).rejects.toEqual(
      new OpenConnectorClientError(
        "The provider rejected this credential during verification.",
        502
      )
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses a stable fallback when OpenConnector does not return its error envelope", async () => {
    const client = new OpenConnectorClient({
      adminToken: "admin-token",
      baseUrl: "https://connectors.example.test",
      fetch: vi.fn(async () => new Response("bad gateway", { status: 502 })),
    });

    await expect(
      client.configureConnection({
        authType: "api_key",
        connectionName: "connection",
        service: "posthog",
        values: { apiKey: "provider-secret" },
      })
    ).rejects.toEqual(
      new OpenConnectorClientError(
        "OpenConnector request failed with status 502.",
        502
      )
    );
  });
});
