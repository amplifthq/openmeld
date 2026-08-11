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
