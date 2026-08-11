import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock, openMeldAuthClientMock } = vi.hoisted(() => ({
	requestJsonMock: vi.fn(),
	openMeldAuthClientMock: {
		getSession: vi.fn(),
	},
}));

vi.mock("#/lib/auth-client", () => ({
	openMeldAuthClient: openMeldAuthClientMock,
}));

vi.mock("#/lib/openmeld-api/client", () => ({
	createWebOpenMeldApiFoundation: () => ({
		requestJson: requestJsonMock,
	}),
}));

import {
	generateOneTimeToken,
	getAccountAvatar,
	getSession,
	removeAccountAvatar,
	updateAccountAvatar,
	updateUserName,
} from "./auth-query";

describe("auth-query", () => {
	beforeEach(() => {
		openMeldAuthClientMock.getSession.mockReset();
		requestJsonMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("preserves plain-object SDK responses when reading the session", async () => {
		const session = {
			session: { id: "session-1" },
			user: { id: "user-1", email: "mira@example.com" },
		};
		openMeldAuthClientMock.getSession.mockResolvedValue(session);

		await expect(getSession()).resolves.toEqual(session);
		expect(openMeldAuthClientMock.getSession).toHaveBeenCalledWith({
			query: { disableCookieCache: true },
		});
	});

	it("returns null when the SDK rejects with an unauthorized session error", async () => {
		openMeldAuthClientMock.getSession.mockRejectedValue({
			message: "Unauthorized",
			status: 401,
			statusText: "Unauthorized",
		});

		await expect(getSession()).resolves.toBeNull();
	});

	it("rethrows rejected non-401 session errors", async () => {
		openMeldAuthClientMock.getSession.mockRejectedValue({
			message: "Backend blew up",
			status: 500,
			statusText: "Internal Server Error",
		});

		await expect(getSession()).rejects.toThrow("Backend blew up");
	});

	it("updates the Account Display Name through the paired OpenMeld contract", async () => {
		const result = {
			defaultHumanProfile: {
				profileName: "Felix Lu",
			},
			displayName: "Felix Lu",
			ok: true,
		};
		requestJsonMock.mockResolvedValue(result);

		await expect(updateUserName(" Felix Lu ")).resolves.toBe(result);

		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				body: JSON.stringify({ displayName: "Felix Lu" }),
				method: "PATCH",
				operation: "account.displayName.update",
				url: "/v1/account/display-name",
			})
		);
	});

	it("updates and removes the Account avatar through the shared contract", async () => {
		const updated = {
			avatar: "https://gateway.example/v1/profile-avatars/profile/avatar.webp",
			defaultHumanProfileId: "profile",
			ok: true,
		};
		requestJsonMock.mockResolvedValueOnce(updated).mockResolvedValueOnce({
			avatar: null,
			defaultHumanProfileId: "profile",
			ok: true,
		});

		await expect(
			updateAccountAvatar({
				bytes: new Blob([new Uint8Array([1, 2, 3])]),
				mimeType: "image/png",
			})
		).resolves.toBe(updated);
		expect(requestJsonMock).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({
				headers: { "content-type": "image/png" },
				method: "PUT",
				operation: "account.avatar.update",
				url: "/v1/account/avatar",
			})
		);

		await expect(removeAccountAvatar()).resolves.toMatchObject({
			avatar: null,
			ok: true,
		});
		expect(requestJsonMock).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({
				method: "DELETE",
				operation: "account.avatar.remove",
				url: "/v1/account/avatar",
			})
		);
	});

	it("reads the canonical Account avatar through the shared contract", async () => {
		const canonicalAvatar = {
			avatar: null,
			defaultHumanProfileId: "profile",
			ok: true,
		};
		requestJsonMock.mockResolvedValue(canonicalAvatar);

		await expect(getAccountAvatar()).resolves.toBe(canonicalAvatar);
		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				operation: "account.avatar.read",
				url: "/v1/account/avatar",
			})
		);
	});

	it("generates one-time tokens from a fresh server-side session", async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			new Response(JSON.stringify({ token: "ott_demo", expiresIn: 180 }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(generateOneTimeToken()).resolves.toEqual({
			token: "ott_demo",
			expiresIn: 180,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/one-time-token/generate?disableCookieCache=true",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			})
		);
	});
});
