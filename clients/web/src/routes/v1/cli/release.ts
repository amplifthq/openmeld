import { createFileRoute } from "@tanstack/react-router";
import { getCliReleaseResponse } from "#/lib/release/cli-release.server";
export const Route = createFileRoute("/v1/cli/release")({
	server: { handlers: { GET: getCliReleaseResponse } },
});
