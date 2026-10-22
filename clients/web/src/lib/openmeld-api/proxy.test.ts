// @vitest-environment node
import {
	OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION,
	OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
	OPENMELD_HEADER_INBOX_SUMMARY_VERSION,
	OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
	OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION,
	OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
import {
	OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
	OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { encodeProtectedSpaceAccessCookieValue } from "#/lib/spaces/protected-space-access.server";
import {
	createOpenMeldGatewayUpstream,
	type OpenMeldGatewayServiceBinding,
} from "./gateway-upstream";
import {
	buildOpenMeldGatewayUpstreamHeaders,
	buildOpenMeldGatewayUpstreamUrl,
	proxyOpenMeldGatewayRequest,
} from "./proxy";
import {
	executeObservedWebProxyRequest,
	WEB_PROXY_REQUEST_ID_HEADER,
} from "./proxy-observability";

const OPENMELD_HEADER_SPACE_PASSWORD = "x-openmeld-space-password";
const UUID_HEADER_PATTERN = /^[0-9a-f-]+$/u;
const TRACE_ID = "0123456789abcdef0123456789abcdef";

describe("OpenMeld gateway proxy", () => {
	it("streams a versioned media range with the existing Organization and cookie boundary", async () => {
		const request = new Request(
			"https://openmeld.test/v1/spaces/space-123/files/file-1/content?revision=2&__openmeld_organization_slug=acme",
			{
				headers: {
					cookie: "session=abc",
					range: "bytes=4-7",
					"if-range": '"revision-2"',
					authorization: "untrusted",
					"x-openmeld-user-time-zone": "Asia/Taipei",
					"x-openmeld-user-time-zone-source": "web",
				},
			}
		);
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response("part", {
					status: 206,
					headers: {
						"content-type": "video/mp4",
						"content-range": "bytes 4-7/10",
						"accept-ranges": "bytes",
						"content-length": "4",
						"cache-control": "private, no-store",
					},
				})
			)
		);
		const directlyBuilt = buildOpenMeldGatewayUpstreamHeaders({
			requestHeaders: request.headers,
			webAppUrl: "https://openmeld.test",
		});
		expect(Object.fromEntries(directlyBuilt.entries())).toMatchObject({
			range: "bytes=4-7",
		});
		const response = await proxyOpenMeldGatewayRequest({
			request,
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});
		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(String(url)).toBe(
			"https://gateway.openmeld.test/v1/spaces/space-123/files/file-1/content?revision=2"
		);
		const headers = new Headers(init?.headers);
		expect(Object.fromEntries(request.headers)).toMatchObject({
			range: "bytes=4-7",
			"if-range": '"revision-2"',
		});
		expect(
			Object.fromEntries((init?.headers as Headers).entries())
		).toMatchObject({ range: "bytes=4-7", "if-range": '"revision-2"' });
		expect(headers.get("x-openmeld-requested-organization-slug")).toBe("acme");
		expect(headers.get("cookie")).toBe("session=abc");
		expect(headers.get("range")).toBe("bytes=4-7");
		expect(headers.get("if-range")).toBe('"revision-2"');
		expect(headers.has("authorization")).toBe(false);
		expect(headers.get("x-openmeld-user-time-zone")).toBe("Asia/Taipei");
		expect(headers.get("x-openmeld-user-time-zone-source")).toBe("web");
		expect(init?.signal).toBe(request.signal);
		expect(response.status).toBe(206);
		expect(response.headers.get("content-range")).toBe("bytes 4-7/10");
		expect(response.headers.get("content-length")).toBe("4");
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(await response.text()).toBe("part");
	});

	it("preserves the incoming /v1 path and query against the gateway origin", () => {
		const upstreamUrl = buildOpenMeldGatewayUpstreamUrl({
			gatewayUrl: "https://gateway.openmeld.test",
			requestUrl:
				"https://web.openmeld.test/v1/local-runtimes/current/reply-readiness?poll=1",
		});

		expect(upstreamUrl.toString()).toBe(
			"https://gateway.openmeld.test/v1/local-runtimes/current/reply-readiness?poll=1"
		);
	});

	it("turns the Web attachment Organization selector into an upstream header", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			expect(input).toBe(
				"https://gateway.openmeld.test/v1/spaces/space-123/attachments/attachment-123"
			);
			const headers = init?.headers as Headers;
			expect(headers.get("x-openmeld-requested-organization-slug")).toBe(
				"acme"
			);
			return Promise.resolve(new Response("image", { status: 200 }));
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request(
				"https://openmeld.test/v1/spaces/space-123/attachments/attachment-123?__openmeld_organization_slug=acme",
				{ headers: { cookie: "session=abc" } }
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(200);
	});

	it("forwards the current Inbox source-target version to Gateway", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			const headers = init?.headers as Headers;
			expect(headers.get(OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION)).toBe(
				"4"
			);
			return Promise.resolve(new Response("ok", { status: 200 }));
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/inbox", {
				headers: { [OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION]: "4" },
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(200);
	});

	it("forwards the current Inbox item-kind version to Gateway", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			const headers = init?.headers as Headers;
			expect(headers.get(OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION)).toBe("1");
			return Promise.resolve(new Response("ok", { status: 200 }));
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/inbox", {
				headers: { [OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION]: "1" },
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(200);
	});

	it("forwards the Inbox summary version while retaining the request header allowlist", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			const headers = init?.headers as Headers;
			expect(headers.get(OPENMELD_HEADER_INBOX_SUMMARY_VERSION)).toBe("1");
			expect(headers.has("x-openmeld-untrusted")).toBe(false);
			return Promise.resolve(new Response("ok", { status: 200 }));
		});
		await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/inbox/summary", {
				headers: {
					[OPENMELD_HEADER_INBOX_SUMMARY_VERSION]: "1",
					"x-openmeld-untrusted": "blocked",
				},
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});
	});

	it("forwards the current Space Addressing version to Gateway", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			const headers = init?.headers as Headers;
			expect(headers.get(OPENMELD_HEADER_SPACE_ADDRESSING_VERSION)).toBe("1");
			return Promise.resolve(new Response("ok", { status: 200 }));
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/spaces/space-1/signals", {
				headers: { [OPENMELD_HEADER_SPACE_ADDRESSING_VERSION]: "1" },
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(200);
	});

	it("forwards Space Files capabilities while blocking untrusted headers", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			const headers = init?.headers as Headers;
			expect(headers.get(OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION)).toBe("1");
			expect(headers.get(OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION)).toBe(
				"1"
			);
			expect(headers.has("x-openmeld-untrusted")).toBe(false);
			return Promise.resolve(new Response("ok", { status: 200 }));
		});
		const response = await proxyOpenMeldGatewayRequest({
			request: new Request(
				"https://openmeld.test/v1/spaces/space-1/files?origin=all",
				{
					headers: {
						[OPENMELD_HEADER_SPACE_FILES_ORIGIN_VERSION]: "1",
						[OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION]: "1",
						"x-openmeld-untrusted": "blocked",
					},
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});
		expect(response.status).toBe(200);
	});

	it("allows only the Slack OAuth start route outside /v1", () => {
		const upstreamUrl = buildOpenMeldGatewayUpstreamUrl({
			gatewayUrl: "https://gateway.openmeld.test",
			requestUrl: "https://web.openmeld.test/slack/oauth/start?source=channels",
		});

		expect(upstreamUrl.toString()).toBe(
			"https://gateway.openmeld.test/slack/oauth/start?source=channels"
		);
		expect(() =>
			buildOpenMeldGatewayUpstreamUrl({
				gatewayUrl: "https://gateway.openmeld.test",
				requestUrl: "https://web.openmeld.test/slack/oauth/callback",
			})
		).toThrow("OpenMeld proxy does not support route");
	});

	it("forwards the browser session to the Slack OAuth start route", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			const headers = init?.headers as Headers;
			expect(headers.get("cookie")).toBe("session=abc");
			return Promise.resolve(
				Response.redirect(
					"https://slack.com/oauth/v2/authorize?state=test",
					302
				)
			);
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/slack/oauth/start", {
				headers: { cookie: "session=abc" },
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			"https://slack.com/oauth/v2/authorize?state=test"
		);
	});

	it("turns the Slack OAuth organization slug into an authorized upstream selector", async () => {
		const fetchMock = vi.fn<typeof fetch>((input, init) => {
			expect(input).toBe(
				"https://gateway.openmeld.test/slack/oauth/start?move_from=org-existing"
			);
			const headers = init?.headers as Headers;
			expect(headers.get("x-openmeld-requested-organization-slug")).toBe(
				"openmeld-welcome-lab"
			);
			return Promise.resolve(
				Response.redirect(
					"https://slack.com/oauth/v2/authorize?state=test",
					302
				)
			);
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request(
				"https://openmeld.test/slack/oauth/start?organization_slug=openmeld-welcome-lab&move_from=org-existing",
				{ headers: { cookie: "session=abc" } }
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(302);
	});

	it("preserves Wake Stop POST routes through the gateway proxy", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						ok: false,
						runtimeCoordinatorExecutionId: null,
						status: "not_found",
						targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
						reasonCode: "space.wake_stop_target_not_found",
						cancellationState: {
							status: "not_requested",
							reasonCode: "space.wake_stop_target_not_found",
						},
					}),
					{
						status: 200,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request(
				"https://openmeld.test/v1/spaces/space-123/wake-stop",
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						cookie: "session=abc",
					},
					body: JSON.stringify({
						target: {
							by: "client_message",
							clientMessageId: "client-message-1",
							targetProfileId: "agt_33333333-3333-4333-8333-333333333333",
						},
					}),
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://gateway.openmeld.test/v1/spaces/space-123/wake-stop",
			expect.objectContaining({
				method: "POST",
			})
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			ok: false,
			status: "not_found",
		});
	});

	it.each([
		"192.0.2.1",
		"2001:db8::1",
		undefined,
	])("retains the header allowlist and forwards only the edge client IP (%s)", (clientIp) => {
		const headers = buildOpenMeldGatewayUpstreamHeaders({
			requestHeaders: new Headers({
				accept: "application/json",
				"accept-language": "en-US",
				authorization: "Bearer secret",
				"cache-control": "no-cache",
				cookie: "session=abc",
				"if-none-match": '"etag-123"',
				host: "web.openmeld.test",
				[OPENMELD_HEADER_SPACE_PASSWORD]: "  pw-123  ",
				"x-openmeld-active-organization-id": "forged-authority",
				"x-openmeld-unknown-client-contract": "forged-contract",
				"x-openmeld-space-access-version": "1",
				"x-openmeld-profile-id": "forged-profile",
				"x-openmeld-requested-organization-slug": "amplift",
				"x-forwarded-for": "203.0.113.1",
				"x-real-ip": "203.0.113.2",
				...(clientIp ? { "cf-connecting-ip": clientIp } : {}),
			}),
			webAppUrl: "https://openmeld.test",
		});

		expect(headers.get("accept")).toBe("application/json");
		expect(headers.get("accept-language")).toBe("en-US");
		expect(headers.get("cache-control")).toBe("no-cache");
		expect(headers.get("if-none-match")).toBe('"etag-123"');
		expect(headers.get("authorization")).toBeNull();
		expect(headers.get("host")).toBeNull();
		expect(headers.get("cookie")).toBe("session=abc");
		expect(headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe("pw-123");
		expect(headers.get("x-openmeld-profile-id")).toBe("forged-profile");
		expect(headers.get("x-openmeld-active-organization-id")).toBeNull();
		expect(headers.get("x-openmeld-unknown-client-contract")).toBeNull();
		expect(headers.get("x-openmeld-space-access-version")).toBe("1");
		expect(headers.get("x-openmeld-requested-organization-slug")).toBe(
			"amplift"
		);
		expect(headers.get("x-forwarded-for")).toBeNull();
		expect(headers.get("x-real-ip")).toBe(clientIp ?? null);
		expect(headers.get("cf-connecting-ip")).toBeNull();
		expect(headers.get("origin")).toBe("https://openmeld.test");
	});

	it("forwards method, body, cookie, and preserves upstream error responses", async () => {
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			expect(init?.method).toBe("PUT");
			expect(init?.body).toBeInstanceOf(ReadableStream);
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers;
			expect(headers.get("cookie")).toBe("session=abc");
			expect(headers.get("origin")).toBe("https://openmeld.test");
			expect(headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe("pw-123");
			expect(headers.get("x-openmeld-owner-user-id")).toBeNull();
			expect(headers.get("authorization")).toBeNull();

			return Promise.resolve(
				new Response(JSON.stringify({ error: { code: "conflict" } }), {
					status: 409,
					headers: {
						"content-type": "application/json",
						"x-upstream": "gateway",
					},
				})
			);
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request(
				"https://openmeld.test/v1/devices/current?view=full",
				{
					method: "PUT",
					headers: {
						cookie: "session=abc",
						"content-type": "application/json",
						[OPENMELD_HEADER_SPACE_PASSWORD]: "pw-123",
						"x-openmeld-owner-user-id": "forged-owner",
						authorization: "Bearer secret",
					},
					body: JSON.stringify({
						deviceId: "device-123",
					}),
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://gateway.openmeld.test/v1/devices/current?view=full",
			expect.objectContaining({
				method: "PUT",
			})
		);
		expect(response.status).toBe(409);
		expect(response.headers.get("x-upstream")).toBe("gateway");
		expect(response.headers.get(WEB_PROXY_REQUEST_ID_HEADER)).toMatch(
			UUID_HEADER_PATTERN
		);
		await expect(response.json()).resolves.toEqual({
			error: {
				code: "conflict",
			},
		});
	});

	it("adds a JSON content-type when the gateway omits it on a body response", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(new TextEncoder().encode(JSON.stringify({ ok: true })), {
					status: 200,
				})
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request(
				"https://openmeld.test/v1/local-runtimes/current/reply-readiness"
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe(
			"application/json; charset=utf-8"
		);
		await expect(response.json()).resolves.toEqual({ ok: true });
	});

	it("injects cookie-backed protected space access and clears it when upstream rejects the password", async () => {
		const cookieValue = await encodeProtectedSpaceAccessCookieValue({
			spaceId: "space-123",
			password: "  secret-pass  ",
			secret: "secret-value",
		});
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers;
			expect(headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe("secret-pass");

			return Promise.resolve(
				new Response(
					JSON.stringify({
						ok: false,
						error: {
							code: "space.password_invalid",
							message: "Invalid space password.",
						},
					}),
					{
						status: 403,
						headers: {
							"content-type": "application/json",
						},
					}
				)
			);
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/spaces/space-123/status", {
				headers: {
					cookie: `openmeld_space_access_space-123=${cookieValue}`,
				},
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			spaceAccessCookieSecret: "secret-value",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(403);
		expect(response.headers.get(WEB_PROXY_REQUEST_ID_HEADER)).toMatch(
			UUID_HEADER_PATTERN
		);
		await expect(response.json()).resolves.toEqual({
			ok: false,
			error: {
				code: "space.password_invalid",
				message: "Invalid space password.",
			},
		});
	});

	it("injects cookie-backed protected space access for root space mutations", async () => {
		const cookieValue = await encodeProtectedSpaceAccessCookieValue({
			spaceId: "space-123",
			password: "secret-pass",
			secret: "secret-value",
		});
		const fetchMock = vi.fn<typeof fetch>((_input, init) => {
			expect(init?.method).toBe("DELETE");
			expect(init?.headers).toBeInstanceOf(Headers);
			const headers = init?.headers as Headers;
			expect(headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe("secret-pass");

			return Promise.resolve(
				new Response(JSON.stringify({ deleted: true, spaceId: "space-123" }), {
					status: 200,
					headers: {
						"content-type": "application/json",
					},
				})
			);
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/spaces/space-123", {
				method: "DELETE",
				headers: {
					cookie: `openmeld_space_access_space-123=${cookieValue}`,
				},
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			spaceAccessCookieSecret: "secret-value",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({
			deleted: true,
			spaceId: "space-123",
		});
	});

	it("does not classify generic gateway failures as missing protected space access", async () => {
		const writeDataPoint = vi.fn();
		const consoleInfo = vi
			.spyOn(console, "info")
			.mockImplementation(() => undefined);
		try {
			const fetchMock = vi.fn<typeof fetch>(() =>
				Promise.resolve(
					new Response(
						JSON.stringify({
							ok: false,
							error: {
								code: "upstream_unreachable",
								message: "Gateway upstream was unavailable.",
								requestId: "gateway-502",
							},
						}),
						{
							status: 502,
							headers: {
								"content-type": "application/json",
								"x-openmeld-request-id": "gateway-502",
							},
						}
					)
				)
			);

			const response = await proxyOpenMeldGatewayRequest({
				cloudflareRuntimeEvidence: {
					analytics: { writeDataPoint },
					workerEnvironment: "test",
				},
				request: new Request(
					"https://openmeld.test/v1/spaces/space-123/status"
				),
				gatewayUrl: "https://gateway.openmeld.test",
				webAppUrl: "https://openmeld.test",
				spaceAccessCookieSecret: "secret-value",
				fetchImpl: fetchMock,
			});

			expect(response.status).toBe(502);
			expect(writeDataPoint).toHaveBeenCalledOnce();
			const point = writeDataPoint.mock.calls[0]?.[0] as {
				blobs: string[];
			};
			expect(readAnalyticsBlob(point, "reasonCode")).toBe("http_502");
			expect(readAnalyticsBlob(point, "requestId")).toBe("gateway-502");
			expect(consoleInfo).toHaveBeenCalledOnce();
			const record = consoleInfo.mock.calls[0]?.[0] as Record<string, unknown>;
			expect(record.reasonCode).toBe("http_502");
		} finally {
			consoleInfo.mockRestore();
		}
	});

	it("does not hide gateway 502 failures behind protected space access diagnostics", async () => {
		const writeDataPoint = vi.fn();
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						ok: false,
						error: {
							code: "space.password_required",
							message: "Space password required.",
							requestId: "gateway-502-password-required",
						},
					}),
					{
						status: 502,
						headers: {
							"content-type": "application/json",
							"x-openmeld-request-id": "gateway-502-password-required",
						},
					}
				)
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			cloudflareRuntimeEvidence: {
				analytics: { writeDataPoint },
				workerEnvironment: "test",
			},
			request: new Request("https://openmeld.test/v1/spaces/space-123/status"),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			spaceAccessCookieSecret: "secret-value",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(502);
		expect(writeDataPoint).toHaveBeenCalledOnce();
		const point = writeDataPoint.mock.calls[0]?.[0] as {
			blobs: string[];
		};
		expect(readAnalyticsBlob(point, "reasonCode")).toBe("http_502");
		expect(readAnalyticsBlob(point, "requestId")).toBe(
			"gateway-502-password-required"
		);
	});

	it("records when a Space file body finishes reaching the client", async () => {
		const writeDataPoint = vi.fn();
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(new Uint8Array(4096), {
					status: 200,
					headers: {
						"content-type": "image/png",
						"x-openmeld-request-id": "gateway-file-content",
					},
				})
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			cloudflareRuntimeEvidence: {
				analytics: { writeDataPoint },
				workerEnvironment: "test",
			},
			request: new Request(
				"https://openmeld.test/v1/spaces/space-123/files/file-1/content"
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		expect(writeDataPoint).toHaveBeenCalledOnce();
		expect((await response.arrayBuffer()).byteLength).toBe(4096);
		expect(writeDataPoint).toHaveBeenCalledTimes(3);
		const point = writeDataPoint.mock.calls[1]?.[0] as {
			blobs: string[];
			doubles: number[];
		};
		expect(readAnalyticsBlob(point, "event")).toBe(
			"web.openmeld.proxy_response_body"
		);
		expect(readAnalyticsBlob(point, "reasonCode")).toBe("body_completed");
		expect(
			point.doubles[
				OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.indexOf("inputBytes")
			]
		).toBe(4096);
	});

	it("separates upstream body waits from the client reading the body", async () => {
		const writeDataPoint = vi.fn();
		let chunks = 0;
		const upstreamBody = new ReadableStream<Uint8Array>(
			{
				async pull(controller) {
					if (chunks === 2) {
						controller.close();
						return;
					}
					chunks += 1;
					await new Promise((resolve) => setTimeout(resolve, 40));
					controller.enqueue(new Uint8Array(512));
				},
			},
			{ highWaterMark: 0 }
		);
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(upstreamBody, {
					status: 200,
					headers: { "content-type": "image/png" },
				})
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			cloudflareRuntimeEvidence: {
				analytics: { writeDataPoint },
				workerEnvironment: "test",
			},
			request: new Request(
				"https://openmeld.test/v1/spaces/space-123/files/file-1/content"
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});
		const reader = (response.body as ReadableStream<Uint8Array>).getReader();
		for (;;) {
			const { done } = await reader.read();
			if (done) {
				break;
			}
			await new Promise((resolve) => setTimeout(resolve, 40));
		}

		expect(writeDataPoint).toHaveBeenCalledTimes(3);
		const durationIndex =
			OBSERVABILITY_CLOUDFLARE_ANALYTICS_DOUBLES.indexOf("durationMs");
		const [body, upstream] = [1, 2].map(
			(call) =>
				writeDataPoint.mock.calls[call]?.[0] as {
					blobs: string[];
					doubles: number[];
				}
		) as [
			{ blobs: string[]; doubles: number[] },
			{ blobs: string[]; doubles: number[] },
		];
		expect(readAnalyticsBlob(upstream, "event")).toBe(
			"web.openmeld.proxy_response_body_upstream"
		);
		const bodyMs = body.doubles[durationIndex] ?? 0;
		const upstreamMs = upstream.doubles[durationIndex] ?? 0;
		// Two 40 ms upstream waits, plus two 40 ms client pauses on top.
		expect(upstreamMs).toBeGreaterThanOrEqual(70);
		expect(bodyMs - upstreamMs).toBeGreaterThanOrEqual(70);
	});

	it("records an upstream Space file body failure as failed, not cancelled", async () => {
		const writeDataPoint = vi.fn();
		const upstreamBody = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(1024));
			},
			pull(controller) {
				controller.error(new TypeError("upstream reset"));
			},
		});
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(upstreamBody, {
					status: 200,
					headers: { "content-type": "image/png" },
				})
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			cloudflareRuntimeEvidence: {
				analytics: { writeDataPoint },
				workerEnvironment: "test",
			},
			request: new Request(
				"https://openmeld.test/v1/spaces/space-123/attachments/attachment-1"
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		await expect(response.arrayBuffer()).rejects.toThrow("upstream reset");
		expect(writeDataPoint).toHaveBeenCalledTimes(3);
		const point = writeDataPoint.mock.calls[1]?.[0] as { blobs: string[] };
		expect(readAnalyticsBlob(point, "reasonCode")).toBe("body_failed");
	});

	it("records a client that stops reading a Space file body as cancelled", async () => {
		const writeDataPoint = vi.fn();
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(new Uint8Array(4096), {
					status: 200,
					headers: { "content-type": "image/png" },
				})
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			cloudflareRuntimeEvidence: {
				analytics: { writeDataPoint },
				workerEnvironment: "test",
			},
			request: new Request(
				"https://openmeld.test/v1/spaces/space-123/files/file-1/content"
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: fetchMock,
		});

		await response.body?.cancel();
		expect(writeDataPoint).toHaveBeenCalledTimes(3);
		const point = writeDataPoint.mock.calls[1]?.[0] as { blobs: string[] };
		expect(readAnalyticsBlob(point, "reasonCode")).toBe("body_cancelled");
	});

	it("classifies real protected space password challenges as missing protected access", async () => {
		const writeDataPoint = vi.fn();
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						ok: false,
						error: {
							code: "space.password_required",
							message: "Space password required.",
							requestId: "gateway-password-required",
						},
					}),
					{
						status: 403,
						headers: {
							"content-type": "application/json",
							"x-openmeld-request-id": "gateway-password-required",
						},
					}
				)
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			cloudflareRuntimeEvidence: {
				analytics: { writeDataPoint },
				workerEnvironment: "test",
			},
			request: new Request("https://openmeld.test/v1/spaces/space-123/status"),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			spaceAccessCookieSecret: "secret-value",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(403);
		expect(writeDataPoint).toHaveBeenCalledOnce();
		const point = writeDataPoint.mock.calls[0]?.[0] as {
			blobs: string[];
		};
		expect(readAnalyticsBlob(point, "reasonCode")).toBe(
			"web_proxy.protected_space_access_missing"
		);
		expect(readAnalyticsBlob(point, "requestId")).toBe(
			"gateway-password-required"
		);
	});

	it("preserves non-text upstream bodies when clearing a protected space cookie", async () => {
		const cookieValue = await encodeProtectedSpaceAccessCookieValue({
			spaceId: "space-123",
			password: "secret-pass",
			secret: "secret-value",
		});
		const upstreamBytes = Uint8Array.from([0x00, 0x7f, 0x80, 0xff, 0x41]);
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(
				new Response(upstreamBytes, {
					status: 403,
					headers: {
						"content-type": "application/octet-stream",
					},
				})
			)
		);

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/spaces/space-123/status", {
				headers: {
					cookie: `openmeld_space_access_space-123=${cookieValue}`,
				},
			}),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			spaceAccessCookieSecret: "secret-value",
			fetchImpl: fetchMock,
		});

		expect(response.status).toBe(403);
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(upstreamBytes);
	});

	it("returns a structured upstream_unreachable error when the gateway fetch throws", async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new TypeError("fetch failed"));
		const consoleInfo = vi
			.spyOn(console, "info")
			.mockImplementation(() => undefined);

		try {
			const response = await proxyOpenMeldGatewayRequest({
				request: new Request(
					"https://openmeld.test/v1/spaces/space-123/status"
				),
				gatewayUrl: "https://gateway.openmeld.test",
				webAppUrl: "https://openmeld.test",
				fetchImpl: fetchMock,
			});

			expect(response.status).toBe(502);
			expect(response.headers.get("x-openmeld-request-id")).toMatch(
				UUID_HEADER_PATTERN
			);
			expect(response.headers.get(WEB_PROXY_REQUEST_ID_HEADER)).toMatch(
				UUID_HEADER_PATTERN
			);
			await expect(response.json()).resolves.toEqual({
				ok: false,
				error: {
					code: "upstream_unreachable",
					message:
						"OpenMeld couldn't reach the gateway upstream for this request.",
					requestId: expect.any(String),
				},
			});
		} finally {
			consoleInfo.mockRestore();
		}
	});

	it("uses the shared diagnostics wrapper for auth proxy failures too", async () => {
		const consoleInfo = vi
			.spyOn(console, "info")
			.mockImplementation(() => undefined);
		try {
			const response = await executeObservedWebProxyRequest({
				request: new Request("https://openmeld.test/api/auth/session"),
				proxyKind: "auth",
				execute: (diagnostics) => {
					diagnostics.setLastStage("build_upstream_url");
					diagnostics.setUpstreamUrl(
						"https://auth.openmeld.test/api/auth/session"
					);
					diagnostics.setLastStage("forward_upstream");
					throw new TypeError("fetch failed");
				},
			});

			expect(response.status).toBe(502);
			expect(response.headers.get("x-openmeld-request-id")).toMatch(
				UUID_HEADER_PATTERN
			);
			expect(response.headers.get(WEB_PROXY_REQUEST_ID_HEADER)).toMatch(
				UUID_HEADER_PATTERN
			);
			await expect(response.json()).resolves.toEqual({
				ok: false,
				error: {
					code: "upstream_unreachable",
					message:
						"OpenMeld couldn't reach the auth upstream for this request.",
					requestId: expect.any(String),
				},
			});
		} finally {
			consoleInfo.mockRestore();
		}
	});

	it("writes successful proxy runtime evidence through the shared Cloudflare projection", async () => {
		const writeDataPoint = vi.fn();
		const consoleInfo = vi
			.spyOn(console, "info")
			.mockImplementation(() => undefined);
		try {
			const requestBody = JSON.stringify({
				messageEnvelope: {
					activationTargets: ["agent-profile-123"],
				},
				meta: {
					clientMessageId: "client-message-123",
				},
			});
			const response = await executeObservedWebProxyRequest({
				cloudflareRuntimeEvidence: {
					analytics: { writeDataPoint },
					workerEnvironment: "test",
				},
				request: new Request(
					"https://openmeld.test/v1/spaces/space-123/signals",
					{
						body: requestBody,
						headers: {
							"cf-ray": "cf-ray-123",
							"content-length": String(requestBody.length),
							"content-type": "application/json",
							traceparent: `00-${TRACE_ID}-0123456789abcdef-01`,
						},
						method: "POST",
					}
				),
				proxyKind: "auth",
				execute: (diagnostics) => {
					diagnostics.setLastStage("build_upstream_url");
					diagnostics.setUpstreamUrl(
						"https://auth.openmeld.test/api/auth/session"
					);
					diagnostics.setUpstreamRequestId("auth-request-123");
					diagnostics.setLastStage("process_upstream_response");
					return Promise.resolve(
						new Response("ok", {
							status: 200,
							headers: {
								"x-request-id": "auth-response-123",
							},
						})
					);
				},
			});

			expect(response.status).toBe(200);
			expect(consoleInfo).not.toHaveBeenCalled();
			expect(writeDataPoint).toHaveBeenCalledOnce();
			const point = writeDataPoint.mock.calls[0]?.[0] as {
				blobs: string[];
				doubles: number[];
				indexes: string[];
			};
			expect(readAnalyticsBlob(point, "event")).toBe(
				"web.openmeld.proxy_request"
			);
			expect(readAnalyticsBlob(point, "workerName")).toBe("openmeld-web");
			expect(readAnalyticsBlob(point, "runtimeKind")).toBe("http");
			expect(readAnalyticsBlob(point, "status")).toBe("succeeded");
			expect(readAnalyticsBlob(point, "spaceId")).toBe("space-123");
			expect(readAnalyticsBlob(point, "clientMessageId")).toBe(
				"client-message-123"
			);
			expect(readAnalyticsBlob(point, "targetProfileId")).toBe(
				"agent-profile-123"
			);
			expect(readAnalyticsBlob(point, "requestId")).toBe("auth-response-123");
			expect(point.doubles[2]).toBe(200);
			expect(point.indexes).toEqual(["client-message-123"]);
		} finally {
			consoleInfo.mockRestore();
		}
	});

	it("does not parse oversized proxy request bodies for runtime evidence correlation", async () => {
		const writeDataPoint = vi.fn();
		const consoleInfo = vi
			.spyOn(console, "info")
			.mockImplementation(() => undefined);
		try {
			const requestBody = JSON.stringify({
				messageEnvelope: {
					activationTargets: ["agent-profile-oversized"],
				},
				meta: {
					clientMessageId: "client-message-oversized",
				},
				padding: "x".repeat(17 * 1024),
			});
			const response = await executeObservedWebProxyRequest({
				cloudflareRuntimeEvidence: {
					analytics: { writeDataPoint },
					workerEnvironment: "test",
				},
				request: new Request(
					"https://openmeld.test/v1/spaces/space-123/signals",
					{
						body: requestBody,
						headers: {
							"content-length": String(requestBody.length),
							"content-type": "application/json",
						},
						method: "POST",
					}
				),
				proxyKind: "openmeld_gateway",
				execute: (diagnostics) => {
					diagnostics.setLastStage("process_upstream_response");
					return Promise.resolve(new Response("ok", { status: 200 }));
				},
			});

			expect(response.status).toBe(200);
			expect(consoleInfo).not.toHaveBeenCalled();
			expect(writeDataPoint).toHaveBeenCalledOnce();
			const point = writeDataPoint.mock.calls[0]?.[0] as {
				blobs: string[];
				indexes: string[];
			};
			expect(readAnalyticsBlob(point, "spaceId")).toBe("space-123");
			expect(readAnalyticsBlob(point, "clientMessageId")).toBe("");
			expect(readAnalyticsBlob(point, "targetProfileId")).toBe("");
			expect(point.indexes).toEqual([readAnalyticsBlob(point, "requestId")]);
		} finally {
			consoleInfo.mockRestore();
		}
	});

	it("logs failed proxy runtime evidence without ad hoc proxy payload fields", async () => {
		const writeDataPoint = vi.fn();
		const consoleInfo = vi
			.spyOn(console, "info")
			.mockImplementation(() => undefined);
		try {
			const response = await executeObservedWebProxyRequest({
				cloudflareRuntimeEvidence: {
					analytics: { writeDataPoint },
					workerEnvironment: "test",
				},
				request: new Request("https://openmeld.test/api/auth/session"),
				proxyKind: "auth",
				execute: (diagnostics) => {
					diagnostics.setLastStage("build_upstream_url");
					diagnostics.setUpstreamUrl(
						"https://auth.openmeld.test/api/auth/session"
					);
					diagnostics.setLastStage("forward_upstream");
					throw new TypeError("fetch failed");
				},
			});

			expect(response.status).toBe(502);
			expect(consoleInfo).toHaveBeenCalledOnce();
			const record = consoleInfo.mock.calls[0]?.[0] as Record<string, unknown>;
			expect(record.event).toBe("web.openmeld.proxy_request");
			expect(record.workerName).toBe("openmeld-web");
			expect(record.runtimeKind).toBe("http");
			expect(record.status).toBe("failed");
			expect(record.operation).toBe("auth.forward_upstream");
			expect(record.statusCode).toBe(502);
			expect(record.reasonCode).toBe("web_proxy.upstream_unreachable");
			expect(record.errorName).toBe("TypeError");
			expect(record).not.toHaveProperty("upstreamUrl");
			expect(record).not.toHaveProperty("failureStage");
			expect(writeDataPoint).toHaveBeenCalledOnce();
		} finally {
			consoleInfo.mockRestore();
		}
	});
});

function readAnalyticsBlob(
	point: { blobs: string[] },
	key: (typeof OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS)[number]
): string {
	const index = OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS.indexOf(key);
	if (index < 0) {
		throw new Error(`Unknown Analytics Engine blob key: ${key}`);
	}
	return point.blobs[index] ?? "";
}

describe("OpenMeld gateway proxy over the Gateway Service Binding", () => {
	type ServiceBindingCall = {
		url: string;
		method: string | undefined;
		redirect: RequestRedirect | undefined;
		headers: Headers;
		text: () => Promise<string>;
	};
	function createServiceBinding(
		respond: (call: ServiceBindingCall) => Response | Promise<Response>
	) {
		const requests: ServiceBindingCall[] = [];
		const binding: OpenMeldGatewayServiceBinding = {
			fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const call: ServiceBindingCall = {
					url: String(input),
					method: init?.method,
					redirect: init?.redirect,
					headers: new Headers(init?.headers),
					text: () => new Response(init?.body ?? null).text(),
				};
				requests.push(call);
				return await respond(call);
			}),
		};
		return { binding, requests };
	}

	it("sends the same URL, method, allowlisted headers, cookie, and streamed body as the public path", async () => {
		const { binding, requests } = createServiceBinding(
			async (request) =>
				new Response(JSON.stringify({ echoed: await request.text() }), {
					status: 201,
					headers: {
						"content-type": "application/json",
						"x-openmeld-request-id": "gateway-request-1",
					},
				})
		);
		const publicFetch = vi.fn<typeof fetch>();

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request(
				"https://openmeld.test/v1/spaces/space-123/messages?view=full",
				{
					method: "POST",
					headers: {
						cookie: "session=abc; other=1",
						"content-type": "application/json",
						"cf-connecting-ip": "203.0.113.7",
						authorization: "Bearer forged",
						"x-forwarded-for": "198.51.100.1",
					},
					body: JSON.stringify({ text: "hello" }),
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			fetchImpl: publicFetch,
			gatewayUpstream: createOpenMeldGatewayUpstream({
				serviceBinding: binding,
			}),
		});

		expect(publicFetch).not.toHaveBeenCalled();
		expect(requests).toHaveLength(1);
		const [upstream] = requests;
		expect(upstream?.url).toBe(
			"https://gateway.openmeld.test/v1/spaces/space-123/messages?view=full"
		);
		expect(upstream?.method).toBe("POST");
		expect(upstream?.redirect).toBe("manual");
		expect(upstream?.headers.get("cookie")).toBe("session=abc; other=1");
		expect(upstream?.headers.get("origin")).toBe("https://openmeld.test");
		expect(upstream?.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
		expect(upstream?.headers.get("authorization")).toBeNull();
		expect(upstream?.headers.get("x-forwarded-for")).toBeNull();
		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toEqual({
			echoed: JSON.stringify({ text: "hello" }),
		});
	});

	it("does not invent a client address when the inbound request has none", async () => {
		const { binding, requests } = createServiceBinding(
			() => new Response(null, { status: 204 })
		);

		await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/spaces/space-123/status"),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			gatewayUpstream: createOpenMeldGatewayUpstream({
				serviceBinding: binding,
			}),
		});

		expect(requests[0]?.headers.get("cf-connecting-ip")).toBeNull();
	});

	it("never forwards a client address on the public-fetch fallback", async () => {
		const fetchMock = vi.fn<typeof fetch>(() =>
			Promise.resolve(new Response(null, { status: 204 }))
		);

		await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/spaces/space-123/status", {
				headers: { "cf-connecting-ip": "127.0.0.1" },
			}),
			gatewayUrl: "http://localhost:8080",
			webAppUrl: "http://localhost:3000",
			fetchImpl: fetchMock,
		});

		const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
		expect(headers.get("cf-connecting-ip")).toBeNull();
	});

	it("preserves upstream status, multiple set-cookie headers, redirects, and streamed bodies", async () => {
		const encoder = new TextEncoder();
		const { binding } = createServiceBinding(() => {
			const headers = new Headers({ location: "/v1/next" });
			headers.append("set-cookie", "a=1; Path=/; HttpOnly");
			headers.append("set-cookie", "b=2; Path=/; Secure");
			return new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(encoder.encode("part-1,"));
						controller.enqueue(encoder.encode("part-2"));
						controller.close();
					},
				}),
				{ status: 302, headers }
			);
		});

		const response = await proxyOpenMeldGatewayRequest({
			request: new Request("https://openmeld.test/v1/spaces/space-123/status"),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://openmeld.test",
			gatewayUpstream: createOpenMeldGatewayUpstream({
				serviceBinding: binding,
			}),
		});

		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe("/v1/next");
		expect(response.headers.getSetCookie()).toEqual([
			"a=1; Path=/; HttpOnly",
			"b=2; Path=/; Secure",
		]);
		expect(response.body).toBeInstanceOf(ReadableStream);
		await expect(response.text()).resolves.toBe("part-1,part-2");
	});

	it("maps a Service Binding failure to the structured upstream_unreachable error", async () => {
		const binding: OpenMeldGatewayServiceBinding = {
			fetch: vi.fn(() => Promise.reject(new Error("binding unavailable"))),
		};
		const consoleInfo = vi
			.spyOn(console, "info")
			.mockImplementation(() => undefined);

		try {
			const response = await proxyOpenMeldGatewayRequest({
				request: new Request(
					"https://openmeld.test/v1/spaces/space-123/status"
				),
				gatewayUrl: "https://gateway.openmeld.test",
				webAppUrl: "https://openmeld.test",
				gatewayUpstream: createOpenMeldGatewayUpstream({
					serviceBinding: binding,
				}),
			});

			expect(response.status).toBe(502);
			await expect(response.json()).resolves.toMatchObject({
				ok: false,
				error: { code: "upstream_unreachable" },
			});
		} finally {
			consoleInfo.mockRestore();
		}
	});

	it("uses the public fetch when the runtime declares no Gateway binding", async () => {
		const globalFetch = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(new Response(null, { status: 204 }));

		try {
			const response = await proxyOpenMeldGatewayRequest({
				request: new Request(
					"https://openmeld.test/v1/spaces/space-123/status"
				),
				gatewayUrl: "http://localhost:8080",
				webAppUrl: "http://localhost:3000",
			});

			expect(response.status).toBe(204);
			expect(String(globalFetch.mock.calls[0]?.[0])).toBe(
				"http://localhost:8080/v1/spaces/space-123/status"
			);
		} finally {
			globalFetch.mockRestore();
		}
	});
});
