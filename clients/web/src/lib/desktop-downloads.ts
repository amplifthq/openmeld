import {
	desktopDownloadQuerySchema,
	desktopDownloadsSchema,
	desktopReleasePlatformSchema,
} from "@openmeld/schemas";
import { readAvailableDesktopRelease } from "./desktop-release";

export async function getDesktopDownloads(
	request: Request,
	store: Parameters<typeof readAvailableDesktopRelease>[0]
) {
	const search = new URL(request.url).searchParams;
	const selectors = ["candidate", "platform"] as const;
	const parsed = desktopDownloadQuerySchema.safeParse(
		Object.fromEntries(
			selectors.flatMap((key) =>
				search.has(key) ? [[key, search.get(key)]] : []
			)
		)
	);
	if (
		selectors.some((key) => search.getAll(key).length > 1) ||
		!parsed.success
	) {
		return new Response("Invalid Desktop download selector.", { status: 400 });
	}
	if (!store) {
		return new Response("Desktop release storage is unavailable.", {
			status: 503,
		});
	}
	try {
		const { candidate, platform } = parsed.data;
		const releases = candidate
			? [await readAvailableDesktopRelease(store, candidate, platform)]
			: await Promise.all(
					desktopReleasePlatformSchema.options.map((value) =>
						readAvailableDesktopRelease(store, undefined, value)
					)
				);
		return Response.json(
			desktopDownloadsSchema.parse({
				releases: releases.filter((release) => release !== null),
			}),
			{ headers: { "Cache-Control": "no-store" } }
		);
	} catch (error) {
		console.error("Unable to read Desktop releases.", error);
		return new Response("Unable to read Desktop releases.", { status: 503 });
	}
}
