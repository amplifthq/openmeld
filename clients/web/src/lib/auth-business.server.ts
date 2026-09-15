import { organizationActionErrorSchema } from "@openmeld/schemas";
import type { z } from "zod/v4";
import {
	buildDownstreamAuthProxyHeaders,
	proxyAuthOwnedRequest,
} from "./auth-proxy.server";
import { toAuthError } from "./auth-transport";

// Called only by fixed route handlers. The renderer never chooses an upstream
// endpoint. Preserve the original Origin and vendor cookies independently of JSON.
export async function authBusinessRequest<T>(input: {
	request: Request;
	upstreamPath: string;
	responseSchema: z.ZodType<T>;
	bodySchema?: z.ZodType;
	querySchema?: z.ZodType;
	project?: (value: unknown) => unknown;
}): Promise<Response> {
	let request = input.request;
	if (input.querySchema) {
		const parsed = input.querySchema.safeParse(
			Object.fromEntries(new URL(request.url).searchParams)
		);
		if (!parsed.success) {
			return businessError(
				400,
				"request.invalid",
				parsed.error.issues[0]?.message ?? "Invalid request."
			);
		}
	}
	if (input.bodySchema) {
		const parsed = input.bodySchema.safeParse(
			await request.json().catch(() => null)
		);
		if (!parsed.success) {
			return businessError(
				400,
				"request.invalid",
				parsed.error.issues[0]?.message ?? "Invalid request."
			);
		}
		const headers = new Headers(request.headers);
		headers.set("content-type", "application/json");
		request = new Request(request.url, {
			method: request.method,
			headers,
			body: JSON.stringify(parsed.data),
		});
	}
	const response = await proxyAuthOwnedRequest({
		request,
		upstreamPath: input.upstreamPath,
		preserveOrigin: true,
		preserveUnauthorizedStatus: true,
	});
	const headers = buildDownstreamAuthProxyHeaders(response.headers);
	headers.delete("location");
	headers.set("cache-control", "private, no-store");
	headers.set("content-type", "application/json");
	if (response.status >= 300 && response.status < 400) {
		return businessError(
			502,
			"response.redirect_refused",
			"The business request returned an unexpected redirect.",
			headers
		);
	}
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		const error = toAuthError(
			payload,
			"The request could not be completed.",
			response.status
		);
		return businessError(
			response.status,
			error.code ?? "request.failed",
			error.message ?? "The request could not be completed.",
			headers
		);
	}
	try {
		const parsed = input.responseSchema.safeParse(
			input.project ? input.project(payload) : payload
		);
		if (parsed.success) {
			return new Response(JSON.stringify(parsed.data), {
				status: response.status,
				headers,
			});
		}
	} catch {
		/* Invalid upstream business result; never return the vendor object. */
	}
	return businessError(
		502,
		"response.invalid",
		"The server returned an invalid business response.",
		headers
	);
}

function businessError(
	status: number,
	code: string,
	message: string,
	headers?: Headers
) {
	return Response.json(organizationActionErrorSchema.parse({ code, message }), {
		status,
		headers,
	});
}
