import {
	applyOpenMeldGatewayClientAddress,
	type OpenMeldGatewayUpstream,
	resolveOpenMeldGatewayUpstream,
} from "./gateway-upstream";

type AcceptableWebSocket = WebSocket & { accept(): void };
type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];

const createWebSocketPair = (): AcceptableWebSocketPair => {
	const WebSocketPairConstructor = (
		globalThis as typeof globalThis & {
			WebSocketPair: new () => AcceptableWebSocketPair;
		}
	).WebSocketPair;
	return new WebSocketPairConstructor();
};

/** Cookie-authenticated WebSocket forwarding shared by simple server routes. */
export async function proxySimpleWebSocketRequest(input: {
	request: Request;
	gatewayUrl: string;
	webAppUrl: string;
	pathPattern: RegExp;
	fetchImpl?: typeof fetch;
	gatewayUpstream?: OpenMeldGatewayUpstream;
}): Promise<Response> {
	if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
		return Response.json(
			{ code: "bad_request", message: "expected websocket" },
			{ status: 400 }
		);
	}
	const requestUrl = new URL(input.request.url);
	if (!input.pathPattern.test(requestUrl.pathname)) {
		throw new Error(`Unsupported WebSocket proxy path: ${requestUrl.pathname}`);
	}
	const upstreamUrl = new URL(input.gatewayUrl);
	upstreamUrl.pathname = requestUrl.pathname;
	upstreamUrl.search = requestUrl.search;
	const headers = new Headers({ upgrade: "websocket" });
	const cookie = input.request.headers.get("cookie");
	if (cookie) {
		headers.set("cookie", cookie);
	}
	headers.set("origin", input.request.headers.get("origin") ?? input.webAppUrl);
	const gatewayUpstream = await resolveOpenMeldGatewayUpstream({
		upstream: input.gatewayUpstream,
		fetchImpl: input.fetchImpl,
	});
	applyOpenMeldGatewayClientAddress({
		upstream: gatewayUpstream,
		requestHeaders: input.request.headers,
		upstreamHeaders: headers,
	});
	const response = await gatewayUpstream.fetch(upstreamUrl, {
		method: "GET",
		headers,
	});
	if (response.status !== 101) {
		return new Response(response.body, {
			headers: response.headers,
			status: response.status,
			statusText: response.statusText,
		});
	}
	const upstream = response.webSocket as AcceptableWebSocket | null;
	if (!upstream) {
		return Response.json(
			{ code: "upstream_error", message: "upstream did not upgrade websocket" },
			{ status: 502 }
		);
	}
	const [client, server] = createWebSocketPair();
	let closed = false;
	const close = (code: number, reason: string) => {
		if (closed) {
			return;
		}
		closed = true;
		try {
			server.close(code, reason);
		} catch {
			// The browser may already have closed.
		}
		try {
			upstream.close(code, reason);
		} catch {
			// The Gateway may already have closed.
		}
	};
	server.addEventListener("message", (event) => {
		try {
			upstream.send(event.data);
		} catch {
			close(1011, "upstream_send_failed");
		}
	});
	upstream.addEventListener("message", (event) => {
		try {
			server.send(event.data);
		} catch {
			close(1011, "client_send_failed");
		}
	});
	server.addEventListener("close", (event) =>
		close(event.code || 1000, event.reason || "client_closed")
	);
	upstream.addEventListener("close", (event) =>
		close(event.code || 1000, event.reason || "upstream_closed")
	);
	server.addEventListener("error", () => close(1011, "client_error"));
	upstream.addEventListener("error", () => close(1011, "upstream_error"));
	server.accept();
	upstream.accept();
	return new Response(null, {
		status: 101,
		webSocket: client,
	} as ResponseInit & { webSocket: WebSocket });
}
