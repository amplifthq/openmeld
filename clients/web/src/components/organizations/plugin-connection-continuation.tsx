import {
	type PluginConnectionContinuationBody,
	pluginConnectionContinuationResponseSchema,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export type PluginConnectionContinuationContext = {
	spaceId: string;
	sourceSignalId: string;
};

export function PluginConnectionContinuation(
	input: PluginConnectionContinuationContext & {
		organizationId: string;
		service: PluginConnectionContinuationBody["service"];
		scope: PluginConnectionContinuationBody["scope"];
		connected: boolean;
	}
) {
	const mutation = useMutation({
		retry: false,
		mutationFn: () =>
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: input.organizationId,
			}).requestJson({
				url: `/v1/spaces/${encodeURIComponent(input.spaceId)}/plugin-connection/continue`,
				operation: "plugin.connection.continue",
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					sourceSignalId: input.sourceSignalId,
					service: input.service,
					scope: input.scope,
				} satisfies PluginConnectionContinuationBody),
				schema: pluginConnectionContinuationResponseSchema,
				invalidMessage:
					"The task continuation could not be confirmed. Try again; it will not create another request.",
			}),
	});
	return (
		<div className="space-y-2 border-border/70 border-t py-3">
			{mutation.isSuccess ? (
				<output className="block text-sm">
					Continuation requested. The Agent will report its result in the
					original conversation.
				</output>
			) : (
				<>
					<Button
						disabled={!input.connected || mutation.isPending}
						onClick={() => mutation.mutate()}
						size="sm"
						type="button"
					>
						{mutation.isPending
							? "Requesting continuation…"
							: "Continue original task"}
					</Button>
					<p className="text-muted-foreground text-xs">
						Only the original requester can continue. Connecting an account does
						not automatically run the task.
					</p>
					{mutation.isError ? (
						<p className="text-destructive text-sm" role="alert">
							{mutation.error.message}
						</p>
					) : null}
				</>
			)}
		</div>
	);
}
