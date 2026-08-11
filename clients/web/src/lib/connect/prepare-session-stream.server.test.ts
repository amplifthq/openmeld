import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyPrepareSessionStreamRequest } from "./prepare-session-stream.server";

describe("prepare session stream proxy", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	it("forwards an upstream snapshot sent during websocket accept", async () => {
		vi.stubGlobal(
			"Response",
			createWorkerCompatibleResponseConstructor() as unknown as typeof Response
		);
		const upstreamPair = createTestWebSocketPair();
		vi.stubGlobal(
			"WebSocketPair",
			TestWebSocketPair as unknown as typeof WebSocketPair
		);
		upstreamPair.client.onAccept = () => {
			upstreamPair.server.send("prepare-snapshot-frame");
		};

		const fetchImpl = vi.fn(
			async () =>
				({
					status: 101,
					headers: new Headers(),
					statusText: "Switching Protocols",
					body: null,
					webSocket: upstreamPair.client,
				}) as Response & { webSocket?: TestWebSocket }
		);

		const response = (await proxyPrepareSessionStreamRequest({
			request: new Request(
				"https://app.openmeld.test/v1/prepare/sessions/prep-123/stream?role=web",
				{
					headers: {
						upgrade: "websocket",
					},
				}
			),
			gatewayUrl: "https://gateway.openmeld.test",
			webAppUrl: "https://app.openmeld.test",
			fetchImpl,
		})) as Response & { webSocket?: TestWebSocket };

		expect(response.status).toBe(101);
		expect(response.webSocket?.receivedMessages).toContain(
			"prepare-snapshot-frame"
		);
	});
});

type TestWebSocketEventMap = {
	close: { code: number; reason: string };
	error: Event;
	message: { data: unknown };
};

class TestWebSocket {
	peer: TestWebSocket | null = null;
	onAccept: (() => void) | null = null;
	readonly receivedMessages: unknown[] = [];
	private readonly listeners: {
		[type in keyof TestWebSocketEventMap]?: ((
			event: TestWebSocketEventMap[type]
		) => void)[];
	} = {};
	private isClosed = false;

	accept() {
		this.onAccept?.();
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
