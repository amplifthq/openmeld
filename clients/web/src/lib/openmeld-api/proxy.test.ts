import {
	OPENMELD_HEADER_INBOX_ITEM_KIND_VERSION,
	OPENMELD_HEADER_INBOX_SOURCE_TARGET_VERSION,
} from "@openmeld/gateway-contract";
import {
	CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER,
	OBSERVABILITY_CLOUDFLARE_ANALYTICS_BLOBS,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { encodeProtectedSpaceAccessCookieValue } from "#/lib/spaces/protected-space-access.server";
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

	it("keeps only the browser allowlist and injects the web origin when missing", () => {
		const headers = buildOpenMeldGatewayUpstreamHeaders({
			requestHeaders: new Headers({
				accept: "application/json",
				"accept-language": "en-US",
				authorization: "Bearer secret",
				"cache-control": "no-cache",
				cookie: "session=abc",
				"if-none-match": '"etag-123"',
				host: "web.openmeld.test",
				[CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER]: "3",
				[OPENMELD_HEADER_SPACE_PASSWORD]: "  pw-123  ",
				"x-openmeld-active-organization-id": "forged-authority",
				"x-openmeld-unknown-client-contract": "forged-contract",
				"x-openmeld-profile-id": "forged-profile",
				"x-openmeld-requested-organization-slug": "amplift",
				"x-forwarded-for": "203.0.113.1",
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
		expect(
			headers.get(CENTER_AGENT_TASK_RESPONSE_CONTRACT_VERSION_HEADER)
		).toBe("3");
		expect(headers.get(OPENMELD_HEADER_SPACE_PASSWORD)).toBe("pw-123");
		expect(headers.get("x-openmeld-profile-id")).toBe("forged-profile");
		expect(headers.get("x-openmeld-active-organization-id")).toBeNull();
		expect(headers.get("x-openmeld-unknown-client-contract")).toBeNull();
		expect(headers.get("x-openmeld-requested-organization-slug")).toBe(
			"amplift"
		);
		expect(headers.get("x-forwarded-for")).toBeNull();
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
