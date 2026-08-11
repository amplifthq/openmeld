import { SPACE_STREAM_KEEPALIVE_PONG } from "@openmeld/protocol";
import { gatewayErrorEnvelopeSchema } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildSpaceStreamHelloFrame,
	buildSpaceStreamUpstreamHeaders,
	buildSpaceStreamUpstreamUrl,
	proxySpaceLiveStreamRequest,
	resolveUpstreamSpaceLiveMessageDisposition,
} from "./live-stream.server";

describe("space live stream server helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("builds the canonical hello frame from the selected human profile", () => {
		expect(
			buildSpaceStreamHelloFrame({
				openMeldProfileId: "11111111-1111-1111-1111-111111111111",
				profileKind: "human",
				profileName: "Mira",
				ownerUserId: "user-mira",
			})
		).toBe(
			JSON.stringify({
				type: "hello",
				profile: {
					kind: "human",
					profileId: "11111111-1111-1111-1111-111111111111",
					profileName: "Mira",
				},
				capabilities: {
					liveSignalHistory: true,
				},
			})
		);
	});

	it("builds the canonical hello frame from the selected agent profile", () => {
		expect(
			buildSpaceStreamHelloFrame({
				openMeldProfileId: "agt_11111111-1111-1111-1111-111111111111",
				profileKind: "agent",
				profileName: "Codex",
				ownerUserId: "user-mira",
				ownerName: "Mira Owner",
			})
		).toBe(
			JSON.stringify({
				type: "hello",
				profile: {
					kind: "agent",
					profileId: "agt_11111111-1111-1111-1111-111111111111",
					profileName: "Codex",
					owner: "user-mira",
					ownerName: "Mira Owner",
				},
				capabilities: {
					liveSignalHistory: true,
				},
			})
		);
	});

	it("keeps the exact stream path and forwards cookie-backed protected access headers", () => {
		const headers = buildSpaceStreamUpstreamHeaders({
			requestHeaders: new Headers({
				cookie: "session=abc",
			}),
			webAppUrl: "https://app.openmeld.test",
			profileId: "profile-123",
			spacePassword: "  pw-123  ",
		});

		expect(
			buildSpaceStreamUpstreamUrl({
				gatewayUrl: "https://gateway.openmeld.test",
				requestUrl:
					"https://app.openmeld.test/v1/spaces/space-123/stream?profileId=profile-123",
			})
		).toBe(
			"https://gateway.openmeld.test/v1/spaces/space-123/stream?profileId=profile-123"
		);
		expect(headers.get("cookie")).toBe("session=abc");
		expect(headers.get("origin")).toBe("https://app.openmeld.test");
		expect(headers.get("x-openmeld-profile-id")).toBe("profile-123");
		expect(headers.get("x-openmeld-space-password")).toBe("pw-123");
	});

	it("fails closed when profileId is missing from the live stream request", async () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000124"
		);
		const fetchImpl = vi.fn();

		const response = await proxySpaceLiveStreamRequest({
			request: new Request(
				"https://app.openmeld.test/v1/spaces/space-123/stream",
				{
					headers: {
						upgrade: "websocket",
					},
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://app.openmeld.test",
			authBaseUrl: "https://auth.openmeld.test",
			fetchImpl,
		});

		expect(response.status).toBe(400);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(gatewayErrorEnvelopeSchema.parse(await response.json())).toEqual({
			ok: false,
			error: {
				code: "bad_request",
				message: "missing profileId",
				requestId: "00000000-0000-4000-8000-000000000124",
			},
		});
	});

	it("forwards hello ack frames and signal envelopes", () => {
		expect(
			resolveUpstreamSpaceLiveMessageDisposition(
				JSON.stringify({
					type: "system.hello.ack",
					profile: {
						kind: "human",
						profileId: "11111111-1111-1111-1111-111111111111",
					},
				})
			)
		).toBe("forward");

		expect(
			resolveUpstreamSpaceLiveMessageDisposition(
				JSON.stringify({
					v: 1,
					id: "sig-1",
					spaceId: "space-123",
					ts: 10,
					profile: {
						kind: "human",
						profileId: "11111111-1111-1111-1111-111111111111",
						profileName: "Mira",
					},
					type: "signal.text",
					data: {
						text: "Hello",
					},
				})
			)
		).toBe("forward");

		expect(
			resolveUpstreamSpaceLiveMessageDisposition(new Uint8Array([1, 2, 3]))
		).toBe("unsupported");
	});

	it("forwards the transport keepalive pong sentinel end-to-end", () => {
		// The PONG must reach the browser so it can prove the full
		// browser -> proxy -> core chain is alive; swallowing it here would mask
		// a half-open upstream socket.
		expect(
			resolveUpstreamSpaceLiveMessageDisposition(SPACE_STREAM_KEEPALIVE_PONG)
		).toBe("forward");
	});

	it("returns a structured upstream error response when selected profile resolve fails", async () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000123"
		);
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const fetchImpl = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
			const url = input instanceof URL ? input.toString() : String(input);
			if (url === "https://auth.openmeld.test/v1/profiles/resolve") {
				expect(init?.body).toBe(
					JSON.stringify({
						openMeldProfileId: "profile-123",
					})
				);
				return Promise.resolve(
					new Response("auth unavailable", {
						status: 503,
						headers: {
							"content-type": "text/plain",
						},
					})
				);
			}

			throw new Error(`Unexpected fetch: ${url}`);
		});

		const response = await proxySpaceLiveStreamRequest({
			request: new Request(
				"https://app.openmeld.test/v1/spaces/space-123/stream?profileId=profile-123",
				{
					headers: {
						upgrade: "websocket",
					},
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://app.openmeld.test",
			authBaseUrl: "https://auth.openmeld.test",
			fetchImpl,
		});

		expect(response.status).toBe(502);
		expect(response.headers.get("x-openmeld-request-id")).toBe(
			"00000000-0000-4000-8000-000000000123"
		);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(gatewayErrorEnvelopeSchema.parse(await response.json())).toEqual({
			ok: false,
			error: {
				code: "upstream_error",
				message:
					"OpenMeld couldn't prepare the live stream for this space right now.",
				requestId: "00000000-0000-4000-8000-000000000123",
			},
		});
		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
	});

	it("proxies an agent profile stream using the resolved agent identity", async () => {
		vi.stubGlobal(
			"Response",
			createWorkerCompatibleResponseConstructor() as unknown as typeof Response
		);
		const upstreamPair = createTestWebSocketPair();
		vi.stubGlobal(
			"WebSocketPair",
			TestWebSocketPair as unknown as typeof WebSocketPair
		);
		const fetchImpl = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
			const url = input instanceof URL ? input.toString() : String(input);
			if (url === "https://auth.openmeld.test/v1/profiles/resolve") {
				expect(init?.body).toBe(
					JSON.stringify({
						openMeldProfileId: "agt_11111111-1111-1111-1111-111111111111",
					})
				);
				return Promise.resolve(
					Response.json({
						ok: true,
						profile: createResolvedAgentProfileFixture(),
					})
				);
			}
			if (
				url ===
				"https://gateway.openmeld.test/v1/spaces/space-123/stream?profileId=agt_11111111-1111-1111-1111-111111111111"
			) {
				return Promise.resolve({
					status: 101,
					headers: new Headers(),
					statusText: "Switching Protocols",
					body: null,
					webSocket: upstreamPair.client,
				} as Response & { webSocket?: TestWebSocket });
			}

			throw new Error(`Unexpected fetch: ${url}`);
		});

		const response = (await proxySpaceLiveStreamRequest({
			request: new Request(
				"https://app.openmeld.test/v1/spaces/space-123/stream?profileId=agt_11111111-1111-1111-1111-111111111111",
				{
					headers: {
						upgrade: "websocket",
					},
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://app.openmeld.test",
			authBaseUrl: "https://auth.openmeld.test",
			fetchImpl,
		})) as Response & { webSocket?: TestWebSocket };

		expect(response.status).toBe(101);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(upstreamPair.server.receivedMessages).toContain(
			JSON.stringify({
				type: "hello",
				profile: {
					kind: "agent",
					profileId: "agt_11111111-1111-1111-1111-111111111111",
					profileName: "Codex",
					owner: "user-mira",
					ownerName: "Mira Owner",
				},
				capabilities: {
					liveSignalHistory: true,
				},
			})
		);
	});

	it("fails closed when the upstream websocket sends a non-text frame", async () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"00000000-0000-4000-8000-000000000456"
		);
		const consoleErrorSpy = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		vi.stubGlobal(
			"Response",
			createWorkerCompatibleResponseConstructor() as unknown as typeof Response
		);
		const upstreamPair = createTestWebSocketPair();
		vi.stubGlobal(
			"WebSocketPair",
			TestWebSocketPair as unknown as typeof WebSocketPair
		);

		const fetchImpl = vi.fn((input: URL | RequestInfo, init?: RequestInit) => {
			const url = input instanceof URL ? input.toString() : String(input);
			if (url === "https://auth.openmeld.test/v1/profiles/resolve") {
				expect(init?.body).toBe(
					JSON.stringify({
						openMeldProfileId: "profile-123",
					})
				);
				return Promise.resolve(
					Response.json({
						ok: true,
						profile: createResolvedHumanProfileFixture(),
					})
				);
			}
			if (
				url ===
				"https://gateway.openmeld.test/v1/spaces/space-123/stream?profileId=profile-123"
			) {
				return Promise.resolve({
					status: 101,
					headers: new Headers(),
					statusText: "Switching Protocols",
					body: null,
					webSocket: upstreamPair.client,
				} as Response & { webSocket?: TestWebSocket });
			}

			throw new Error(`Unexpected fetch: ${url}`);
		});

		const response = (await proxySpaceLiveStreamRequest({
			request: new Request(
				"https://app.openmeld.test/v1/spaces/space-123/stream?profileId=profile-123",
				{
					headers: {
						upgrade: "websocket",
					},
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://app.openmeld.test",
			authBaseUrl: "https://auth.openmeld.test",
			fetchImpl,
		})) as Response & { webSocket?: TestWebSocket };

		expect(response.status).toBe(101);
		expect(response.webSocket).toBeTruthy();
		const clientSocket = response.webSocket;
		if (!clientSocket) {
			throw new Error("Missing proxied client socket");
		}

		const closeEventPromise = waitForCloseEvent(clientSocket);

		upstreamPair.server.send(new Uint8Array([1, 2, 3]));

		await expect(closeEventPromise).resolves.toMatchObject({
			code: 1011,
			reason: "unsupported_upstream_frame",
		});
		expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
	});
});

type TestWebSocketEventMap = {
	close: { code: number; reason: string };
	error: Event;
	message: { data: unknown };
};

class TestWebSocket {
	peer: TestWebSocket | null = null;
	readonly receivedMessages: unknown[] = [];
	private readonly listeners: {
		[type in keyof TestWebSocketEventMap]?: ((
			event: TestWebSocketEventMap[type]
		) => void)[];
	} = {};
	private isClosed = false;

	accept() {
		// The test harness does not need any extra accept-time behavior.
	}

	addEventListener<TType extends keyof TestWebSocketEventMap>(
		type: TType,
		listener: (event: TestWebSocketEventMap[TType]) => void
	) {
		this.listeners[type] ??= [];
		this.listeners[type]?.push(listener);
	}

	send(data: unknown) {
		if (this.isClosed || !this.peer) {
			return;
		}
		this.peer.receivedMessages.push(data);
		this.peer.dispatch("message", {
			data,
		});
	}

	close(code = 1000, reason = "") {
		if (this.isClosed) {
			return;
		}
		this.isClosed = true;
		this.dispatch("close", {
			code,
			reason,
		});
		if (this.peer && !this.peer.isClosed) {
			this.peer.close(code, reason);
		}
	}

	private dispatch<TType extends keyof TestWebSocketEventMap>(
		type: TType,
		event: TestWebSocketEventMap[TType]
	) {
		for (const listener of this.listeners[type] ?? []) {
			listener(event);
		}
	}
}

class TestWebSocketPair extends Array<TestWebSocket> {
	constructor() {
		const pair = createTestWebSocketPair();
		super(pair.client, pair.server);
	}
}

function createTestWebSocketPair(): {
	client: TestWebSocket;
	server: TestWebSocket;
} {
	const client = new TestWebSocket();
	const server = new TestWebSocket();
	client.peer = server;
	server.peer = client;
	return {
		client,
		server,
	};
}

function waitForCloseEvent(socket: TestWebSocket): Promise<{
	code: number;
	reason: string;
}> {
	return new Promise((resolve) => {
		socket.addEventListener("close", (event) => {
			resolve({
				code: event.code,
				reason: event.reason,
			});
		});
	});
}

function createWorkerCompatibleResponseConstructor() {
	const RealResponse = Response;

	type WorkerCompatibleResponse = {
		body: BodyInit | null;
		headers: Headers;
		status: number;
		statusText: string;
		webSocket?: TestWebSocket;
	};

	function WorkerCompatibleResponse(
		this: WorkerCompatibleResponse,
		body?: BodyInit | null,
		init?: ResponseInit & { webSocket?: TestWebSocket }
	) {
		const status = init?.status ?? 200;
		if (status !== 101) {
			return new RealResponse(
				body,
				init
			) as unknown as WorkerCompatibleResponse;
		}

		this.body = body ?? null;
		this.headers = new Headers(init?.headers);
		this.status = 101;
		this.statusText = init?.statusText ?? "Switching Protocols";
		this.webSocket = init?.webSocket;
		return undefined;
	}

	WorkerCompatibleResponse.json = RealResponse.json.bind(RealResponse);
	return WorkerCompatibleResponse;
}

function createResolvedHumanProfileFixture() {
	return {
		openMeldProfileId: "11111111-1111-1111-1111-111111111111",
		profileKind: "human" as const,
		profileName: "Mira",
		profileHandle: "mira",
		isDefault: true,
		status: "active" as const,
		ownerUserId: "user-mira",
		source: "manual",
		createdByUserId: "user-mira",
		creatorProfileId: null,
		lastUsedAt: null,
		createdAt: "2026-04-14T07:00:00.000Z",
		updatedAt: "2026-04-14T08:00:00.000Z",
	};
}

function createResolvedAgentProfileFixture() {
	return {
		openMeldProfileId: "agt_11111111-1111-1111-1111-111111111111",
		profileKind: "agent" as const,
		profileName: "Codex",
		profileHandle: "codex",
		isDefault: false,
		status: "active" as const,
		ownerUserId: "user-mira",
		ownerName: "Mira Owner",
		source: "manual",
		createdByUserId: "user-mira",
		creatorProfileId: "11111111-1111-1111-1111-111111111111",
		lastUsedAt: null,
		createdAt: "2026-04-14T07:00:00.000Z",
		updatedAt: "2026-04-14T08:00:00.000Z",
	};
}
