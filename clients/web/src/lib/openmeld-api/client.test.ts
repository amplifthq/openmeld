import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { currentDeviceTargetResponseSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createOrganizationScopedWebOpenMeldApiFoundation,
	createUnscopedWebOpenMeldApiFoundation,
	resolveWebOpenMeldApiBaseUrl,
} from "./client";

const CLIENT_SOURCE = fs.readFileSync(
	path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./client.ts"),
	"utf8"
);

describe("web OpenMeld API foundation", () => {
	afterEach(() => {
		window.history.replaceState(null, "", "/");
	});

	it("uses the current browser origin as the default baseUrl", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(JSON.stringify({ availability: "missing" }), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		const foundation = createUnscopedWebOpenMeldApiFoundation({
			fetchImpl: fetchMock,
		});
		const result = await foundation.requestJson({
			url: "/v1/devices/current",
			operation: "get current device target",
			schema: currentDeviceTargetResponseSchema,
			invalidMessage: "Invalid current device target response",
		});

		expect(resolveWebOpenMeldApiBaseUrl()).toBe(window.location.origin);
		expect(fetchMock).toHaveBeenCalledWith(
			`${window.location.origin}/v1/devices/current`,
			expect.objectContaining({
				credentials: "include",
			})
		);
		expect(result).toEqual({
			availability: "missing",
		});
	});

	it("forwards an explicit OpenMeld profile id for browser-origin requests", async () => {
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(JSON.stringify({ availability: "missing" }), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		const foundation = createUnscopedWebOpenMeldApiFoundation({
			fetchImpl: fetchMock,
			openMeldProfileId: "profile-123",
		});

		await foundation.requestJson({
			url: "/v1/devices/current",
			operation: "get current device target",
			schema: currentDeviceTargetResponseSchema,
			invalidMessage: "Invalid current device target response",
		});

		expect(fetchMock).toHaveBeenCalledWith(
			`${window.location.origin}/v1/devices/current`,
			expect.objectContaining({
				credentials: "include",
				headers: expect.any(Headers),
			})
		);

		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect((headers as Headers).get("x-openmeld-profile-id")).toBe(
			"profile-123"
		);
	});

	it("does not infer Organization context from mutable browser location", async () => {
		window.history.replaceState(
			null,
			"",
			"/o/amplift/center-agent/apps/github"
		);
		const fetchMock = vi.fn<typeof fetch>(() => {
			return Promise.resolve(
				new Response(JSON.stringify({ availability: "missing" }), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		const foundation = createUnscopedWebOpenMeldApiFoundation({
			fetchImpl: fetchMock,
		});

		await foundation.requestJson({
			url: "/v1/devices/current",
			operation: "get current device target",
			schema: currentDeviceTargetResponseSchema,
			invalidMessage: "Invalid current device target response",
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-slug")
		).toBeNull();
		expect(
			(headers as Headers).get("x-openmeld-active-organization-id")
		).toBeNull();
	});

	it("binds an explicit Organization id independently of the current browser route", async () => {
		window.history.replaceState(
			null,
			"",
			"/o/amplift/center-agent/apps/github"
		);
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(JSON.stringify({ availability: "missing" }), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			)
		);
		const foundation = createOrganizationScopedWebOpenMeldApiFoundation({
			fetchImpl: fetchMock,
			organizationId: "org-openmeld",
		});

		await foundation.requestJson({
			url: "/v1/devices/current",
			operation: "get current device target",
			schema: currentDeviceTargetResponseSchema,
			invalidMessage: "Invalid current device target response",
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-id")
		).toBe("org-openmeld");
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-slug")
		).toBeNull();
	});

	it("sends exactly one explicit Organization selector", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(JSON.stringify({ availability: "missing" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			)
		);
		const foundation = createOrganizationScopedWebOpenMeldApiFoundation({
			fetchImpl: fetchMock,
			organizationSlug: "openmeld",
		});

		await foundation.requestJson({
			invalidMessage: "Invalid current device target response",
			operation: "get current device target",
			schema: currentDeviceTargetResponseSchema,
			url: "/v1/devices/current",
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers;
		expect(headers).toBeInstanceOf(Headers);
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-id")
		).toBeNull();
		expect(
			(headers as Headers).get("x-openmeld-requested-organization-slug")
		).toBe("openmeld");
	});

	it("keeps an explicit route slug authoritative over request-context state", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(JSON.stringify({ availability: "missing" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				})
			)
		);
		const foundation = createOrganizationScopedWebOpenMeldApiFoundation({
			fetchImpl: fetchMock,
			organizationSlug: "route-organization",
		});

		await foundation.requestJson({
			invalidMessage: "Invalid current device target response",
			operation: "get current device target",
			requestContext: {
				activeOrganizationId: "session-organization",
				actorContext: {
					openMeldProfileId: "human-1",
					profileKind: "human",
					profileName: "Mira",
					requestId: "request-1",
				},
			},
			schema: currentDeviceTargetResponseSchema,
			url: "/v1/devices/current",
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
		expect(headers.get("x-openmeld-requested-organization-id")).toBeNull();
		expect(headers.get("x-openmeld-requested-organization-slug")).toBe(
			"route-organization"
		);
	});

	it("fails before fetch when an Organization-scoped client has no valid selector", () => {
		expect(() =>
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: "",
			})
		).toThrow();
		expect(() =>
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: "org-1",
				organizationSlug: "openmeld",
			} as never)
		).toThrow();
	});

	it("rejects path-prefixed baseUrl workarounds", () => {
		expect(() =>
			createUnscopedWebOpenMeldApiFoundation({
				baseUrl: "https://openmeld.test/proxy",
			})
		).toThrow("baseUrl must be origin-only");
	});

	it("keeps browser OpenMeld API code free of direct OPENMELD_GATEWAY_URL coupling", () => {
		expect(CLIENT_SOURCE).not.toContain("OPENMELD_GATEWAY_URL");
	});
});
