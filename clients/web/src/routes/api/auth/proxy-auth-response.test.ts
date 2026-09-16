import { describe, expect, it } from "vitest";
import {
	buildBufferedAuthProxyResponse,
	buildDownstreamAuthProxyHeaders,
	buildUpstreamHeaders,
} from "#/lib/auth-proxy.server";

function readSetCookieHeaders(headers: Headers): string[] {
	const getSetCookie = (
		headers as Headers & {
			getSetCookie?: () => string[];
		}
	).getSetCookie;
	if (typeof getSetCookie === "function") {
		return getSetCookie.call(headers);
	}
	const cookieHeader = headers.get("set-cookie");
	return cookieHeader ? [cookieHeader] : [];
}

describe("auth proxy response", () => {
	it("preserves separate cookies through the Workers Headers getAll contract", () => {
		const cookies = [
			"session=renewed; Expires=Wed, 21 Oct 2037 07:28:00 GMT; HttpOnly",
			"session_data=; Max-Age=0; HttpOnly",
		];
		const headers = new Headers();
		Object.defineProperty(headers, "getSetCookie", { value: undefined });
		Object.defineProperty(headers, "getAll", {
			value: (name: string) => {
				expect(name).toBe("Set-Cookie");
				return cookies;
			},
		});
		expect(
			readSetCookieHeaders(buildDownstreamAuthProxyHeaders(headers))
		).toEqual(cookies);
	});
	it("forwards browser auth cookies to the auth worker", () => {
		const headers = buildUpstreamHeaders(
			new Headers({
				cookie: "better-auth.session_token=session-123",
				host: "localhost:3000",
				origin: "http://localhost:3000",
			})
		);

		expect(headers.get("cookie")).toBe("better-auth.session_token=session-123");
		expect(headers.get("host")).toBeNull();
		expect(headers.get("origin")).toBe("http://localhost:3000");
	});

	it("buffers upstream auth responses before returning them from the web worker", async () => {
		const upstreamResponse = new Response(
			JSON.stringify({
				session: null,
			}),
			{
				headers: {
					"content-type": "application/json",
					"strict-transport-security": "max-age=15552000",
					"x-auth-upstream": "local",
				},
				status: 200,
			}
		);

		const response = await buildBufferedAuthProxyResponse({
			method: "GET",
			upstreamResponse,
		});

		expect(upstreamResponse.bodyUsed).toBe(true);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("strict-transport-security")).toBeNull();
		expect(response.headers.get("x-auth-upstream")).toBeNull();
		await expect(response.json()).resolves.toEqual({
			session: null,
		});
	});

	it("does not forward upstream content-length after buffering the response body", async () => {
		const upstreamResponse = new Response(
			JSON.stringify({
				code: "INVALID_EMAIL_OR_PASSWORD",
				message: "Invalid email or password",
			}),
			{
				headers: {
					"content-length": "74",
					"content-type": "application/json",
				},
				status: 401,
			}
		);

		const response = await buildBufferedAuthProxyResponse({
			method: "POST",
			upstreamResponse,
		});

		expect(response.status).toBe(400);
		expect(response.headers.get("content-length")).toBeNull();
		expect(response.headers.get("strict-transport-security")).toBeNull();
		await expect(response.json()).resolves.toEqual({
			code: "INVALID_EMAIL_OR_PASSWORD",
			message: "Invalid email or password",
		});
	});

	it("returns a parseable sign-in error when upstream auth returns an empty 401", async () => {
		const upstreamResponse = new Response("", {
			headers: {
				"content-type": "application/json",
			},
			status: 401,
		});

		const response = await buildBufferedAuthProxyResponse({
			method: "GET",
			upstreamResponse,
		});

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			code: "AUTH_UNAUTHENTICATED",
			message: "Sign in again to continue.",
		});
	});

	it("preserves cookie cleanup and request correlation on auth errors", async () => {
		const expiredSessionCookie =
			"better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
		const expiredSessionDataCookie =
			"better-auth.session_data=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax";
		const upstreamHeaders = new Headers({
			"content-type": "application/json",
			"x-request-id": "auth-error-123",
		});
		upstreamHeaders.append("set-cookie", expiredSessionCookie);
		upstreamHeaders.append("set-cookie", expiredSessionDataCookie);
		const upstreamResponse = new Response(
			JSON.stringify({
				code: "INVALID_SESSION",
				message: "Sign in again to continue.",
			}),
			{
				headers: upstreamHeaders,
				status: 401,
			}
		);

		const response = await buildBufferedAuthProxyResponse({
			method: "GET",
			upstreamResponse,
		});

		expect(response.status).toBe(400);
		expect(response.headers.get("x-request-id")).toBe("auth-error-123");
		expect(readSetCookieHeaders(response.headers)).toEqual([
			expiredSessionCookie,
			expiredSessionDataCookie,
		]);
		await expect(response.json()).resolves.toEqual({
			code: "INVALID_SESSION",
			message: "Sign in again to continue.",
		});
	});

	it("passes through verify redirects with auth cookies intact", async () => {
		const location =
			"http://localhost:3000/magic-link?redirect=%2Fo%2Facme%2Fnew-space";
		const sessionCookie =
			"better-auth.session_token=session-123; Path=/; HttpOnly; Secure; SameSite=Lax";
		const deviceCookie =
			"better-auth.device_id=device-123; Path=/; HttpOnly; Secure; SameSite=Lax";
		const upstreamHeaders = new Headers({
			location,
			"x-request-id": "auth-req-123",
		});
		upstreamHeaders.append("set-cookie", sessionCookie);
		upstreamHeaders.append("set-cookie", deviceCookie);
		const upstreamResponse = new Response(null, {
			headers: upstreamHeaders,
			status: 302,
			statusText: "Found",
		});

		const response = await buildBufferedAuthProxyResponse({
			method: "GET",
			upstreamResponse,
		});

		expect(response.status).toBe(302);
		expect(response.statusText).toBe("Found");
		expect(response.headers.get("location")).toBe(location);
		expect(response.headers.get("x-request-id")).toBe("auth-req-123");
		expect(readSetCookieHeaders(response.headers)).toEqual([
			sessionCookie,
			deviceCookie,
		]);
		expect(response.headers.get("content-type")).toBeNull();
		await expect(response.text()).resolves.toBe("");
	});

	it("converts verification error redirects into structured JSON errors for XHR", async () => {
		const upstreamResponse = Response.redirect(
			"http://localhost:3000/verify-email?error=INVALID_TOKEN&error_description=Verification%20link%20is%20invalid",
			302
		);

		const response = await buildBufferedAuthProxyResponse({
			method: "GET",
			requestUrl: "https://openmeld.test/api/auth/verify-email?token=bad-token",
			upstreamResponse,
		});

		expect(response.status).toBe(400);
		expect(response.headers.get("location")).toBeNull();
		expect(response.headers.get("content-type")).toBe(
			"application/json; charset=utf-8"
		);
		await expect(response.json()).resolves.toEqual({
			code: "INVALID_TOKEN",
			description: "Verification link is invalid",
			message: "INVALID_TOKEN: Verification link is invalid",
		});
	});

	it("converts successful verification redirects into JSON without dropping auth cookies", async () => {
		const sessionCookie =
			"better-auth.session_token=session-123; Path=/; HttpOnly; Secure; SameSite=Lax";
		const upstreamHeaders = new Headers({
			location: "http://localhost:3000/verify-email",
			"x-request-id": "auth-req-456",
		});
		upstreamHeaders.append("set-cookie", sessionCookie);
		const upstreamResponse = new Response(null, {
			headers: upstreamHeaders,
			status: 302,
			statusText: "Found",
		});

		const response = await buildBufferedAuthProxyResponse({
			method: "GET",
			requestUrl:
				"https://openmeld.test/api/auth/verify-email?token=valid-token",
			upstreamResponse,
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("location")).toBeNull();
		expect(response.headers.get("x-request-id")).toBe("auth-req-456");
		expect(readSetCookieHeaders(response.headers)).toEqual([sessionCookie]);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});
});
