import {
	desktopDownloadQuerySchema,
	desktopDownloadsSchema,
} from "@openmeld/schemas";
import { createServerFn } from "@tanstack/react-start";

export const readDesktopDownloads = createServerFn({ method: "GET" })
	.validator((input: unknown) => desktopDownloadQuerySchema.parse(input))
	.handler(async ({ data }) => {
		const { env } = await import("cloudflare:workers");
		if (!env.APP) {
			throw new Error("Desktop release service is unavailable.");
		}
		const url = new URL("/desktop/releases.json", env.APP_URL);
		for (const [key, value] of Object.entries(data)) {
			if (value !== undefined) {
				url.searchParams.set(key, value);
			}
		}
		const response = await env.APP.fetch(new Request(url));
		if (!response.ok) {
			throw new Error(`Desktop release service returned ${response.status}.`);
		}
		const parsed = desktopDownloadsSchema.safeParse(await response.json());
		if (!parsed.success) {
			throw new Error("Invalid Desktop release metadata.");
		}
		return parsed.data;
	});
