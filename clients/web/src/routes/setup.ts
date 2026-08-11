import { createFileRoute } from "@tanstack/react-router";
import { getRequiredServerEnv, env as webEnv } from "#/env";
import {
	buildOpenMeldSetupBootstrapPowerShellScript,
	buildOpenMeldSetupBootstrapScript,
	resolveOpenMeldSetupBootstrapScriptConfig,
} from "#/lib/setup-bootstrap-script";

function textResponse(
	body: string,
	input?: {
		contentType?: string;
		status?: number;
	}
): Response {
	return new Response(body, {
		headers: {
			"Cache-Control": "no-store",
			"Content-Type": input?.contentType ?? "text/plain; charset=utf-8",
			"X-Content-Type-Options": "nosniff",
		},
		status: input?.status ?? 200,
	});
}

function setupBootstrapResponse(request: Request): Response {
	const requestUrl = new URL(request.url);
	const platform = requestUrl.searchParams.get("platform") ?? "posix";
	if (platform !== "posix" && platform !== "windows") {
		return textResponse("Unsupported OpenMeld setup platform.", {
			status: 400,
		});
	}

	const configResult = resolveOpenMeldSetupBootstrapScriptConfig({
		authUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
		binaryManifestUrl: webEnv.OPENMELD_CLI_BINARY_MANIFEST_URL,
		gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
		platform,
		requestUrl: request.url,
		webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
	});

	if (configResult.status === "error") {
		return textResponse(configResult.body, {
			status: configResult.statusCode,
		});
	}

	if (platform === "windows") {
		return textResponse(
			buildOpenMeldSetupBootstrapPowerShellScript(configResult.config),
			{
				contentType: "text/plain; charset=utf-8",
			}
		);
	}

	return textResponse(buildOpenMeldSetupBootstrapScript(configResult.config), {
		contentType: "text/x-shellscript; charset=utf-8",
	});
}

export const Route = createFileRoute("/setup")({
	server: {
		handlers: {
			GET: ({ request }) => setupBootstrapResponse(request),
		},
	},
});
