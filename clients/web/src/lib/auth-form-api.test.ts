import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthClientMock = {
	signIn?: {
		email?: ReturnType<typeof vi.fn>;
	};
	[key: string]: unknown;
};

const { openMeldAuthClientMock } = vi.hoisted(() => ({
	openMeldAuthClientMock: {} as AuthClientMock,
}));

vi.mock("#/lib/auth-client", () => ({
	openMeldAuthClient: openMeldAuthClientMock,
}));

import { signInWithEmail, verifyEmailToken } from "./auth-form-api";

describe("auth-form-api", () => {
	const fetchMock = vi.fn<typeof fetch>();

	beforeEach(() => {
		for (const key of Object.keys(openMeldAuthClientMock)) {
			delete (openMeldAuthClientMock as Record<string, unknown>)[key];
		}
		fetchMock.mockReset();
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("keeps redirect error handling for verification flows", async () => {
		fetchMock.mockResolvedValue(
			Response.redirect(
				"https://openmeld.test/verify-email?error=token_expired&error_description=Verification%20link%20expired",
				302
			)
		);

		const result = await verifyEmailToken({ token: "token-123" });

		expect(result.data).toBeNull();
		expect(result.error).toMatchObject({
			code: "token_expired",
			description: "Verification link expired",
			message: "token_expired: Verification link expired",
			status: 400,
			statusText: "Bad Request",
		});
	});

	it("normalizes rejected SDK auth form calls into the action result contract", async () => {
		openMeldAuthClientMock.signIn = {
			email: vi.fn().mockRejectedValue({
				message: "Invalid email or password",
				status: 401,
				statusText: "Unauthorized",
			}),
		};

		const result = await signInWithEmail({
			email: "mira@example.com",
			password: "bad-password",
			callbackURL: "https://openmeld.test/callback",
		});

		expect(result).toEqual({
			data: null,
			error: {
				message: "Invalid email or password",
				status: 401,
				statusText: "Unauthorized",
			},
		});
	});
});
