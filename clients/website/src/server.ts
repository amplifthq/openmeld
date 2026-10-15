import { env } from "cloudflare:workers";
import handler from "@tanstack/react-start/server-entry";
import { routeAppRequest } from "./lib/app-routing";

export default {
	fetch: (async (request, ...options) => {
		const appResponse = routeAppRequest(request, env);
		if (appResponse) {
			return appResponse;
		}
		const response = await handler.fetch(request, ...options);
		if (env.OPENMELD_WORKER_ENVIRONMENT === "prod") {
			return response;
		}
		// Preview pages must remain crawlable for this directive to be read.
		const previewResponse = new Response(response.body, response);
		previewResponse.headers.set("X-Robots-Tag", "noindex, nofollow");
		return previewResponse;
	}) satisfies typeof handler.fetch,
};
