/**
 * How the Web Worker reaches the OpenMeld Gateway Worker.
 *
 * Deployed environments bind the Gateway Worker as a Service Binding
 * (`OPENMELD_GATEWAY_WORKER`), so a proxied API call stays inside Cloudflare
 * instead of re-entering the edge through the public Gateway hostname. Local
 * development has no binding and keeps the public fetch to
 * `OPENMELD_GATEWAY_URL`, which lets isolated lanes point at any local port.
 *
 * Both transports send the same request URL (the Gateway origin plus the
 * proxied path), so Gateway host-derived behavior is identical.
 */
export type OpenMeldGatewayUpstreamKind = "service_binding" | "public_fetch";

export type OpenMeldGatewayUpstream = {
	kind: OpenMeldGatewayUpstreamKind;
	fetch: typeof fetch;
};

export type OpenMeldGatewayServiceBinding = {
	fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

const CLIENT_ADDRESS_HEADER = "cf-connecting-ip";

export function createOpenMeldGatewayUpstream(input: {
	serviceBinding?: OpenMeldGatewayServiceBinding | null;
	fetchImpl?: typeof fetch;
}): OpenMeldGatewayUpstream {
	const serviceBinding = input.serviceBinding;
	if (serviceBinding) {
		return {
			kind: "service_binding",
			fetch: (resource, init) => serviceBinding.fetch(resource, init),
		};
	}
	const fetchImpl = input.fetchImpl;
	return {
		kind: "public_fetch",
		fetch: fetchImpl ?? ((resource, init) => fetch(resource, init)),
	};
}

/**
 * Resolves the Gateway transport for one request. An injected `upstream` or
 * `fetchImpl` wins (tests and explicit callers); otherwise the Worker runtime
 * binding decides.
 */
export async function resolveOpenMeldGatewayUpstream(input: {
	upstream?: OpenMeldGatewayUpstream;
	fetchImpl?: typeof fetch;
}): Promise<OpenMeldGatewayUpstream> {
	if (input.upstream) {
		return input.upstream;
	}
	if (input.fetchImpl) {
		return createOpenMeldGatewayUpstream({ fetchImpl: input.fetchImpl });
	}
	const { readOpenMeldGatewayServiceBinding } = await import(
		"./gateway-upstream.server"
	);
	return createOpenMeldGatewayUpstream({
		serviceBinding: readOpenMeldGatewayServiceBinding(),
	});
}

/**
 * Carries the browser's client address across a Service Binding.
 *
 * A public same-zone subrequest reaches the Gateway with an edge-assigned
 * `CF-Connecting-IP`; a Service Binding request skips the edge and would reach
 * the Gateway with none, which collapses IP-keyed rate limits (Space password,
 * feedback, anonymous reads) into one bucket. The value forwarded here is the
 * one Cloudflare's edge assigned to the Web Worker's own inbound request.
 * The Gateway's trust boundary does not change: public Gateway traffic still
 * has this header overwritten by the edge, and only Workers holding the
 * binding can send it unmodified.
 *
 * The public-fetch fallback never forwards it, so local development keeps its
 * current behavior.
 */
export function applyOpenMeldGatewayClientAddress(input: {
	upstream: OpenMeldGatewayUpstream;
	requestHeaders: Headers;
	upstreamHeaders: Headers;
}): void {
	if (input.upstream.kind !== "service_binding") {
		input.upstreamHeaders.delete(CLIENT_ADDRESS_HEADER);
		return;
	}
	const clientAddress = input.requestHeaders.get(CLIENT_ADDRESS_HEADER)?.trim();
	if (clientAddress) {
		input.upstreamHeaders.set(CLIENT_ADDRESS_HEADER, clientAddress);
		return;
	}
	input.upstreamHeaders.delete(CLIENT_ADDRESS_HEADER);
}

/** Copies the edge-assigned client address into a Web-built Gateway request. */
export function copyOpenMeldClientAddressHeader(input: {
	from: Headers;
	to: Headers;
}): void {
	const clientAddress = input.from.get(CLIENT_ADDRESS_HEADER)?.trim();
	if (clientAddress) {
		input.to.set(CLIENT_ADDRESS_HEADER, clientAddress);
	}
}
