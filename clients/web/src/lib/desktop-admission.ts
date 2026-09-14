import {
	DESKTOP_APP_ORIGIN,
	DESKTOP_CONTRACT_HEADER,
	DESKTOP_CONTRACT_VERSION,
	DESKTOP_WEB_BUILD_HEADER,
} from "@openmeld/schemas";

/** Representation admission only; each endpoint still owns authorization. */
export function admitDesktopRequest(
	request: Request,
	pilot: { enabled: boolean; webBuild: string }
): Response | null {
	if (request.headers.get("origin") !== DESKTOP_APP_ORIGIN) {
		return null;
	}
	const contract = request.headers.get(DESKTOP_CONTRACT_HEADER);
	if (contract !== null) {
		if (contract !== DESKTOP_CONTRACT_VERSION) {
			return new Response(
				"This Desktop version is not supported. Check for an app update.",
				{ status: 409, headers: { "cache-control": "no-store" } }
			);
		}
		if (!new URL(request.url).pathname.startsWith("/v1/")) {
			return new Response("Open this action in OpenMeld Web.", { status: 403 });
		}
		return null;
	}
	if (
		pilot.enabled &&
		request.headers.get(DESKTOP_WEB_BUILD_HEADER) === pilot.webBuild
	) {
		return null;
	}
	return new Response(
		"Desktop and Web versions do not match. Rebuild the Desktop pilot before continuing.",
		{ status: 409, headers: { "cache-control": "no-store" } }
	);
}
