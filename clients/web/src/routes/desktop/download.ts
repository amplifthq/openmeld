import { env as cloudflareEnv } from "cloudflare:workers";
import type { DesktopReleasePlatform } from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { desktopDownloadRedirect } from "#/lib/desktop-download-redirect";
import {
	buildDesktopDownloadHeaders,
	parseDesktopCandidateSelector,
	parseDesktopPlatformSelector,
	readDesktopCandidateArtifact,
	readPromotedDesktopRelease,
	readWindowsInternalPreview,
} from "#/lib/desktop-release";

export async function downloadDesktopPreview(input: {
	includeBody: boolean;
	request: Request;
}): Promise<Response> {
	const selectors = new URL(input.request.url).searchParams.getAll("candidate");
	const platforms = new URL(input.request.url).searchParams.getAll("platform");
	let platform: DesktopReleasePlatform | undefined;
	try {
		parseDesktopCandidateSelector(
			selectors.length > 1 ? selectors : selectors[0]
		);
		platform = parseDesktopPlatformSelector(
			platforms.length > 1 ? platforms : platforms[0]
		);
	} catch {
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
		return await downloadCandidate(
			bucket,
			selectors[0],
			input.includeBody,
			platform
		);
	}
	return await downloadDefault(bucket, input.includeBody, platform);
}

async function downloadCandidate(
	bucket: R2Bucket,
	id: string,
	includeBody: boolean,
	platform?: DesktopReleasePlatform
) {
	try {
		let body: ReadableStream | null = null;
		const available = await readDesktopCandidateArtifact(
			bucket,
			id,
			async (key) => {
				if (!includeBody || cloudflareEnv.OPENMELD_DESKTOP_DOWNLOAD_ORIGIN) {
					return bucket.head(key);
				}
				const loaded = await bucket.get(key);
				body = loaded?.body ?? null;
				return loaded;
			},
			platform
		);
		if (!available) {
			return new Response("Desktop candidate not found.", {
				status: 404,
				headers: { "cache-control": "no-store" },
			});
		}
		const { candidate, artifact: object } = available;
		if (cloudflareEnv.OPENMELD_DESKTOP_DOWNLOAD_ORIGIN) {
			return desktopDownloadRedirect(
				cloudflareEnv.OPENMELD_DESKTOP_DOWNLOAD_ORIGIN,
				candidate.objectKey
			);
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

async function downloadDefault(
	bucket: R2Bucket,
	includeBody: boolean,
	platform?: DesktopReleasePlatform
) {
	let releaseManifest: Awaited<ReturnType<typeof readPromotedDesktopRelease>>;
	try {
		releaseManifest = await readPromotedDesktopRelease(bucket, platform);
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
		if (platform === "windows-x64") {
			const previewResponse = await downloadWindowsPreview(bucket, includeBody);
			if (previewResponse) {
				return previewResponse;
			}
		}
		return new Response("OpenMeld Desktop preview is not uploaded yet.", {
			headers: {
				"cache-control": "no-store",
				"content-type": "text/plain; charset=utf-8",
				"x-content-type-options": "nosniff",
			},
			status: 404,
		});
	}

	let body: ReadableStream | null = null;
	const object =
		includeBody && !cloudflareEnv.OPENMELD_DESKTOP_DOWNLOAD_ORIGIN
			? await bucket.get(releaseManifest.objectKey).then((loaded) => {
					body = loaded?.body ?? null;
					return loaded;
				})
			: await bucket.head(releaseManifest.objectKey);
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

	if (object.size !== releaseManifest.sizeBytes) {
		return new Response("Desktop artifact size mismatch.", {
			status: 503,
			headers: { "cache-control": "no-store" },
		});
	}
	if (cloudflareEnv.OPENMELD_DESKTOP_DOWNLOAD_ORIGIN) {
		return desktopDownloadRedirect(
			cloudflareEnv.OPENMELD_DESKTOP_DOWNLOAD_ORIGIN,
			releaseManifest.objectKey
		);
	}
	const headers = buildDesktopDownloadHeaders({
		artifactName: releaseManifest.artifactName,
		etag: object.httpEtag,
		sizeBytes: object.size,
	});
	headers.set("cache-control", "no-store");
	return new Response(body, { headers });
}

async function downloadWindowsPreview(bucket: R2Bucket, includeBody: boolean) {
	const preview = await readWindowsInternalPreview(bucket);
	if (!preview) {
		return null;
	}
	let body: ReadableStream | null = null;
	const object = includeBody
		? await bucket.get(preview.objectKey).then((loaded) => {
				body = loaded?.body ?? null;
				return loaded;
			})
		: await bucket.head(preview.objectKey);
	if (!object || object.size !== preview.sizeBytes) {
		return new Response("Windows preview artifact is unavailable.", {
			status: 503,
			headers: { "cache-control": "no-store" },
		});
	}
	const headers = buildDesktopDownloadHeaders({
		artifactName: preview.artifactName,
		etag: object.httpEtag,
		sizeBytes: object.size,
	});
	headers.set("cache-control", "no-store");
	return new Response(body, { headers });
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
