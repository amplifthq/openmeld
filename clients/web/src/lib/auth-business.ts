import {
	OpenMeldApiClientHttpError,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import { organizationActionErrorSchema } from "@openmeld/schemas";
import type { z } from "zod/v4";
import { createUnscopedWebOpenMeldApiFoundation } from "./openmeld-api/client";
import { SessionExpiredError } from "./session-expired";

export class OrganizationRequestError extends Error {
	readonly code?: string;
	readonly status?: number;
	readonly upstreamCode?: string;
	constructor(input: { code?: string; message: string; status?: number }) {
		super(input.message);
		this.name = "OrganizationRequestError";
		this.code = input.code;
		this.upstreamCode = input.code;
		this.status = input.status;
	}
}

// Shared renderer transport; only business modules supply these fixed routes.
export async function requestAuthBusiness<T>(input: {
	path: string;
	method: "GET" | "POST" | "DELETE";
	schema: z.ZodType<T>;
	body?: unknown;
	client?: ReturnType<typeof createUnscopedWebOpenMeldApiFoundation>;
	profileSessionError?: boolean;
}): Promise<T> {
	try {
		return await (
			input.client ?? createUnscopedWebOpenMeldApiFoundation()
		).requestJson({
			url: input.path,
			method: input.method,
			operation: "auth.business",
			schema: input.schema,
			invalidMessage: "The server returned an invalid business response.",
			...(input.body === undefined
				? {}
				: {
						body: JSON.stringify(input.body),
						headers: { "content-type": "application/json" },
					}),
		});
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		const authError = organizationActionErrorSchema.safeParse(
			error instanceof OpenMeldApiClientHttpError
				? parseErrorBody(error.rawBody)
				: null
		);
		if (input.profileSessionError && failure.status === 401) {
			throw new SessionExpiredError({ upstreamCode: failure.upstreamCode });
		}
		throw new OrganizationRequestError({
			code: authError.success
				? authError.data.code
				: (failure.upstreamCode ?? failure.code ?? undefined),
			status: failure.status ?? undefined,
			message: authError.success ? authError.data.message : failure.message,
		});
	}
}

function parseErrorBody(body: string): unknown {
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}
