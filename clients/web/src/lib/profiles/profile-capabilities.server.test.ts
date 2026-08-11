import { describe, expect, it, vi } from "vitest";
import { isSessionExpiredError } from "#/lib/session-expired";
import { readProfileCapabilities } from "./profile-capabilities.server";

describe("profile capabilities resolver", () => {
	it("reads the Auth-owned capability with the request cookie", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			expect(String(input)).toBe(
				"https://auth.openmeld.test/v1/profiles/capabilities"
			);
			expect(init?.method).toBe("GET");
			const headers = init?.headers as Headers | undefined;
			expect(headers?.get("cookie")).toBe("session=abc");

			return Promise.resolve(
				new Response(
					JSON.stringify({
						additionalHumanProfileCreationEnabled: false,
						ok: true,
					}),
					{ status: 200 }
				)
			);
		});

		await expect(
			readProfileCapabilities({
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
				requestHeaders: new Headers({ cookie: "session=abc" }),
			})
		).resolves.toEqual({
			additionalHumanProfileCreationEnabled: false,
			ok: true,
		});
	});

	it("fails closed when Auth returns an invalid capability payload", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						additionalHumanProfileCreationEnabled: "true",
						ok: true,
					}),
					{ status: 200 }
				)
			)
		);

		await expect(
			readProfileCapabilities({
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
				requestHeaders: new Headers(),
			})
		).rejects.toThrow("Invalid profile capabilities response");
	});

	it("throws the shared session-expired error when Auth returns 401", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						code: "auth.unauthenticated",
						message: "authentication required",
						ok: false,
					}),
					{ status: 401, statusText: "Unauthorized" }
				)
			)
		);

		await expect(
			readProfileCapabilities({
				authBaseUrl: "https://auth.openmeld.test",
				fetchImpl: fetchMock,
				requestHeaders: new Headers(),
			})
		).rejects.toSatisfy((error: unknown) => isSessionExpiredError(error));
	});
});
