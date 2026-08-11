import { z } from "zod/v4";

export const DESKTOP_DOWNLOAD_PAGE_PATH = "/desktop";
export const DESKTOP_DOWNLOAD_ROUTE_PATH = "/desktop/download";
export const DESKTOP_UPDATE_ROUTE_PATH = "/desktop/update.json";
export const DESKTOP_RELEASE_MANIFEST_R2_OBJECT_KEY = "desktop/update.json";

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

const desktopPreviewReleaseManifestSchema = z.object({
	latestVersion: z.string().trim().min(1),
	minimumSupportedVersion: z.string().trim().min(1).nullable().optional(),
	message: z.string().nullable().optional(),
	macosArm64: z.object({
		artifactName: z.string().trim().min(1),
		objectKey: z.string().trim().min(1),
		version: z.string().trim().min(1),
		sha256: z.string().trim().min(1).nullable().optional(),
		sizeBytes: z.number().int().nonnegative().nullable().optional(),
	}),
});

export function parseDesktopPreviewReleaseManifest(
	value: unknown
): DesktopPreviewReleaseManifest {
	const parsed = desktopPreviewReleaseManifestSchema.safeParse(value);
	if (!parsed.success) {
		throw new Error(
			`Invalid OpenMeld Desktop preview release manifest: ${parsed.error.message}`
		);
	}

	return {
		latestVersion: parsed.data.latestVersion,
		minimumSupportedVersion:
			parsed.data.minimumSupportedVersion ?? parsed.data.latestVersion,
		message: parsed.data.message ?? null,
		macosArm64: {
			artifactName: parsed.data.macosArm64.artifactName,
			objectKey: parsed.data.macosArm64.objectKey,
			version: parsed.data.macosArm64.version,
			sha256: parsed.data.macosArm64.sha256 ?? null,
			sizeBytes: parsed.data.macosArm64.sizeBytes ?? null,
		},
	};
}

export async function readDesktopPreviewReleaseManifest(input: {
	store: DesktopReleaseManifestStore;
}): Promise<DesktopPreviewReleaseManifest | null> {
	const object = await input.store.get(DESKTOP_RELEASE_MANIFEST_R2_OBJECT_KEY);
	if (!object) {
		return null;
	}

	return parseDesktopPreviewReleaseManifest(await object.json());
}

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
