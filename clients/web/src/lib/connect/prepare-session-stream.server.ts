const PREPARE_SESSION_STREAM_ROUTE_PATTERN =
	/^\/v1\/prepare\/sessions\/([^/]+)\/stream$/u;

type AcceptableWebSocket = WebSocket & {
	accept(): void;
};

type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];

const createWebSocketPair = (): AcceptableWebSocketPair => {
	const WebSocketPairConstructor = (
		globalThis as typeof globalThis & {
			WebSocketPair: new () => AcceptableWebSocketPair;
		}
	).WebSocketPair;
	return new WebSocketPairConstructor();
};

export async function proxyPrepareSessionStreamRequest(input: {
	request: Request;
	gatewayUrl: string;
	webAppUrl: string;
	fetchImpl?: typeof fetch;
}): Promise<Response> {
	if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return Response.json(
			{
				code: "bad_request",
				message: "expected websocket",
			},
			{ status: 400 }
		);
	}

	const upstreamUrl = buildPrepareSessionStreamUpstreamUrl({
		gatewayUrl: input.gatewayUrl,
		requestUrl: input.request.url,
	});
	const upstreamResponse = await (input.fetchImpl ?? fetch)(upstreamUrl, {
		method: "GET",
		headers: buildPrepareSessionStreamUpstreamHeaders({
			requestHeaders: input.request.headers,
			webAppUrl: input.webAppUrl,
		}),
	});
	if (upstreamResponse.status !== 101) {
		return new Response(upstreamResponse.body, {
			headers: upstreamResponse.headers,
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
		});
	}

	const upstream = upstreamResponse.webSocket as AcceptableWebSocket | null;
	if (!upstream) {
		return Response.json(
			{
				code: "upstream_error",
				message: "upstream did not upgrade websocket",
			},
			{ status: 502 }
		);
	}

	const [client, server] = createWebSocketPair();

	let closed = false;
	const closeBoth = (code: number, reason: string) => {
		if (closed) {
			return;
		}
		closed = true;
		try {
			server.close(code, reason);
		} catch {
			// Ignore close races while the browser socket is already shutting down.
		}
		try {
			upstream.close(code, reason);
		} catch {
			// Ignore close races while the upstream socket is already shutting down.
		}
	};

	server.addEventListener("message", (event) => {
		try {
			upstream.send(event.data);
		} catch {
			closeBoth(1011, "upstream_send_failed");
		}
	});
	upstream.addEventListener("message", (event) => {
		try {
			server.send(event.data);
		} catch {
			closeBoth(1011, "client_send_failed");
		}
	});
	server.addEventListener("close", (event) => {
		closeBoth(event.code || 1000, event.reason || "client_closed");
	});
	upstream.addEventListener("close", (event) => {
		closeBoth(event.code || 1000, event.reason || "upstream_closed");
	});
	server.addEventListener("error", () => {
		closeBoth(1011, "client_error");
	});
	upstream.addEventListener("error", () => {
		closeBoth(1011, "upstream_error");
	});
	server.accept();
	upstream.accept();

	return new Response(null, {
		status: 101,
		webSocket: client,
	} as ResponseInit & { webSocket: WebSocket });
}

export function buildPrepareSessionStreamUpstreamUrl(input: {
	gatewayUrl: string;
	requestUrl: string;
}): string {
	const requestUrl = new URL(input.requestUrl);
	if (!PREPARE_SESSION_STREAM_ROUTE_PATTERN.test(requestUrl.pathname)) {
		throw new Error(
			`OpenMeld prepare stream proxy only supports prepare stream routes: ${requestUrl.pathname}`
		);
	}

	const upstreamUrl = new URL(input.gatewayUrl);
	upstreamUrl.pathname = requestUrl.pathname;
	upstreamUrl.search = requestUrl.search;
	return upstreamUrl.toString();
}

function buildPrepareSessionStreamUpstreamHeaders(input: {
	requestHeaders: Headers;
	webAppUrl: string;
}): Headers {
	const headers = new Headers({
		upgrade: "websocket",
	});
	const cookie = input.requestHeaders.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}
	headers.set("origin", input.requestHeaders.get("origin") ?? input.webAppUrl);
	return headers;
}
