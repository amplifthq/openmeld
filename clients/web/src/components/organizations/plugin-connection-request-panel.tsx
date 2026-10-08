"use client";

import {
	findPluginDefinition,
	pluginFromProvider,
} from "@openmeld/product-catalog/plugins";
import { pluginChannelRequestPreviewSchema } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { organizationPluginProviderCatalogQueryOptions } from "#/query/organizations/plugin-connections";
import { PluginConnectionSetupPanel } from "./plugin-connection-message-card";

/** This private request page reuses the same setup surface as Message UI.
 * Query parameters identify a request; the authenticated server owns identity,
 * Plugin/scope and destination. OAuth never triggers the continuation. */
export function PluginConnectionRequestPanel(input: {
	service: string;
	requestId: string;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const catalog = useQuery(
		organizationPluginProviderCatalogQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const provider = catalog.data?.providers.find(
		(item) => item.service === input.service
	);
	const plugin = provider
		? pluginFromProvider(provider)
		: findPluginDefinition(input.service);
	const preview = useQuery({
		queryKey: [
			"plugin-channel-request",
			currentOrganization.id,
			currentUserId,
			input.requestId,
		],
		gcTime: 0,
		staleTime: 0,
		retry: false,
		refetchOnMount: "always" as const,
		queryFn: () =>
			createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: currentOrganization.id,
			}).requestJson({
				operation: "plugin.channel.preview",
				method: "POST",
				url: `/v1/organizations/current/plugins/connection-requests/preview?expectedOrganizationId=${encodeURIComponent(currentOrganization.id)}`,
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ requestId: input.requestId }),
				schema: pluginChannelRequestPreviewSchema,
				invalidMessage: "This setup request could not be verified.",
			}),
	});
	if (preview.isPending || (!plugin && catalog.isPending)) {
		return <output>Checking the original request…</output>;
	}
	if (
		preview.isError ||
		plugin?.availability !== "available" ||
		preview.data?.service !== input.service
	) {
		return (
			<div className="space-y-3">
				<p role="alert">
					{preview.error?.message ??
						"This link does not match the original request. Open it from the original conversation using the same OpenMeld account."}
				</p>
				<Button onClick={() => preview.refetch()} variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	const target = {
		kind: "plugin_connection" as const,
		service: plugin.service,
		scope: preview.data.selection ?? preview.data.scope,
	};
	return (
		<section className="mx-auto w-full max-w-2xl space-y-4">
			<h1 className="font-semibold text-xl">
				Connect {plugin.name} and continue
			</h1>
			<p className="text-muted-foreground text-sm">
				{preview.data.targetProfileName} will continue in the original{" "}
				{
					{ slack: "Slack", feishu: "Feishu", lark: "Lark" }[
						preview.data.provider
					]
				}{" "}
				conversation only after you choose Continue. Connecting does not grant
				new Agent permissions.
			</p>
			<PluginConnectionSetupPanel
				continuation={{ channelRequestId: input.requestId }}
				currentUserId={currentUserId}
				key={`${currentOrganization.id}:${currentUserId}:${input.requestId}:${target.scope}`}
				organization={currentOrganization}
				plugin={plugin}
				target={target}
			/>
		</section>
	);
}
