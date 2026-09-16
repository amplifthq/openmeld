import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildDesktopUpdaterFeed,
	readPromotedDesktopRelease,
} from "#/lib/desktop-release";

export async function desktopUpdaterFeed() {
	const headers = {
		"cache-control": "no-store",
		"content-type": "application/yaml",
		"x-content-type-options": "nosniff",
	};
	try {
		const bucket = env.OPENMELD_DESKTOP_DOWNLOADS;
		if (!bucket) {
			return new Response("Downloads unavailable.", { status: 503, headers });
		}
		const release = await readPromotedDesktopRelease(bucket);
		if (!release) {
			return new Response("No update is published.", { status: 404, headers });
		}
		const [dmg, zip] = await Promise.all([
			bucket.head(release.objectKey),
			bucket.head(release.zipObjectKey),
		]);
		if (
			dmg?.size !== release.sizeBytes ||
			zip?.size !== release.zip?.sizeBytes
		) {
			throw new Error("Incomplete Desktop release.");
		}
		return new Response(buildDesktopUpdaterFeed(release), { headers });
	} catch (error) {
		console.error("Desktop update feed unavailable.", error);
		return new Response("Update metadata unavailable.", {
			status: 503,
			headers,
		});
	}
}
export const Route = createFileRoute("/desktop/updates/latest-mac.yml")({
	server: { handlers: { GET: desktopUpdaterFeed } },
});
