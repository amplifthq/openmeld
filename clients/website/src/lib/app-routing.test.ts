import { describe, expect, it, vi } from "vitest";
import { routeAppRequest } from "./app-routing";

const environment = {
	APP_URL: "https://app.openmeld.ai",
	LEGACY_BROWSER_COMPATIBILITY: "true",
};

describe("website App boundary", () => {
	it.each([
		"/desktop",
		"/desktop/",
	])("keeps legacy %s download links on the website, including selectors", (path) => {
		const query = `?candidate=${"a".repeat(64)}&platform=macos-arm64`;
		const response = routeAppRequest(
			new Request(`https://openmeld.ai${path}${query}`),
			environment
		) as Response;
		expect(response.status).toBe(307);
		expect(response.headers.get("Location")).toBe(
			`https://openmeld.ai/downloads${query}`
		);
	});
	it("redirects existing page links to a fixed App origin, preserving path and query", () => {
		const response = routeAppRequest(
			new Request(
				"https://openmeld.ai/o/team/spaces/123?returnTo=https://evil.test"
			),
			environment
		) as Response;
		expect(response.status).toBe(307);
		expect(response.headers.get("Location")).toBe(
			"https://app.openmeld.ai/o/team/spaces/123?returnTo=https://evil.test"
		);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
	});

	it.each([
		"/",
		"/privacy",
		"/terms",
		"/changelog",
		"/downloads",
		"/guides/local-agents/codex",
		"/_website/serverFn/read",
		"/_website/assets/main.js",
		"/unknown",
		"/api/unknown",
		"/.well-known/posthog-client.json",
	])("keeps %s with the website router", (path) => {
		expect(
			routeAppRequest(new Request(`https://openmeld.ai${path}`), environment)
		).toBeNull();
	});

	it("does not redirect non-navigation writes", () => {
		const response = routeAppRequest(
			new Request("https://openmeld.ai/login", {
				method: "POST",
				body: "credentials",
			}),
			environment
		) as Response;
		expect(response.status).toBe(405);
		expect(response.headers.get("Location")).toBeNull();
	});

	it("forwards protocol requests and streamed responses without rewriting security or download headers", async () => {
		const request = new Request(
			"https://openmeld.ai/v1/desktop/compatibility?version=old",
			{
				method: "POST",
				body: "payload",
				headers: {
					Origin: "https://openmeld.ai",
					Referer: "https://openmeld.ai/desktop",
					Cookie: "session=example",
					Range: "bytes=0-7",
				},
			}
		);
		const upstream = new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(new TextEncoder().encode("download"));
					controller.close();
				},
			}),
			{
				status: 206,
				headers: {
					"Content-Range": "bytes 0-7/20",
					"Content-Disposition": "attachment; filename=desktop.zip",
					"Set-Cookie":
						"session=refreshed; Domain=openmeld.ai; Secure; HttpOnly",
				},
			}
		);
		const fetch = vi.fn<Fetcher["fetch"]>(async (forwarded) => {
			expect(forwarded).toBe(request);
			expect(await (forwarded as Request).text()).toBe("payload");
			return upstream;
		});
		const response = await routeAppRequest(request, {
			...environment,
			APP: { fetch },
		});
		expect(response).toBe(upstream);
		expect(await response?.text()).toBe("download");
	});

	it.each([
		"/setup",
		"/cli/manifest.json",
		"/desktop/download",
		"/skills/openmeld-cli/SKILL.md",
		"/llms.txt",
		"/api/auth/callback/github",
		"/_serverFn/old",
		"/assets/old.js",
		"/emoji/17.0.0/en/data.json",
	])("uses the fixed service binding for %s", async (path) => {
		const response = new Response("upstream");
		const fetch = vi.fn<Fetcher["fetch"]>().mockResolvedValue(response);
		expect(
			await routeAppRequest(new Request(`https://openmeld.ai${path}`), {
				...environment,
				APP: { fetch },
			})
		).toBe(response);
	});

	it("can retire old browser functions and assets without retiring supported download protocols", () => {
		const retired = { ...environment, LEGACY_BROWSER_COMPATIBILITY: "false" };
		expect(
			routeAppRequest(new Request("https://openmeld.ai/_serverFn/old"), retired)
		).toBeNull();
		expect(
			(
				routeAppRequest(
					new Request("https://openmeld.ai/cli/manifest.json"),
					retired
				) as Response
			).status
		).toBe(503);
	});
});
