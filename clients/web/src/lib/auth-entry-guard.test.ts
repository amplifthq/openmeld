import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	getSessionMock,
	getRequiredServerEnvMock,
	redirectMock,
	resolveActiveOrganizationEntryPathMock,
} = vi.hoisted(() => ({
	getSessionMock: vi.fn(),
	getRequiredServerEnvMock: vi.fn(),
	redirectMock: vi.fn(),
	resolveActiveOrganizationEntryPathMock: vi.fn(),
}));

vi.mock("./auth-session", () => ({
	getSession: getSessionMock,
}));

vi.mock("#/env", () => ({
	getRequiredServerEnv: getRequiredServerEnvMock,
}));

vi.mock("@tanstack/react-router", () => ({
	redirect: redirectMock,
}));

vi.mock("./organizations/organization-scope", () => ({
	resolveActiveOrganizationEntryPath: resolveActiveOrganizationEntryPathMock,
}));

import {
	guardAnonymousOnlyRoute,
	resolveAuthenticatedRedirectTarget,
} from "./auth-entry-guard";
import { hasAddAccountAuthIntent } from "./auth-intent";

describe("auth entry guard", () => {
	beforeEach(() => {
		getSessionMock.mockReset();
		getRequiredServerEnvMock.mockReset();
		redirectMock.mockReset();
		resolveActiveOrganizationEntryPathMock.mockReset();

		getRequiredServerEnvMock.mockReturnValue("http://localhost:3000");
		redirectMock.mockImplementation((input: unknown) => input);
		resolveActiveOrganizationEntryPathMock.mockResolvedValue(
			"/o/acme/new-space"
		);
		window.history.replaceState({}, "", "http://localhost:3000/");
	});

	it("leaves anonymous users on anonymous-only routes", async () => {
		getSessionMock.mockResolvedValue(null);

		await expect(
			guardAnonymousOnlyRoute("http://localhost:3000/login")
		).resolves.toBeUndefined();
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("keeps stale cached sessions on the login page when fresh verification is unauthenticated", async () => {
		getSessionMock.mockImplementation(
			async (input: {
				data: {
					currentUserSessionExpectation: "optional" | "required";
					sessionCacheMode?: "allow" | "bypass";
				};
			}) =>
				input.data.sessionCacheMode === "bypass"
					? null
					: {
							user: {
								id: "stale-user",
							},
						}
		);

		await expect(
			guardAnonymousOnlyRoute(
				"http://localhost:3000/login?redirect=%2Fo%2Facme%2Fprojects"
			)
		).resolves.toBeUndefined();
		expect(getSessionMock).toHaveBeenCalledWith({
			data: {
				currentUserSessionExpectation: "optional",
				routeFamily: "/login",
				sessionCacheMode: "bypass",
			},
		});
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("sends authenticated users to the default entry when no explicit redirect exists", async () => {
		getSessionMock.mockResolvedValue({
			user: {
				id: "user-123",
			},
		});

		await expect(
			guardAnonymousOnlyRoute("http://localhost:3000/login")
		).rejects.toMatchObject({
			to: "/o/acme/new-space",
		});
		expect(resolveActiveOrganizationEntryPathMock).toHaveBeenCalledWith({
			data: { routeFamily: "/login" },
		});
	});

	it("allows an authenticated user to add another account", async () => {
		getSessionMock.mockResolvedValue({
			user: {
				id: "user-123",
			},
		});

		await expect(
			guardAnonymousOnlyRoute(
				"http://localhost:3000/login?intent=add-account&redirect=%2F"
			)
		).resolves.toBeUndefined();
		expect(redirectMock).not.toHaveBeenCalled();
	});

	it("requires the exact add-account intent", () => {
		expect(hasAddAccountAuthIntent("/login?intent=add-account")).toBe(true);
		expect(hasAddAccountAuthIntent("/login?intent=add-account-later")).toBe(
			false
		);
	});

	it("preserves an explicit safe deep link redirect for authenticated users", async () => {
		getSessionMock.mockResolvedValue({
			user: {
				id: "user-123",
			},
		});

		await expect(
			guardAnonymousOnlyRoute(
				"http://localhost:3000/login?redirect=http%3A%2F%2Flocalhost%3A3000%2Fo%2Facme%2Fspaces%2Fspace-123"
			)
		).rejects.toMatchObject({
			to: "/o/acme/spaces/space-123",
		});
		expect(resolveActiveOrganizationEntryPathMock).not.toHaveBeenCalled();
	});

	it("uses the browser origin without reading server env for client-side redirects", () => {
		getRequiredServerEnvMock.mockImplementation(() => {
			throw new Error("Server env should not be read in the browser.");
		});

		expect(
			resolveAuthenticatedRedirectTarget(
				"/login?redirect=http%3A%2F%2Flocalhost%3A3000%2Fo%2Facme%2Fdirectory%2Fagents"
			)
		).toBe("/o/acme/directory/agents");
		expect(getRequiredServerEnvMock).not.toHaveBeenCalled();
	});

	it("resolves device authorization redirects without falling back to account", () => {
		expect(
			resolveAuthenticatedRedirectTarget(
				"http://localhost:3000/login?redirect=http%3A%2F%2Flocalhost%3A3000%2Fdevice%3Fuser_code%3DABC123"
			)
		).toBe("/device?user_code=ABC123");
	});

	it("fails closed to the default entry for untrusted redirect targets", () => {
		expect(
			resolveAuthenticatedRedirectTarget(
				"http://localhost:3000/login?redirect=https%3A%2F%2Fevil.example%2Fapp%2Faccount"
			)
		).toBe("/login");
	});

	it("rejects retired app-scope redirects", () => {
		expect(
			resolveAuthenticatedRedirectTarget(
				"http://localhost:3000/login?redirect=http%3A%2F%2Flocalhost%3A3000%2Fapp%2Fspaces%2Fspace-123"
			)
		).toBe("/login");
	});
});
