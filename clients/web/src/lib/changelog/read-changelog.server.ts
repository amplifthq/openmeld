import {
	createChangelogApi,
	createFetchTransport,
	createOpenMeldApiClient,
} from "@openmeld/api-client";
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
	return await createChangelogApi(client).readChangelog(input.query);
}
