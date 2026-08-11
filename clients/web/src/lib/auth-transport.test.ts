import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	normalizeClientResult,
	parseResponseBody,
	requestAuthEndpoint,
	resolveClientResult,
	toAuthError,
} from "./auth-transport";

describe("auth transport", () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("preserves plain-object client results as successful data", () => {
		const session = {
			session: { id: "session-1" },
			user: { id: "user-1", email: "mira@example.com" },
		};

		expect(normalizeClientResult(session, "Failed to fetch session.")).toEqual({
			data: session,
			error: null,
		});
	});

	it("whitelists safe auth error fields instead of copying arbitrary properties", () => {
		expect(
			toAuthError(
				{
					code: "invalid_token",
					description: "Bearer token is missing",
					message: "Bad token",
					status: 401,
					statusText: "Unauthorized",
					sensitive: "do-not-copy",
				},
				"Failed to verify token."
			)
		).toEqual({
			code: "invalid_token",
			description: "Bearer token is missing",
			message: "Bad token",
			status: 401,
			statusText: "Unauthorized",
		});
	});

	it("normalizes rejected SDK calls into the auth transport result contract", async () => {
		const result = await resolveClientResult(
			() =>
				Promise.reject({
					message: "Unauthorized",
					status: 401,
					statusText: "Unauthorized",
				}),
			"Failed to fetch session."
		);

		expect(result).toEqual({
			data: null,
			error: {
				message: "Unauthorized",
				status: 401,
				statusText: "Unauthorized",
			},
		});
	});

	it("returns parsed JSON data for successful auth endpoint responses", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ session: { id: "session-1" } }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);

		const result = await requestAuthEndpoint<{ session: { id: string } }>({
			path: "/session",
			request: { method: "GET" },
			fallbackMessage: "Failed to fetch session.",
		});

		expect(result).toEqual({
			data: { session: { id: "session-1" } },
			error: null,
		});
	});

	it("falls back to text payload parsing for successful non-JSON responses", async () => {
		fetchMock.mockResolvedValue(
			new Response("Verification email sent.", {
				status: 200,
				headers: { "content-type": "text/plain" },
			})
		);

		const result = await requestAuthEndpoint<{ message: string }>({
			path: "/send-verification-email",
			request: { method: "POST", body: JSON.stringify({}) },
			fallbackMessage: "Failed to send verification email.",
		});

		expect(result).toEqual({
			data: { message: "Verification email sent." },
			error: null,
		});
	});

	it("preserves auth transport headers when callers pass custom headers", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);

		await requestAuthEndpoint({
			path: "/set-password",
			request: {
				method: "POST",
				body: JSON.stringify({ password: "secret-123" }),
				headers: {
					"x-trace-id": "trace-1",
				},
			},
			fallbackMessage: "Failed to set password.",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/set-password",
			expect.objectContaining({
				credentials: "include",
				headers: expect.any(Headers),
			})
		);
		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect((headers as Headers).get("accept")).toBe("application/json");
		expect((headers as Headers).get("content-type")).toBe("application/json");
		expect((headers as Headers).get("x-trace-id")).toBe("trace-1");
	});

	it("forces credentials include even when callers pass omit", async () => {
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})
		);

		const request: RequestInit = {
			method: "POST",
			body: JSON.stringify({ password: "secret-123" }),
			credentials: "omit",
			headers: {
				"x-trace-id": "trace-2",
			},
		};

		await requestAuthEndpoint({
			path: "/set-password",
			request,
			fallbackMessage: "Failed to set password.",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/auth/set-password",
			expect.objectContaining({
				credentials: "include",
				headers: expect.any(Headers),
			})
		);
		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect((headers as Headers).get("accept")).toBe("application/json");
		expect((headers as Headers).get("content-type")).toBe("application/json");
		expect((headers as Headers).get("x-trace-id")).toBe("trace-2");
	});

	it("returns null for empty response bodies", async () => {
		await expect(parseResponseBody(new Response(null))).resolves.toEqual({
			ok: true,
			value: null,
			empty: true,
		});
	});

	it("returns invalid_json for malformed JSON response bodies", async () => {
		await expect(
			parseResponseBody(
				new Response("{bad json", {
					headers: { "content-type": "application/json" },
				})
			)
		).resolves.toEqual({
			ok: false,
			reason: "invalid_json",
		});
	});

	it("treats missing content-type as text fallback parsing", async () => {
		await expect(
			parseResponseBody(
				new Response("raw response body", {
					headers: {},
				})
			)
		).resolves.toEqual({
			ok: true,
			value: {
				message: "raw response body",
			},
			empty: false,
		});
	});

	it("maps JSON error responses into structured auth errors", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({ code: "invalid_token", message: "Bad token" }),
				{
					status: 400,
					statusText: "Bad Request",
					headers: { "content-type": "application/json" },
				}
			)
		);

		const result = await requestAuthEndpoint({
			path: "/verify-email",
			request: { method: "GET" },
			fallbackMessage: "Failed to verify email token.",
		});

		expect(result.data).toBeNull();
		expect(result.error).toMatchObject({
			code: "invalid_token",
			message: "Bad token",
			status: 400,
			statusText: "Bad Request",
		});
	});

	it("preserves nested auth error messages from Better Auth responses", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					error: {
						code: "AUTH_UNAUTHENTICATED",
						message: "Not authenticated",
					},
				}),
				{
					status: 400,
					statusText: "Bad Request",
					headers: { "content-type": "application/json" },
				}
			)
		);

		const result = await requestAuthEndpoint({
			path: "/organization/list-invitations?organizationId=org-acme",
			request: { method: "GET" },
			fallbackMessage: "Failed to fetch invitations.",
		});

		expect(result.data).toBeNull();
		expect(result.error).toMatchObject({
			code: "AUTH_UNAUTHENTICATED",
			message: "Not authenticated",
			status: 400,
			statusText: "Bad Request",
		});
	});

	it("preserves top-level Better Auth organization error responses", async () => {
		fetchMock.mockResolvedValue(
			new Response(
				JSON.stringify({
					message: "Unauthorized",
					code: "UNAUTHORIZED",
				}),
				{
					status: 401,
					statusText: "Unauthorized",
					headers: { "content-type": "application/json" },
				}
			)
		);

		const result = await requestAuthEndpoint({
			path: "/organization/list-invitations?organizationId=org-acme",
			request: { method: "GET" },
			fallbackMessage: "Failed to fetch invitations.",
		});

		expect(result.data).toBeNull();
		expect(result.error).toMatchObject({
			code: "UNAUTHORIZED",
			message: "Unauthorized",
			status: 401,
			statusText: "Unauthorized",
		});
	});

	it("keeps redirect error diagnostics from the final response URL", async () => {
		const response = new Response(null, {
			status: 200,
			headers: { "content-type": "application/json" },
		});
		Object.defineProperty(response, "url", {
			configurable: true,
			value:
				"https://openmeld.test/verify-email?error=token_expired&error_description=Verification%20link%20expired",
		});
		fetchMock.mockResolvedValue(response);

		const result = await requestAuthEndpoint({
			path: "/verify-email",
			request: { method: "GET" },
			fallbackMessage: "Failed to verify email token.",
			redirectErrorHandling: "enabled",
		});

		expect(result).toEqual({
			data: null,
			error: {
				code: "token_expired",
				description: "Verification link expired",
				message: "token_expired: Verification link expired",
				status: 400,
				statusText: "Bad Request",
			},
		});
	});

	it("keeps redirect error diagnostics from redirect locations", async () => {
		fetchMock.mockResolvedValue(
			Response.redirect(
				"https://openmeld.test/verify-email?error=token_expired&error_description=Verification%20link%20expired",
				302
			)
		);

		const result = await requestAuthEndpoint({
			path: "/verify-email",
			request: { method: "GET" },
			fallbackMessage: "Failed to verify email token.",
			redirectErrorHandling: "enabled",
		});

		expect(result).toEqual({
			data: null,
			error: {
				code: "token_expired",
				description: "Verification link expired",
				message: "token_expired: Verification link expired",
				status: 400,
				statusText: "Bad Request",
			},
		});
	});

	it("does not treat a session-setting redirect as a verified auth success", async () => {
		fetchMock.mockResolvedValue(
			Response.redirect(
				"https://openmeld.test/magic-link?redirect=%2Fo%2Facme%2Fnew-space",
				302
			)
		);

		const result = await requestAuthEndpoint({
			path: "/magic-link/verify?token=token-123",
			request: { method: "GET" },
			fallbackMessage: "Failed to verify magic link token.",
			redirectErrorHandling: "enabled",
		});

		expect(result.data).toBeNull();
		expect(result.error).toMatchObject({
			code: "session_not_established",
			message:
				"Authentication redirected before OpenMeld confirmed a signed-in session.",
			status: 302,
			statusText: "Redirect",
		});
	});

	it("does not treat a followed auth redirect HTML response as a verified auth success", async () => {
		const response = new Response("<!doctype html><title>OpenMeld</title>", {
			status: 200,
			statusText: "OK",
			headers: { "content-type": "text/html" },
		});
		Object.defineProperty(response, "redirected", {
			configurable: true,
			value: true,
		});
		Object.defineProperty(response, "url", {
			configurable: true,
			value: "https://openmeld.test/o/acme/new-space",
		});
		fetchMock.mockResolvedValue(response);

		const result = await requestAuthEndpoint({
			path: "/magic-link/verify?token=token-123",
			request: { method: "GET" },
			fallbackMessage: "Failed to verify magic link token.",
			redirectErrorHandling: "enabled",
		});

		expect(result.data).toBeNull();
		expect(result.error).toMatchObject({
			code: "session_not_established",
			message:
				"Authentication redirected before OpenMeld confirmed a signed-in session.",
			status: 409,
			statusText: "Session Not Established",
		});
	});

	it("maps network failures to a structured transport error", async () => {
		fetchMock.mockRejectedValue(new Error("socket hang up"));

		const result = await requestAuthEndpoint({
			path: "/list-sessions",
			request: { method: "GET" },
			fallbackMessage: "Failed to fetch sessions.",
		});

		expect(result.data).toBeNull();
		expect(result.error).toMatchObject({
			message: "socket hang up",
			status: 500,
			statusText: "Network Error",
		});
	});

	it("returns invalid_response when a JSON success payload is malformed", async () => {
		fetchMock.mockResolvedValue(
			new Response("{bad json", {
				status: 200,
				statusText: "OK",
				headers: { "content-type": "application/json" },
			})
		);

		const result = await requestAuthEndpoint({
			path: "/session",
			request: { method: "GET" },
			fallbackMessage: "Failed to fetch session.",
		});

		expect(result).toEqual({
			data: null,
			error: {
				code: "invalid_response",
				message: "Failed to fetch session.",
				status: 200,
				statusText: "Invalid Response",
			},
		});
	});
});
