// Existing installers, Desktop versions, and open browser tabs address these
// root-domain protocols. Web remains their only implementation and writer.
const APP_PROTOCOL_PATHS = new Set([
	"/setup",
	"/SKILL.md",
	"/guide.md",
	"/llms.txt",
	"/agent-interface/guide.md",
	"/api/waitlist",
	"/slack/oauth/start",
	"/slack/identity/start",
	"/manifest.json",
	"/manifest.webmanifest",
]);
const APP_PROTOCOL_PREFIXES = [
	"/api/auth/",
	"/v1/",
	"/cli/",
	"/desktop/",
	"/skills/openmeld-cli/",
];
const LEGACY_BROWSER_PREFIXES = ["/assets/", "/_serverFn/", "/emoji/"];
const APP_PAGES = new Set([
	"/accept-invitation",
	"/accept-space-invitation",
	"/add-to-slack",
	"/agent-interface",
	"/callback",
	"/check-email",
	"/desktop-shell",
	"/desktop-sign-in",
	"/device",
	"/device/approve",
	"/file-preview",
	"/forgot-password",
	"/invitation-requests",
	"/invitations",
	"/join-organization",
	"/link-message-channel",
	"/link-slack",
	"/login",
	"/logout",
	"/magic-link",
	"/reset-password",
	"/sign-up",
	"/slack/oauth/result",
	"/verify-email",
]);

export type AppRoutingEnvironment = {
	APP_URL: string;
	APP?: Pick<Fetcher, "fetch">;
	// Retire after the migration window; never forward arbitrary unknown routes.
	LEGACY_BROWSER_COMPATIBILITY?: string;
};

export function routeAppRequest(
	request: Request,
	environment: AppRoutingEnvironment
): Response | Promise<Response> | null {
	const url = new URL(request.url);
	const path = url.pathname;
	if (path === "/desktop" || path === "/desktop/") {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method not allowed", {
				status: 405,
				headers: { Allow: "GET, HEAD" },
			});
		}
		url.pathname = "/downloads";
		return new Response(null, {
			status: 307,
			headers: { Location: url.href, "Cache-Control": "no-store" },
		});
	}
	if (
		APP_PROTOCOL_PATHS.has(path) ||
		APP_PROTOCOL_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
		(environment.LEGACY_BROWSER_COMPATIBILITY === "true" &&
			LEGACY_BROWSER_PREFIXES.some((prefix) => path.startsWith(prefix)))
	) {
		if (!environment.APP) {
			return new Response("The App service binding is unavailable.", {
				status: 503,
			});
		}
		// Preserve URL, Origin, Referer, cookies, method, body, and streaming. The
		// fixed binding selects the receiver; no user input selects a fetch target.
		return environment.APP.fetch(request);
	}
	const pagePath = path.endsWith("/") ? path.slice(0, -1) : path;
	if (
		APP_PAGES.has(pagePath) ||
		path.startsWith("/o/") ||
		path.startsWith("/spaces/")
	) {
		if (request.method !== "GET" && request.method !== "HEAD") {
			return new Response("Method not allowed", {
				status: 405,
				headers: { Allow: "GET, HEAD" },
			});
		}
		const destination = new URL(environment.APP_URL);
		destination.pathname = path;
		destination.search = url.search;
		return new Response(null, {
			status: 307,
			headers: { Location: destination.href, "Cache-Control": "no-store" },
		});
	}
	return null;
}
