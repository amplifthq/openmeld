import { env as cloudflareEnv } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildDesktopDownloadHeaders,
	readDesktopPreviewReleaseManifest,
} from "#/lib/desktop-release";

async function downloadDesktopPreview(input: {
	includeBody: boolean;
}): Promise<Response> {
	const bucket = cloudflareEnv.OPENMELD_DESKTOP_DOWNLOADS;
	if (!bucket) {
		return new Response("OpenMeld Desktop downloads are not configured.", {
			headers: {
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 503,
		});
	}

	let releaseManifest: Awaited<
		ReturnType<typeof readDesktopPreviewReleaseManifest>
	>;
	try {
		releaseManifest = await readDesktopPreviewReleaseManifest({
			store: bucket,
		});
	} catch (error) {
		console.error("Invalid OpenMeld Desktop preview release manifest.", error);
		return new Response("OpenMeld Desktop release metadata is invalid.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 500,
		});
	}

	if (!releaseManifest) {
		return new Response("OpenMeld Desktop preview is not uploaded yet.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 404,
		});
	}

	const object = await bucket.get(releaseManifest.macosArm64.objectKey);
	if (!object) {
		return new Response("OpenMeld Desktop preview artifact is missing.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 404,
		});
	}

	return new Response(input.includeBody ? object.body : null, {
		headers: buildDesktopDownloadHeaders({
			artifactName: releaseManifest.macosArm64.artifactName,
			etag: object.httpEtag,
			sizeBytes: object.size,
		}),
	});
}

export const Route = createFileRoute("/desktop/download")({
	server: {
		handlers: {
			GET: () => downloadDesktopPreview({ includeBody: true }),
			HEAD: () => downloadDesktopPreview({ includeBody: false }),
		},
	},
});
