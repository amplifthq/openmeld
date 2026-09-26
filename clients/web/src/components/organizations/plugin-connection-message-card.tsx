"use client";

import type {
	NavigationAction,
	OpenMeldNavigationTarget,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DesktopAwareLink } from "#/desktop/desktop-aware-link";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import { organizationPluginServiceConnectionsQueryOptions } from "#/query/organizations/plugin-connections";
import { PluginAgentAccess } from "./plugin-agent-access";
import { findPluginDefinition, type PluginDefinition } from "./plugin-catalog";
import {
	PluginConnectionContinuation,
	type PluginConnectionContinuationContext,
} from "./plugin-connection-continuation";
import { PluginConnectionSurface } from "./plugin-connection-surface";

type PluginConnectionTarget = Extract<
	OpenMeldNavigationTarget,
	{ kind: "plugin_connection" }
>;

/** The message contains only intent. Current account, permissions and credentials stay outside it. */
export function PluginConnectionMessageCard(input: {
	action: NavigationAction & { target: PluginConnectionTarget };
	organizationSlug?: string;
	continuation?: PluginConnectionContinuationContext;
}) {
	const organization = useOptionalAppOrganization();
	const [open, setOpen] = useState(false);
	const plugin = findPluginDefinition(input.action.target.service);
	if (
		!organization ||
		organization.currentOrganization.slug !== input.organizationSlug ||
		plugin?.availability !== "available"
	) {
		return (
			<DesktopAwareLink href={input.action.url}>
				{input.action.label}
			</DesktopAwareLink>
		);
	}
	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={<Button size="sm" type="button" variant="outline" />}
			>
				Connect or review {plugin.name}
			</DialogTrigger>
			<DialogContent className="overflow-hidden" size="lg">
				<DialogHeader>
					<DialogTitle>{plugin.name} connection</DialogTitle>
					<DialogDescription>
						Set up access without leaving this conversation. Use the provider’s
						authorization window or the secure form below, never a chat message,
						to enter credentials.
					</DialogDescription>
				</DialogHeader>
				<ScrollArea className="max-h-[65dvh] min-h-0">
					{open ? (
						<PluginConnectionDialogBody
							continuation={input.continuation}
							currentUserId={organization.currentUserId}
							key={`${organization.currentOrganization.id}:${organization.currentUserId}:${plugin.service}:${input.action.target.scope}`}
							organization={organization.currentOrganization}
							plugin={plugin}
							target={input.action.target}
						/>
					) : null}
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}

function PluginConnectionDialogBody(input: {
	continuation?: PluginConnectionContinuationContext;
	currentUserId: string;
	organization: OrganizationSummary;
	plugin: Extract<PluginDefinition, { availability: "available" }>;
	target: PluginConnectionTarget;
}) {
	const queryClient = useQueryClient();
	const isPersonalWorkspace = input.organization.isPersonal === true;
	const needsRole = input.target.scope !== "member" && !isPersonalWorkspace;
	const role = useQuery({
		...organizationMemberRoleQueryOptions({
			enabled: needsRole,
			organizationId: input.organization.id,
			userId: input.currentUserId,
		}),
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
	});
	const connections = useQuery(
		organizationPluginServiceConnectionsQueryOptions({
			organizationId: input.organization.id,
			queryClient,
			service: input.plugin.service,
		})
	);
	if ((needsRole && role.isPending) || connections.isPending) {
		return (
			<output className="block py-4 text-muted-foreground text-sm">
				Checking connection options…
			</output>
		);
	}
	if (
		(needsRole && role.isError) ||
		connections.isError ||
		connections.data?.organizationId !== input.organization.id ||
		connections.data.currentUserId !== input.currentUserId
	) {
		return (
			<div className="space-y-3 py-4">
				<p role="alert">
					OpenMeld could not confirm this account’s connection options.
				</p>
				<Button
					onClick={async () => {
						if (needsRole) {
							await role.refetch();
						}
						await connections.refetch();
					}}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
			</div>
		);
	}
	const canManage =
		isPersonalWorkspace ||
		canManageOrganizationArea(role.data, { connector: ["manage"] });
	const active = connections.data.connections.filter(
		(connection) => connection.status === "active"
	);
	const member = active.find(
		(connection) =>
			connection.scope === "member" && connection.userId === input.currentUserId
	);
	const shared = active.find((connection) => connection.scope === "shared");
	return (
		<PluginConnectionSetup
			canManage={canManage}
			continuation={input.continuation}
			hasMemberConnection={Boolean(member)}
			hasSharedConnection={Boolean(shared)}
			organization={input.organization}
			plugin={input.plugin}
			target={input.target}
		/>
	);
}

function PluginConnectionSetup(input: {
	continuation?: PluginConnectionContinuationContext;
	canManage: boolean;
	hasMemberConnection: boolean;
	hasSharedConnection: boolean;
	organization: OrganizationSummary;
	plugin: Extract<PluginDefinition, { availability: "available" }>;
	target: PluginConnectionTarget;
}) {
	const { canManage } = input;
	const isPersonalWorkspace = input.organization.isPersonal === true;
	// This local choice pins only the setup view; connection changes must not switch identities.
	const [scope, setChosenScope] = useState<"member" | "shared" | null>(() => {
		if (input.target.scope !== "choose") {
			return input.target.scope;
		}
		if (input.hasMemberConnection) {
			return "member";
		}
		if (input.hasSharedConnection) {
			return "shared";
		}
		if (canManage && !isPersonalWorkspace) {
			return null;
		}
		return "member";
	});
	const [showAgentAccess, setShowAgentAccess] = useState(false);
	if (!scope) {
		return (
			<div className="space-y-3 py-4">
				<p className="text-sm">
					Connect just for yourself, or for {input.organization.name}?
				</p>
				<div className="flex flex-wrap gap-2">
					<Button
						onClick={() => setChosenScope("member")}
						size="sm"
						variant="outline"
					>
						Just for me
					</Button>
					<Button
						disabled={!canManage}
						onClick={() => setChosenScope("shared")}
						size="sm"
						variant="outline"
					>
						For the organization
					</Button>
				</div>
				<p className="text-muted-foreground text-xs">
					Organization access can be used by its allowed Agents. The provider
					may require separate approval.
				</p>
			</div>
		);
	}
	return (
		<>
			{scope === "shared" && !canManage && !input.hasSharedConnection ? (
				<p className="py-3 text-muted-foreground text-sm">
					This request needs the organization’s connection. An owner or admin
					must connect it; your personal account will not be substituted.
				</p>
			) : null}
			<PluginConnectionSurface
				canManage={canManage}
				isPersonalWorkspace={isPersonalWorkspace}
				key={scope}
				mode={scope}
				organizationId={input.organization.id}
				organizationName={input.organization.name}
				plugin={input.plugin}
				presentation="conversation"
			/>
			<details
				className="border-border/70 border-t py-3"
				onToggle={(event) => setShowAgentAccess(event.currentTarget.open)}
			>
				<summary className="cursor-pointer text-sm">Agent access</summary>
				<p className="pt-2 text-muted-foreground text-xs">
					A connected account does not automatically grant every Agent access.
					Repository and provider permissions still apply.
				</p>
				{showAgentAccess ? (
					<PluginAgentAccess
						organizationId={input.organization.id}
						organizationName={input.organization.name}
						scope={scope}
						service={input.plugin.service}
					/>
				) : null}
			</details>
			{input.continuation ? (
				<PluginConnectionContinuation
					{...input.continuation}
					connected={
						scope === "member"
							? input.hasMemberConnection
							: input.hasSharedConnection
					}
					key={`${input.continuation.sourceSignalId}:${scope}`}
					organizationId={input.organization.id}
					scope={scope}
					service={input.plugin.service}
				/>
			) : null}
		</>
	);
}
