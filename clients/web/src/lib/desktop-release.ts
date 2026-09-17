import {
	DESKTOP_PROMOTED_RELEASE_KEY,
	desktopCandidateIdSchema,
	desktopCandidateLocation,
	desktopCandidateManifestKey,
	desktopCandidateManifestSchema,
	desktopPromotedReleaseSchema,
	desktopUpdaterFeedSchema,
} from "@openmeld/schemas";

export function parseDesktopCandidateSelector(value: unknown) {
	return desktopCandidateIdSchema.optional().parse(value);
}

export async function readDesktopCandidateArtifact<T extends { size: number }>(
	store: DesktopReleaseManifestStore,
	id: string,
	loadArtifact: (key: string) => Promise<T | null>
) {
	const candidate = await readDesktopCandidate(store, id);
	if (!candidate) {
		return null;
	}
	const artifact = await loadArtifact(candidate.objectKey);
	if (!artifact) {
		return null;
	}
	if (artifact.size !== candidate.sizeBytes) {
		throw new Error("Desktop candidate size mismatch.");
	}
	return { candidate, artifact };
}

export async function readDesktopCandidate(
	store: DesktopReleaseManifestStore,
	candidate: string
) {
	const id = desktopCandidateIdSchema.safeParse(candidate);
	if (!id.success) {
		throw new Error("Invalid Desktop candidate selector.");
	}
	const object = await store.get(desktopCandidateManifestKey(id.data));
	if (!object) {
		return null;
	}
	const parsed = desktopCandidateManifestSchema.safeParse(await object.json());
	if (!parsed.success || parsed.data.sha256 !== id.data) {
		throw new Error("Invalid Desktop candidate metadata.");
	}
	return { ...parsed.data, ...desktopCandidateLocation(parsed.data) };
}

export const DESKTOP_DOWNLOAD_PAGE_PATH = "/desktop";
export const DESKTOP_DOWNLOAD_ROUTE_PATH = "/desktop/download";
export const DESKTOP_UPDATE_ROUTE_PATH = "/desktop/update.json";

export type DesktopUpdateManifest = {
	latestVersion: string;
	minimumSupportedVersion: string | null;
	downloadPageUrl: string;
	message: string | null;
	macosArm64: {
		url: string;
		version: string;
		sha256: string | null;
		sizeBytes: number | null;
	};
};

export type DesktopPreviewReleaseManifest = {
	latestVersion: string;
	minimumSupportedVersion: string | null;
	message: string | null;
	macosArm64: {
		artifactName: string;
		objectKey: string;
		version: string;
		sha256: string | null;
		sizeBytes: number | null;
	};
};

type DesktopReleaseManifestStore = {
	get: (key: string) => Promise<{ json: () => Promise<unknown> } | null>;
};

export async function readDesktopPreviewReleaseManifest(input: {
	store: DesktopReleaseManifestStore;
}): Promise<DesktopPreviewReleaseManifest | null> {
	const candidate = await readPromotedDesktopRelease(input.store);
	if (!candidate) {
		return null;
	}
	return {
		latestVersion: candidate.version,
		minimumSupportedVersion: null,
		message: null,
		macosArm64: {
			artifactName: candidate.artifactName,
			objectKey: candidate.objectKey,
			version: candidate.version,
			sha256: candidate.sha256,
			sizeBytes: candidate.sizeBytes,
		},
	};
}

export async function readPromotedDesktopRelease(
	store: DesktopReleaseManifestStore
) {
	const object = await store.get(DESKTOP_PROMOTED_RELEASE_KEY);
	if (!object) {
		return null;
	}
	const pointer = desktopPromotedReleaseSchema.parse(await object.json());
	const candidate = await readDesktopCandidate(store, pointer.candidate);
	if (!candidate?.zip) {
		throw new Error("Promoted Desktop release is incomplete.");
	}
	return { ...candidate, releaseDate: pointer.promotedAt };
}

export function buildDesktopUpdaterFeed(
	candidate: NonNullable<Awaited<ReturnType<typeof readPromotedDesktopRelease>>>
) {
	if (!candidate.zip) {
		throw new Error("Desktop release has no update ZIP.");
	}
	// JSON is a YAML subset. Every artifact URL is immutable and derived locally.
	return JSON.stringify(
		desktopUpdaterFeedSchema.parse({
			version: candidate.version,
			releaseDate: candidate.releaseDate,
			files: [
				{
					url: candidate.zipDownloadPath,
					sha512: candidate.zip.sha512,
					size: candidate.zip.sizeBytes,
				},
			],
			path: candidate.zipDownloadPath,
			sha512: candidate.zip.sha512,
		})
	);
}

// The page offers only artifacts present in the same store as the download route.
export async function readAvailableDesktopRelease(
	store:
		| (DesktopReleaseManifestStore & {
				head: (key: string) => Promise<{ size: number } | null>;
		  })
		| undefined,
	candidate?: string
): Promise<DesktopDownloadRelease | null> {
	const id = parseDesktopCandidateSelector(candidate);
	if (!store) {
		return null;
	}
	if (id !== undefined) {
		const available = await readDesktopCandidateArtifact(store, id, (key) =>
			store.head(key)
		);
		if (!available) {
			return null;
		}
		return {
			version: available.candidate.version,
			sizeBytes: available.candidate.sizeBytes,
			downloadPath: available.candidate.downloadPath,
			message: null,
		};
	}
	const release = await readDesktopPreviewReleaseManifest({ store });
	if (!release) {
		return null;
	}
	const artifact = await store.head(release.macosArm64.objectKey);
	return artifact && artifact.size === release.macosArm64.sizeBytes
		? {
				version: release.macosArm64.version,
				sizeBytes: release.macosArm64.sizeBytes,
				downloadPath: DESKTOP_DOWNLOAD_ROUTE_PATH,
				message: release.message,
			}
		: null;
}

export type DesktopDownloadRelease = {
	version: string;
	sizeBytes: number | null;
	downloadPath: string;
	message: string | null;
};

export function buildAbsoluteDesktopUrl(input: {
	origin: string;
	pathname: string;
}): string {
	const url = new URL(input.pathname, input.origin);
	return url.toString();
}

export function buildDesktopUpdateManifest(input: {
	origin: string;
	releaseManifest: DesktopPreviewReleaseManifest;
}): DesktopUpdateManifest {
	return {
		latestVersion: input.releaseManifest.latestVersion,
		minimumSupportedVersion: input.releaseManifest.minimumSupportedVersion,
		downloadPageUrl: buildAbsoluteDesktopUrl({
			origin: input.origin,
			pathname: DESKTOP_DOWNLOAD_PAGE_PATH,
		}),
		message: input.releaseManifest.message,
		macosArm64: {
			url: buildAbsoluteDesktopUrl({
				origin: input.origin,
				pathname: DESKTOP_DOWNLOAD_ROUTE_PATH,
			}),
			version: input.releaseManifest.macosArm64.version,
			sha256: input.releaseManifest.macosArm64.sha256,
			sizeBytes: input.releaseManifest.macosArm64.sizeBytes,
		},
	};
}

export function buildDesktopReleaseOrigin(requestUrl: string): string {
	const url = new URL(requestUrl);
	return url.origin;
}

export function buildDesktopDownloadHeaders(input: {
	artifactName: string;
	etag?: string | null;
	sizeBytes?: number | null;
}): Headers {
	const headers = new Headers({
		"cache-control": "public, max-age=300",
		"content-disposition": `attachment; filename="${input.artifactName}"`,
		"content-type": "application/x-apple-diskimage",
		"x-content-type-options": "nosniff",
	});

	if (input.sizeBytes !== null && input.sizeBytes !== undefined) {
		headers.set("content-length", String(input.sizeBytes));
	}

	if (input.etag) {
		headers.set("etag", input.etag);
	}

	return headers;
}
