type AnalyticsEngineDataPoint = {
	blobs: string[];
	doubles: number[];
	indexes: string[];
};

type AnalyticsEngineDataset = {
	writeDataPoint: (point: AnalyticsEngineDataPoint) => void;
};

type R2ObjectBody = {
	body: ReadableStream | null;
	httpEtag?: string;
	size: number;
};

type R2Bucket = {
	get: (key: string) => Promise<R2ObjectBody | null>;
};

type WebCloudflareTestEnv = {
	OPENMELD_DESKTOP_DOWNLOADS: R2Bucket | null;
	OPENMELD_OBSERVABILITY: AnalyticsEngineDataset | null;
	OPENMELD_WORKER_ENVIRONMENT: string;
};

export const env: WebCloudflareTestEnv = {
	OPENMELD_DESKTOP_DOWNLOADS: null,
	OPENMELD_OBSERVABILITY: null,
	OPENMELD_WORKER_ENVIRONMENT: "test",
};

export function waitUntil(_promise: Promise<unknown>): void {
	// The promise still runs; unit tests do not need to extend a request lifetime.
}
