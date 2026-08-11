import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredAuthSession } from "../src/config/auth-session";
import {
  getActiveAuthOrganization,
  getAuthOrganizationSelection,
  listAuthOrganizations,
} from "../src/org/auth-organization-api";
import {
  createCapturedBetterAuthGetFullOrganizationResponse,
  createCapturedBetterAuthOrganizationListResponse,
  createCapturedBetterAuthSessionResponse,
} from "./fixtures/auth-organizations";

const SESSION: StoredAuthSession = {
  v: 1,
  accessToken: "token-valid",
  tokenType: "Bearer",
  authBaseUrl: "https://auth.openmeld.invalid",
  clientId: "openmeld-cli",
  createdAt: "2026-07-07T00:00:00.000Z",
};

describe("auth organization API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pins Better Auth /organization/get-full-organization as the active organization object", async () => {
    // Real captured GET /api/auth/organization/get-full-organization body
    // (better-auth 1.6.23 organization plugin, default active organization).
    // Values are sanitized; the field layout and nullability are the captured
    // contract. The response is the organization itself, not a data wrapper.
    const realGetFullOrganizationResponse =
      createCapturedBetterAuthGetFullOrganizationResponse({
        id: "5ccb175d-2eef-4e6e-a6f9-b25a1e66d359",
        name: "Test",
        personal: true,
        slug: "test",
      });
    const calls: Array<{ authorization: string | null; pathname: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string" || input instanceof URL
            ? String(input)
            : input.url;
        const headers = new Headers(init?.headers);
        calls.push({
          authorization: headers.get("authorization"),
          pathname: new URL(url).pathname,
        });
        return Promise.resolve(
          new Response(JSON.stringify(realGetFullOrganizationResponse), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          })
        );
      })
    );

    await expect(getActiveAuthOrganization(SESSION)).resolves.toEqual({
      id: "5ccb175d-2eef-4e6e-a6f9-b25a1e66d359",
      slug: "test",
      name: "Test",
      personal: true,
    });
    expect(realGetFullOrganizationResponse).not.toHaveProperty("data");
    expect(realGetFullOrganizationResponse).not.toHaveProperty("organization");
    expect(calls).toEqual([
      {
        authorization: "Bearer token-valid",
        pathname: "/api/auth/organization/get-full-organization",
      },
    ]);
  });

  it("pins Better Auth /organization/get-full-organization as null when no active organization is selected", async () => {
    // Real captured GET /api/auth/organization/get-full-organization body
    // after POST /api/auth/organization/set-active with organizationId null.
    const realNoActiveOrganizationResponse: null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(realNoActiveOrganizationResponse), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          })
        )
      )
    );

    await expect(getActiveAuthOrganization(SESSION)).resolves.toBeNull();
  });

  it("reads OpenMeld's account selection before the older Session active Organization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              createCapturedBetterAuthSessionResponse({
                activeOrganizationId: "org_session",
                lastSelectedOrganizationId: "org_account",
              })
            ),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
              },
            }
          )
        )
      )
    );

    await expect(getAuthOrganizationSelection(SESSION)).resolves.toEqual({
      activeOrganizationId: "org_session",
      lastSelectedOrganizationId: "org_account",
    });
  });

  it("reads the personal organization marker from Better Auth organization list metadata", async () => {
    const betterAuthOrganizationListResponse =
      createCapturedBetterAuthOrganizationListResponse([
        {
          id: "org_personal",
          name: "Test",
          personal: true,
          slug: "test",
        },
        {
          id: "org_team",
          name: "Test Team",
          slug: "test-team",
        },
      ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify(betterAuthOrganizationListResponse), {
            status: 200,
            headers: {
              "content-type": "application/json",
            },
          })
        )
      )
    );

    await expect(listAuthOrganizations(SESSION)).resolves.toEqual([
      {
        id: "org_personal",
        slug: "test",
        name: "Test",
        personal: true,
      },
      {
        id: "org_team",
        slug: "test-team",
        name: "Test Team",
      },
    ]);
  });
});
