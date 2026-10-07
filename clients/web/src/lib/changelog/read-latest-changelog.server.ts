import {
	createFetchTransport,
	createOpenMeldApiClient,
} from "@openmeld/api-client";
import { changelogQueryResponseSchema } from "@openmeld/schemas";

// Product news is public production content in every application environment.
// Keep this anonymous server-side read independent of local account credentials.
export async function readProductionChangelog(fetchImpl: typeof fetch = fetch) {
	const client = createOpenMeldApiClient({
		baseUrl: "https://gateway.openmeld.ai",
		transport: createFetchTransport({ fetch: fetchImpl }),
	});
	const result = await client.requestJson({
		url: "/v1/changelog?limit=3",
		method: "GET",
		operation: "changelog.read",
		schema: changelogQueryResponseSchema,
		invalidMessage: "Invalid changelog response.",
		signal: AbortSignal.timeout(8000),
	});
	return result.entries.map(({ id, title, publishedAt }) => ({
		id,
		title,
		publishedAt,
	}));
}
