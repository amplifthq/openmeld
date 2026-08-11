import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv } from "../../env";

const WAITLIST_UPSTREAM_PATH = "/v1/waitlist";
const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"host",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

function buildUpstreamHeaders(requestHeaders: Headers): Headers {
	const headers = new Headers(requestHeaders);
	for (const headerName of HOP_BY_HOP_HEADERS) {
		headers.delete(headerName);
	}

	if (!headers.get("origin")) {
		headers.set("origin", getRequiredServerEnv("WEB_APP_URL"));
	}

	return headers;
}

async function proxyWaitlistRequest(request: Request): Promise<Response> {
	const upstreamUrl = new URL(getRequiredServerEnv("BETTER_AUTH_URL"));
	upstreamUrl.pathname = WAITLIST_UPSTREAM_PATH;

	const upstreamResponse = await fetch(upstreamUrl.toString(), {
		method: request.method.toUpperCase(),
		headers: buildUpstreamHeaders(request.headers),
		body: request.body,
		redirect: "manual",
	});

	return new Response(upstreamResponse.body, {
		headers: upstreamResponse.headers,
		status: upstreamResponse.status,
		statusText: upstreamResponse.statusText,
	});
}

export const Route = createFileRoute("/api/waitlist")({
	server: {
		handlers: {
			POST: ({ request }) => proxyWaitlistRequest(request),
		},
	},
});
