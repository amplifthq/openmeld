import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import {
	createPrepareSessionRequestSchema,
	prepareSessionResponseSchema,
	prepareSessionWithTokenResponseSchema,
} from "@openmeld/schemas";
import type {
	CreatePrepareSessionRequest,
	PrepareSessionResponse,
	PrepareSessionWithTokenResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { baseQueryOptions } from "#/query/query-config";
import { startQueryKeys } from "#/query/query-keys";

const PREPARE_SESSIONS_PATH = "/v1/prepare/sessions";

export async function createPrepareSession(
	input: CreatePrepareSessionRequest
): Promise<PrepareSessionWithTokenResponse> {
	try {
		const body = requireValidCreatePrepareSessionRequest(input);
		return await createWebOpenMeldApiFoundation().requestJson({
			url: PREPARE_SESSIONS_PATH,
			operation: "prepare.session.create",
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify(body),
			schema: prepareSessionWithTokenResponseSchema,
			invalidMessage: "Invalid prepare session response.",
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function readPrepareSession(input: {
	prepareSessionId: string;
}): Promise<PrepareSessionResponse> {
	try {
		return await createWebOpenMeldApiFoundation().requestJson({
			url: buildPrepareSessionPath(input.prepareSessionId),
			operation: "prepare.session.read",
			method: "GET",
			schema: prepareSessionResponseSchema,
			invalidMessage: "Invalid prepare session response.",
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function prepareSessionQueryOptions(input: {
	enabled: boolean;
	prepareSessionId: string;
	storageScope: string;
}) {
	return queryOptions<PrepareSessionResponse, StructuredApiClientFailure>({
		queryKey: startQueryKeys.prepareSession(
			input.storageScope,
			input.prepareSessionId
		),
		queryFn: async () =>
			await readPrepareSession({
				prepareSessionId: input.prepareSessionId,
			}),
		enabled: input.enabled,
		gcTime: baseQueryOptions.gcTime,
		retry: baseQueryOptions.retry,
		staleTime: 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: false,
	});
}

export async function mintPrepareSessionToken(input: {
	prepareSessionId: string;
}): Promise<PrepareSessionWithTokenResponse> {
	try {
		return await createWebOpenMeldApiFoundation().requestJson({
			url: `${buildPrepareSessionPath(input.prepareSessionId)}/token`,
			operation: "prepare.session.token.mint",
			method: "POST",
			schema: prepareSessionWithTokenResponseSchema,
			invalidMessage: "Invalid prepare session token response.",
		});
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

function buildPrepareSessionPath(prepareSessionId: string): string {
	return `${PREPARE_SESSIONS_PATH}/${encodeURIComponent(prepareSessionId)}`;
}

function requireValidCreatePrepareSessionRequest(
	input: CreatePrepareSessionRequest
): CreatePrepareSessionRequest {
	const parsed = createPrepareSessionRequestSchema.safeParse(input);
	if (!parsed.success) {
		throw new Error(
			parsed.error.issues[0]?.message ?? "Invalid prepare session request body."
		);
	}
	return parsed.data;
}
