import { env as cloudflareEnv } from "cloudflare:workers";
import { desktopCandidateIdSchema } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import {
	buildDesktopDownloadHeaders,
	readDesktopCandidate,
	readDesktopPreviewReleaseManifest,
} from "#/lib/desktop-release";

export async function downloadDesktopPreview(input: {
	includeBody: boolean;
	request: Request;
}): Promise<Response> {
	const selectors = new URL(input.request.url).searchParams.getAll("candidate");
	if (
		selectors.length > 1 ||
		(selectors.length === 1 &&
			!desktopCandidateIdSchema.safeParse(selectors[0]).success)
	) {
		return new Response("Invalid Desktop candidate.", {
			status: 400,
			headers: { "cache-control": "no-store" },
		});
	}
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
	if (selectors.length === 1) {
		return await downloadCandidate(bucket, selectors[0], input.includeBody);
	}
	return await downloadDefault(bucket, input.includeBody);
}

async function downloadCandidate(
	bucket: R2Bucket,
	id: string,
	includeBody: boolean
) {
	try {
		const candidate = await readDesktopCandidate(bucket, id);
		if (!candidate) {
			return new Response("Desktop candidate not found.", {
				status: 404,
				headers: { "cache-control": "no-store" },
			});
		}
		let body: ReadableStream | null = null;
		let object: R2Object | null;
		if (includeBody) {
			const loaded = await bucket.get(candidate.objectKey);
			body = loaded?.body ?? null;
			object = loaded;
		} else {
			object = await bucket.head(candidate.objectKey);
		}
		if (!object) {
			return new Response("Desktop candidate not found.", {
				status: 404,
				headers: { "cache-control": "no-store" },
			});
		}
		if (object.size !== candidate.sizeBytes) {
			throw new Error("Desktop candidate size mismatch.");
		}
		const headers = buildDesktopDownloadHeaders({
			artifactName: candidate.artifactName,
			etag: object.httpEtag,
			sizeBytes: object.size,
		});
		headers.set("cache-control", "public, max-age=31536000, immutable");
		return new Response(body, {
			headers,
		});
	} catch (error) {
		console.error("Desktop candidate download failed.", error);
		return new Response("Desktop candidate metadata is invalid.", {
			status: 500,
			headers: { "cache-control": "no-store" },
		});
	}
}

async function downloadDefault(bucket: R2Bucket, includeBody: boolean) {
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

	return new Response(includeBody ? object.body : null, {
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
			GET: ({ request }) =>
				downloadDesktopPreview({ includeBody: true, request }),
			HEAD: ({ request }) =>
				downloadDesktopPreview({ includeBody: false, request }),
		},
	},
});
