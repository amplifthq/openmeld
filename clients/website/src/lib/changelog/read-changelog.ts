import { env } from "cloudflare:workers";
import { changelogQuerySchema } from "@openmeld/schemas";
import type {
	ChangelogQuery,
	ChangelogQueryResponse,
} from "@openmeld/schemas/types";
import { createServerFn } from "@tanstack/react-start";

function loadServerReader() {
	return import("./read-changelog.server");
}

export const readPublishedChangelog = createServerFn({ method: "GET" })
	.validator((data: unknown): ChangelogQuery => {
		const parsed = changelogQuerySchema.safeParse(data ?? {});
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ?? "Invalid Changelog query."
			);
		}
		return parsed.data;
	})
	.handler(async ({ data }): Promise<ChangelogQueryResponse> => {
		const { readChangelogFromGateway } = await loadServerReader();
		return await readChangelogFromGateway({
			gatewayUrl: env.OPENMELD_GATEWAY_URL,
			query: data,
		});
	});
