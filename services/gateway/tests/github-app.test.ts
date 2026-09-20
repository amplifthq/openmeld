import { GITHUB_APP_WEBHOOK_RAW_BODY_MAX_BYTES } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../src/index";

const STATE = `githubapp_${"a".repeat(64)}`;
const TEST_EXECUTION_CONTEXT = {
  exports: {},
  passThroughOnException: () => undefined,
  props: {},
  waitUntil: () => undefined,
} as unknown as ExecutionContext;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("GitHub App setup callback", () => {
  it("turns the one-time setup state into installer OAuth verification", async () => {
    const beginGitHubAppInstallationVerification = vi.fn(async () => ({
      actorProfileId: "profile-1",
      installationId: "987654",
      organizationId: "org-1",
      status: "valid" as const,
      targetConnectionName: "org_target_shared_github",
      userId: "user-1",
      verificationConnectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
    }));
    const fetchMock = vi.fn(async () =>
      Response.json({
        authorizationUrl:
          "https://github.com/login/oauth/authorize?client_id=github-app-client",
        state: "openconnector-state",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        `https://gateway.test/github/app/setup?installation_id=987654&setup_action=install&state=${STATE}`
      ),
      makeEnv({ beginGitHubAppInstallationVerification }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://github.com/login/oauth/authorize?client_id=github-app-client"
    );
    expect(beginGitHubAppInstallationVerification).toHaveBeenCalledWith({
      installationId: "987654",
      state: STATE,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connectors.example.test/api/oauth/authorizations",
      expect.objectContaining({
        body: JSON.stringify({
          connectionName: "github_verify_aaaaaaaaaaaaaaaaaaaaaaaa",
          service: "github",
        }),
        method: "POST",
      })
    );
  });

  it("does not start OAuth for a reused installation state", async () => {
    const beginGitHubAppInstallationVerification = vi.fn(async () => ({
      status: "invalid" as const,
    }));
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.fetch(
      new Request(
        `https://gateway.test/github/app/setup?installation_id=987654&state=${STATE}`
      ),
      makeEnv({ beginGitHubAppInstallationVerification }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("invalid or has already been used");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a callback without a valid GitHub installation id before Core", async () => {
    const beginGitHubAppInstallationVerification = vi.fn();

    const response = await app.fetch(
      new Request(
        `https://gateway.test/github/app/setup?installation_id=not-an-id&state=${STATE}`
      ),
      makeEnv({ beginGitHubAppInstallationVerification }),
      TEST_EXECUTION_CONTEXT
    );

    expect(response.status).toBe(400);
    expect(beginGitHubAppInstallationVerification).not.toHaveBeenCalled();
  });
});

describe("GitHub App webhook", () => {
  it("acks verified ping and issue deliveries, rejects bad signatures, and fails closed on Core errors", async () => {
    const verifyGitHubAppWebhook = vi.fn(async () => ({
      reasonCode: null,
      status: "accepted" as const,
    }));
    const ping = await app.fetch(
      new Request("https://gateway.test/github/app/webhook", {
        body: '{"zen":"Design for failure."}',
        headers: {
          "content-type": "application/json",
          "x-github-delivery": "delivery-ping",
          "x-github-event": "ping",
          "x-hub-signature-256": "sha256=test",
        },
        method: "POST",
      }),
      makeEnv({ verifyGitHubAppWebhook }),
      TEST_EXECUTION_CONTEXT
    );
    expect(ping.status).toBe(200);
    expect(await ping.text()).toBe("OK");
    expect(verifyGitHubAppWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          deliveryId: "delivery-ping",
          event: "ping",
          signature256: "sha256=test",
        },
        rawBody: '{"zen":"Design for failure."}',
      })
    );

    verifyGitHubAppWebhook.mockResolvedValueOnce({
      reasonCode: "github.webhook_signature_invalid",
      status: "rejected",
    });
    const rejected = await app.fetch(
      new Request("https://gateway.test/github/app/webhook", {
        body: "{}",
        method: "POST",
      }),
      makeEnv({ verifyGitHubAppWebhook }),
      TEST_EXECUTION_CONTEXT
    );
    expect(rejected.status).toBe(401);

    verifyGitHubAppWebhook.mockResolvedValueOnce({
      reasonCode: "github.webhook_queue_unavailable",
      status: "rejected",
    });
    const unavailable = await app.fetch(
      new Request("https://gateway.test/github/app/webhook", {
        body: "{}",
        method: "POST",
      }),
      makeEnv({ verifyGitHubAppWebhook }),
      TEST_EXECUTION_CONTEXT
    );
    expect(unavailable.status).toBe(503);

    verifyGitHubAppWebhook.mockRejectedValueOnce(new Error("core down"));
    const failed = await app.fetch(
      new Request("https://gateway.test/github/app/webhook", {
        body: "{}",
        method: "POST",
      }),
      makeEnv({ verifyGitHubAppWebhook }),
      TEST_EXECUTION_CONTEXT
    );
    expect(failed.status).toBe(503);
    expect(await failed.text()).toBe("Provider verification unavailable");
  });

  it("rejects an oversized GitHub webhook body before Core", async () => {
    const verifyGitHubAppWebhook = vi.fn();
    const response = await app.fetch(
      new Request("https://gateway.test/github/app/webhook", {
        body: "x".repeat(GITHUB_APP_WEBHOOK_RAW_BODY_MAX_BYTES + 1),
        method: "POST",
      }),
      makeEnv({ verifyGitHubAppWebhook }),
      TEST_EXECUTION_CONTEXT
    );
    expect(response.status).toBe(413);
    expect(verifyGitHubAppWebhook).not.toHaveBeenCalled();
  });
});

function makeEnv(coreOverrides: Record<string, unknown>): CloudflareBindings {
  return {
    OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN: "test-admin-token",
    OPENMELD_AUTH_WORKER: {
      resolveRequestAuthWithProfile: vi.fn(async () => ({
        claims: {
          activeOrganizationId: "org-1",
          authMethod: "session",
          authenticated: true,
          ownerIds: ["user-1"],
          requestId: "req-github-app",
        },
        ok: true,
        profile: {
          ok: true,
          resolvedProfile: {
            ownerUserId: "user-1",
            profileKind: "human",
            profileName: "Mira",
            openMeldProfileId: "11111111-1111-4111-8111-111111111111",
          },
        },
      })),
    },
    OPENMELD_CONNECTORS_BASE_URL: "https://connectors.example.test",
    OPENMELD_CORE_WORKER: coreOverrides,
  } as unknown as CloudflareBindings;
}
