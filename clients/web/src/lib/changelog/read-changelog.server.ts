import {
	createFetchTransport,
	createOpenMeldApiClient,
} from "@openmeld/api-client";
import { changelogQueryResponseSchema } from "@openmeld/schemas";
import type {
	ChangelogQuery,
	ChangelogQueryResponse,
} from "@openmeld/schemas/types";

export async function readChangelogFromGateway(input: {
	fetchImpl?: typeof fetch;
	gatewayUrl: string;
	query: ChangelogQuery;
}): Promise<ChangelogQueryResponse> {
	const fetchImpl =
		input.fetchImpl ??
		((request: RequestInfo | URL, init?: RequestInit) =>
			globalThis.fetch(request, init));
	const client = createOpenMeldApiClient({
		baseUrl: input.gatewayUrl,
		transport: createFetchTransport({ fetch: fetchImpl }),
	});
	return await client.requestJson({
		url: buildChangelogPath(input.query),
		operation: "changelog.read",
		method: "GET",
		schema: changelogQueryResponseSchema,
		invalidMessage: "invalid Changelog response",
	});
}

function buildChangelogPath(query: ChangelogQuery): string {
	const searchParams = new URLSearchParams();
	appendList(searchParams, "area", query.areas);
	appendList(searchParams, "audience", query.audiences);
	appendList(searchParams, "kind", query.kinds);
	if (query.limit !== undefined) {
		searchParams.set("limit", String(query.limit));
	}
	if (query.offset !== undefined) {
		searchParams.set("offset", String(query.offset));
	}
	if (query.release !== undefined) {
		searchParams.set("release", query.release);
	}
	if (query.since !== undefined) {
		searchParams.set("since", query.since);
	}

	const queryString = searchParams.toString();
	return queryString ? `/v1/changelog?${queryString}` : "/v1/changelog";
}

function appendList(
	searchParams: URLSearchParams,
	key: string,
	values: readonly string[] | undefined
): void {
	for (const value of values ?? []) {
		searchParams.append(key, value);
	}
}
