import {
	DESKTOP_APP_ORIGIN,
	DESKTOP_CONTRACT_HEADER,
	DESKTOP_WEB_BUILD_HEADER,
} from "@openmeld/schemas";
import { expect, it } from "vitest";
import { admitDesktopRequest } from "./desktop-admission";

it("keeps an installed contract usable across Web builds while retaining private fingerprint admission", () => {
	const request = (path: string, headers: Record<string, string>) =>
		new Request(`https://openmeld.ai${path}`, {
			headers: { origin: DESKTOP_APP_ORIGIN, ...headers },
		});
	for (const webBuild of ["a".repeat(64), "b".repeat(64)]) {
		expect(
			admitDesktopRequest(
				request("/v1/account/session", { [DESKTOP_CONTRACT_HEADER]: "1" }),
				{ enabled: false, webBuild }
			)
		).toBeNull();
	}
	const pilot = { enabled: true, webBuild: "b".repeat(64) };
	expect(
		admitDesktopRequest(
			request("/v1/account/session", {
				[DESKTOP_WEB_BUILD_HEADER]: "a".repeat(64),
			}),
			pilot
		)?.status
	).toBe(409);
	expect(
		admitDesktopRequest(
			request("/_serverFn/private", {
				[DESKTOP_WEB_BUILD_HEADER]: pilot.webBuild,
			}),
			pilot
		)
	).toBeNull();
	for (const path of ["/_serverFn/generated", "/api/auth/sign-out"]) {
		expect(
			admitDesktopRequest(
				request(path, { [DESKTOP_CONTRACT_HEADER]: "1" }),
				pilot
			)?.status
		).toBe(403);
	}
	for (const [path, method, admitted] of [
		["/api/auth/device/code", "POST", true],
		["/api/auth/device?user_code=TEST", "GET", true],
		["/api/auth/device/approve", "POST", true],
		["/api/auth/device/code", "GET", false],
		["/api/auth/device/approve", "GET", false],
		["/api/auth/device/token", "POST", false],
		["/api/auth/device/code/extra", "POST", false],
	] as const) {
		const result = admitDesktopRequest(
			new Request(`https://openmeld.ai${path}`, {
				method,
				headers: { origin: DESKTOP_APP_ORIGIN, [DESKTOP_CONTRACT_HEADER]: "1" },
			}),
			pilot
		);
		expect(result?.status ?? null).toBe(admitted ? null : 403);
	}
	expect(
		admitDesktopRequest(
			request("/v1/account/session", { [DESKTOP_CONTRACT_HEADER]: "2" }),
			pilot
		)?.status
	).toBe(409);
	expect(
		admitDesktopRequest(request("/v1/account/session", {}), pilot)?.status
	).toBe(409);
	expect(
		admitDesktopRequest(
			new Request("https://openmeld.ai/v1/account/session"),
			pilot
		)
	).toBeNull();
});
