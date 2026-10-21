import { env } from "cloudflare:workers";
import type { OpenMeldGatewayServiceBinding } from "./gateway-upstream";

/**
 * Returns the Gateway Service Binding declared by `env.stg` / `env.prod` in
 * `clients/web/wrangler.jsonc`, or null when the Web Worker should use the
 * public `OPENMELD_GATEWAY_URL` fetch.
 *
 * The Vite dev server never uses the binding, even under `CLOUDFLARE_ENV=prod`
 * (`dev:prod`): the bound Gateway Worker is not running in that local session,
 * so the public fetch keeps local development reaching the configured Gateway.
 */
export function readOpenMeldGatewayServiceBinding(): OpenMeldGatewayServiceBinding | null {
	if (import.meta.env.DEV) {
		return null;
	}
	return env.OPENMELD_GATEWAY_WORKER ?? null;
}
