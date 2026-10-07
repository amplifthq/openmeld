import {
	type DesktopReleasePlatform,
	desktopCandidateIdSchema,
	desktopCandidateUpdateArtifact,
} from "@openmeld/schemas";
import { desktopDownloadRedirect } from "./desktop-download-redirect";
import {
	buildDesktopUpdaterFeed,
	readDesktopCandidate,
	readPromotedDesktopRelease,
} from "./desktop-release";

type Store = Pick<R2Bucket, "get" | "head">;

export async function desktopUpdateFeedResponse(
	bucket: Store | undefined,
	platform: DesktopReleasePlatform
) {
	const headers = {
		"cache-control": "no-store",
		"content-type": "application/yaml",
		"x-content-type-options": "nosniff",
	};
	try {
		if (!bucket) {
			return new Response("Downloads unavailable.", { status: 503, headers });
		}
		const release = await readPromotedDesktopRelease(bucket, platform);
		if (!release) {
			return new Response("No update is published.", { status: 404, headers });
		}
		const update = desktopCandidateUpdateArtifact(release);
		if (!update) {
			throw new Error("Incomplete Desktop update.");
		}
		const [installer, payload] = await Promise.all([
			bucket.head(release.objectKey),
			update.objectKey === release.objectKey
				? Promise.resolve(null)
				: bucket.head(update.objectKey),
		]);
		if (
			installer?.size !== release.sizeBytes ||
			(update.objectKey !== release.objectKey &&
				payload?.size !== update.sizeBytes)
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

export async function desktopUpdateArtifactResponse(
	bucket: Store | undefined,
	platform: DesktopReleasePlatform,
	candidate: string,
	includeBody: boolean,
	downloadOrigin?: string
) {
	const headers = new Headers({
		"cache-control": "no-store",
		"content-type":
			platform === "macos-arm64"
				? "application/zip"
				: "application/vnd.microsoft.portable-executable",
		"x-content-type-options": "nosniff",
	});
	if (!desktopCandidateIdSchema.safeParse(candidate).success) {
		return new Response("Invalid candidate.", { status: 400, headers });
	}
	try {
		if (!bucket) {
			return new Response(null, { status: 503, headers });
		}
		const release = await readDesktopCandidate(bucket, candidate);
		if (!release || release.platform !== platform) {
			return new Response(null, { status: 404, headers });
		}
		const update = desktopCandidateUpdateArtifact(release);
		if (!update) {
			return new Response(null, { status: 404, headers });
		}
		let body: ReadableStream | null = null;
		const artifact =
			includeBody && !downloadOrigin
				? await bucket.get(update.objectKey).then((loaded) => {
						body = loaded?.body ?? null;
						return loaded;
					})
				: await bucket.head(update.objectKey);
		if (!artifact) {
			return new Response(null, { status: 404, headers });
		}
		if (artifact.size !== update.sizeBytes) {
			throw new Error("Desktop update artifact size mismatch.");
		}
		if (downloadOrigin) {
			return desktopDownloadRedirect(downloadOrigin, update.objectKey);
		}
		headers.set("content-length", String(artifact.size));
		headers.set("cache-control", "public, max-age=31536000, immutable");
		return new Response(body, { headers });
	} catch (error) {
		console.error("Desktop update download unavailable.", error);
		return new Response(null, { status: 503, headers });
	}
}
