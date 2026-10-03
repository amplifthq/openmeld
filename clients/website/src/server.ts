import { env } from "cloudflare:workers";
import handler from "@tanstack/react-start/server-entry";
import { routeAppRequest } from "./lib/app-routing";

export default {
	fetch: ((request, ...options) =>
		routeAppRequest(request, env) ??
		handler.fetch(request, ...options)) satisfies typeof handler.fetch,
};
