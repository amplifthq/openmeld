import {
	type DesktopReleasePlatform,
	desktopCandidateIdSchema,
	desktopCandidateLocation,
	desktopCandidateManifestKey,
	desktopCandidateManifestSchema,
	desktopCandidateUpdateArtifact,
	desktopPromotedReleaseKey,
	desktopPromotedReleaseSchema,
	desktopReleasePlatformSchema,
	desktopUpdaterFeedSchemaForPlatform,
} from "@openmeld/schemas";

export function parseDesktopCandidateSelector(value: unknown) {
	return desktopCandidateIdSchema.optional().parse(value);
}

export function parseDesktopPlatformSelector(value: unknown) {
	return desktopReleasePlatformSchema.optional().parse(value);
}

export async function readDesktopCandidateArtifact<T extends { size: number }>(
	store: DesktopReleaseManifestStore,
	id: string,
	loadArtifact: (key: string) => Promise<T | null>,
	platform?: DesktopReleasePlatform
) {
	const candidate = await readDesktopCandidate(store, id);
	if (!candidate || (platform && candidate.platform !== platform)) {
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
	store: DesktopReleaseManifestStore,
	platform: DesktopReleasePlatform = "macos-arm64"
) {
	const object = await store.get(desktopPromotedReleaseKey(platform));
	if (!object) {
		return null;
	}
	const pointer = desktopPromotedReleaseSchema.parse(await object.json());
	const candidate = await readDesktopCandidate(store, pointer.candidate);
	if (
		!candidate ||
		candidate.platform !== platform ||
		!desktopCandidateUpdateArtifact(candidate)
	) {
		throw new Error("Promoted Desktop release is incomplete.");
	}
	return { ...candidate, releaseDate: pointer.promotedAt };
}

export function buildDesktopUpdaterFeed(
	candidate: NonNullable<Awaited<ReturnType<typeof readPromotedDesktopRelease>>>
) {
	const artifact = desktopCandidateUpdateArtifact(candidate);
	if (!artifact) {
		throw new Error("Desktop release has no update artifact.");
	}
	// JSON is a YAML subset. Every artifact URL is immutable and derived locally.
	return JSON.stringify(
		desktopUpdaterFeedSchemaForPlatform(candidate.platform).parse({
			version: candidate.version,
			releaseDate: candidate.releaseDate,
			files: [
				{
					url: artifact.path,
					sha512: artifact.sha512,
					size: artifact.sizeBytes,
				},
			],
			path: artifact.path,
			sha512: artifact.sha512,
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
	candidate?: string,
	platform?: DesktopReleasePlatform
): Promise<DesktopDownloadRelease | null> {
	const id = parseDesktopCandidateSelector(candidate);
	if (!store) {
		return null;
	}
	if (id !== undefined) {
		const available = await readDesktopCandidateArtifact(store, id, (key) =>
			store.head(key)
		);
		if (!available || (platform && available.candidate.platform !== platform)) {
			return null;
		}
		return {
			platform: available.candidate.platform,
			version: available.candidate.version,
			sizeBytes: available.candidate.sizeBytes,
			downloadPath: available.candidate.downloadPath,
			message: null,
		};
	}
	const release = await readPromotedDesktopRelease(store, platform);
	if (!release) {
		return null;
	}
	const artifact = await store.head(release.objectKey);
	return artifact && artifact.size === release.sizeBytes
		? {
				platform: release.platform,
				version: release.version,
				sizeBytes: release.sizeBytes,
				downloadPath:
					release.platform === "macos-arm64"
						? DESKTOP_DOWNLOAD_ROUTE_PATH
						: `${DESKTOP_DOWNLOAD_ROUTE_PATH}?platform=${release.platform}`,
				message: null,
			}
		: null;
}

export type DesktopDownloadRelease = {
	platform: DesktopReleasePlatform;
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
		"content-type": input.artifactName.endsWith(".exe")
			? "application/vnd.microsoft.portable-executable"
			: "application/x-apple-diskimage",
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
