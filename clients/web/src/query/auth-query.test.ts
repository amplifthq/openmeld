import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requestJsonMock, openMeldAuthClientMock } = vi.hoisted(() => ({
	requestJsonMock: vi.fn(),
	openMeldAuthClientMock: {
		multiSession: {
			listDeviceSessions: vi.fn(),
			revoke: vi.fn(),
			setActive: vi.fn(),
		},
	},
}));

vi.mock("#/lib/auth-client", () => ({
	openMeldAuthClient: openMeldAuthClientMock,
}));

vi.mock("#/lib/openmeld-api/client", () => ({
	createUnscopedWebOpenMeldApiFoundation: () => ({
		requestJson: requestJsonMock,
	}),
}));

import {
	createComputerAuthorizationGrant,
	generateOneTimeToken,
	getAccountAvatar,
	listDeviceSessions,
	removeAccountAvatar,
	revokeDeviceSession,
	setActiveDeviceSession,
	updateAccountAvatar,
	updateUserName,
} from "./auth-query";

describe("auth-query", () => {
	beforeEach(() => {
		openMeldAuthClientMock.multiSession.listDeviceSessions.mockReset();
		openMeldAuthClientMock.multiSession.revoke.mockReset();
		openMeldAuthClientMock.multiSession.setActive.mockReset();
		requestJsonMock.mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("lists, switches, and revokes browser account sessions", async () => {
		const deviceSessions = [
			{
				session: { token: "session-a", userId: "user-a" },
				user: {
					email: "a@example.com",
					id: "user-a",
					name: "Account A",
				},
			},
		];
		openMeldAuthClientMock.multiSession.listDeviceSessions.mockResolvedValue({
			data: deviceSessions,
			error: null,
		});
		openMeldAuthClientMock.multiSession.setActive.mockResolvedValue({
			data: {},
			error: null,
		});
		openMeldAuthClientMock.multiSession.revoke.mockResolvedValue({
			data: { status: true },
			error: null,
		});

		await expect(listDeviceSessions()).resolves.toEqual(deviceSessions);
		await expect(setActiveDeviceSession("session-a")).resolves.toBeUndefined();
		await expect(revokeDeviceSession("session-a")).resolves.toBeUndefined();

		expect(openMeldAuthClientMock.multiSession.setActive).toHaveBeenCalledWith({
			sessionToken: "session-a",
		});
		expect(openMeldAuthClientMock.multiSession.revoke).toHaveBeenCalledWith({
			sessionToken: "session-a",
		});
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

	it("creates a browser-approved grant that lets a computer create its own session", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const request = `${init?.method ?? "GET"} ${String(input)}`;
			switch (request) {
				case "POST /api/auth/device/code":
					return createFetchResponse(
						{
							device_code: "device-secret",
							user_code: "MELD-1234",
							verification_uri: "/device",
							verification_uri_complete: "/device?user_code=MELD-1234",
							expires_in: 300,
							interval: 5,
						},
						200
					);
				case "GET /api/auth/device?user_code=MELD-1234":
					return createFetchResponse(
						{ user_code: "MELD-1234", status: "pending" },
						200
					);
				case "POST /api/auth/device/approve":
					return createFetchResponse({ success: true }, 200);
				default:
					throw new Error(`Unexpected request: ${request}`);
			}
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(createComputerAuthorizationGrant()).resolves.toEqual({
			deviceCode: "device-secret",
			expiresIn: 300,
		});

		expect(fetchMock).toHaveBeenNthCalledWith(
			1,
			"/api/auth/device/code",
			expect.objectContaining({
				body: JSON.stringify({ client_id: "openmeld-cli" }),
				credentials: "include",
				method: "POST",
			})
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			2,
			"/api/auth/device?user_code=MELD-1234",
			expect.objectContaining({
				credentials: "include",
				method: "GET",
			})
		);
		expect(fetchMock).toHaveBeenNthCalledWith(
			3,
			"/api/auth/device/approve",
			expect.objectContaining({
				body: JSON.stringify({ userCode: "MELD-1234" }),
				credentials: "include",
				method: "POST",
			})
		);
	});

	it("rejects a partial vendor response before issuing approval", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			const request = `${init?.method ?? "GET"} ${String(input)}`;
			if (request === "POST /api/auth/device/code") {
				return createFetchResponse(
					{
						device_code: "device-secret",
						user_code: "MELD-1234",
						expires_in: 300,
					},
					200
				);
			}
			throw new Error(`Unexpected request: ${request}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		await expect(createComputerAuthorizationGrant()).rejects.toThrow(
			"Auth returned an invalid computer authorization response."
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

function createFetchResponse(
	payload: unknown,
	status: number
): Promise<Response> {
	return Promise.resolve(
		new Response(JSON.stringify(payload), {
			status,
			headers: { "content-type": "application/json" },
		})
	);
}
