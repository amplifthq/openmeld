import { createFileRoute } from "@tanstack/react-router";
import { receiveApplicationError } from "#/lib/observability/application-error-server";

export const Route = createFileRoute("/v1/observability/application-errors")({
	server: {
		handlers: { POST: ({ request }) => receiveApplicationError(request) },
	},
});
