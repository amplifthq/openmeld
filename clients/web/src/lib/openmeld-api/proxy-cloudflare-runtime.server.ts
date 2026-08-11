import { env } from "cloudflare:workers";
import type { WebProxyCloudflareRuntimeEvidence } from "./proxy-observability";

export function readWebProxyCloudflareRuntimeEvidence(): WebProxyCloudflareRuntimeEvidence {
	return {
		analytics: env.OPENMELD_OBSERVABILITY,
		workerEnvironment: env.OPENMELD_WORKER_ENVIRONMENT,
	};
}
