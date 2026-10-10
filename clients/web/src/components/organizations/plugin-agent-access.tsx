"use client";

import {
	connectorConnectionScopeAllowed,
	pluginPermissionSchema,
} from "@openmeld/schemas";
import type {
	ConnectorService,
	PluginAccess,
	PluginAccessPolicy,
	PluginConsumer,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonForm } from "@openmeld/ui/components/skeleton-content";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useId, useState } from "react";
import { toast } from "sonner";
import {
	listPluginAccess,
	updatePluginAccess,
} from "#/lib/organizations/connector-connections";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	organizationPluginConnectionQueryKeys,
	organizationPluginServiceConnectionsQueryOptions,
} from "#/query/organizations/plugin-connections";

const CONSUMERS: { id: PluginConsumer; label: string }[] = [
	{ id: "center_agent", label: "Center Agent" },
	{ id: "local_agent", label: "Local Agents" },
	{ id: "remote_agent", label: "Personal Remote Agents" },
];
const PERMISSION_LABELS = {
	none: "No access",
	read: "Read only",
	write: "Read and write",
} as const;

export function PluginAgentAccess(input: {
	organizationId: string;
	service: ConnectorService;
	scope: "member" | "shared" | "all";
	organizationName: string;
	children?: (hasSavedAccess: boolean) => ReactNode;
}) {
	const queryClient = useQueryClient();
	const viewer = useOptionalAppOrganization();
	const connections = useQuery(
		organizationPluginServiceConnectionsQueryOptions({
			organizationId: input.organizationId,
			service: input.service,
			queryClient,
		})
	);
	const snapshot = connections.data;
	const current =
		snapshot?.organizationId === input.organizationId &&
		(!viewer ||
			(snapshot.currentUserId === viewer.currentUserId &&
				viewer.currentOrganization.id === input.organizationId));
	const connected = current
		? snapshot.connections.filter(
				(connection) =>
					connection.status === "active" &&
					connectorConnectionScopeAllowed(input.service, connection.scope) &&
					(input.scope === "all" || connection.scope === input.scope) &&
					(connection.scope === "shared" ||
						connection.userId === snapshot.currentUserId)
			)
		: [];
	// A different signed-in user or reauthorization cannot reuse an old policy
	// view/draft. The server remains the authority for permission and execution.
	const snapshotKey = connected
		.map((item) => `${item.connectionName}:${item.updatedAtMs}`)
		.sort()
		.join("|");
	const accessQueryKey = [
		...organizationPluginConnectionQueryKeys.service(
			input.organizationId,
			input.service
		),
		"access",
	];
	const queryKey = [...accessQueryKey, snapshot?.currentUserId, snapshotKey];
	const access = useQuery({
		queryKey,
		enabled: current && !connections.isError && connected.length > 0,
		refetchOnMount: "always",
		refetchOnWindowFocus: true,
		queryFn: ({ signal }) =>
			listPluginAccess({
				organizationId: input.organizationId,
				service: input.service,
				signal,
			}),
	});
	const active =
		access.data?.connections.filter((item) =>
			connected.some(
				(connection) =>
					connection.connectionName === item.connectionName &&
					connection.scope === item.scope
			)
		) ?? [];
	if (connections.isPending || (connected.length > 0 && access.isPending)) {
		return (
			<>
				<SkeletonForm className="py-4" label="Loading Agent access" />
				{input.children?.(false)}
			</>
		);
	}
	if (
		connections.isError ||
		!current ||
		(connected.length > 0 &&
			(access.isError || active.length !== connected.length))
	) {
		return (
			<div className="py-4">
				<p role="alert">Agent access could not be loaded.</p>
				<Button
					onClick={async () => {
						await connections.refetch();
						await access.refetch();
					}}
					size="sm"
					variant="outline"
				>
					Try again
				</Button>
				{input.children?.(false)}
			</div>
		);
	}
	if (active.length === 0) {
		return <>{input.children?.(false)}</>;
	}
	return (
		<section
			aria-label="Agent access"
			className="border-border/70 border-t py-4"
		>
			<h3 className="font-medium text-sm">Agent access</h3>
			<p className="mt-2 text-muted-foreground text-sm">
				Choose which Agents may use this account, then save your permissions.
				Connecting an account does not grant new Agent access or start a task.
			</p>
			{active.map((item) => {
				return (
					<ConnectionAgentAccess
						key={`${snapshot?.currentUserId}:${snapshotKey}:${item.connectionName}:${item.revision}:${item.canManage}`}
						{...input}
						access={item}
						label={
							item.scope === "shared"
								? `Agents in ${input.organizationName}`
								: "Agents using your account"
						}
						onSaved={() =>
							queryClient.invalidateQueries({ queryKey: accessQueryKey })
						}
					/>
				);
			})}
		</section>
	);
}

function ConnectionAgentAccess(input: {
	access: PluginAccess;
	organizationId: string;
	service: ConnectorService;
	label: string;
	onSaved: () => Promise<void>;
	children?: (hasSavedAccess: boolean) => ReactNode;
}) {
	const id = useId();
	const [policy, setPolicy] = useState<PluginAccessPolicy>(input.access.policy);
	const mutation = useMutation({
		mutationFn: () =>
			updatePluginAccess({
				organizationId: input.organizationId,
				service: input.service,
				body: {
					connectionName: input.access.connectionName,
					expectedRevision: input.access.revision,
					policy,
				},
			}),
		onSuccess: async () => {
			await input.onSaved();
			toast.success("Agent access saved.");
		},
	});
	const changed = CONSUMERS.some(
		({ id: consumer }) => policy[consumer] !== input.access.policy[consumer]
	);
	const hasSavedAccess = CONSUMERS.some(
		({ id: consumer }) => input.access.policy[consumer] !== "none"
	);
	return (
		<>
			<fieldset
				className="mt-4 space-y-3"
				disabled={!input.access.canManage || mutation.isPending}
			>
				<legend className="font-medium text-sm">{input.label}</legend>
				{hasSavedAccess ? null : (
					<p className="text-muted-foreground text-sm">
						No Agent has access yet.
					</p>
				)}
				{CONSUMERS.map(({ id: consumer, label }) => (
					<div
						className="flex max-w-lg items-center justify-between gap-4"
						key={consumer}
					>
						<label className="text-sm" htmlFor={`${id}-${consumer}`}>
							{label}
						</label>
						<Select
							disabled={!input.access.canManage || mutation.isPending}
							onValueChange={(nextValue) => {
								const value = pluginPermissionSchema.parse(nextValue);
								setPolicy((previous) => ({ ...previous, [consumer]: value }));
							}}
							value={policy[consumer]}
						>
							<SelectTrigger
								className="w-40"
								displayValue={PERMISSION_LABELS[policy[consumer]]}
								id={`${id}-${consumer}`}
							/>
							<SelectContent>
								<SelectItem index={0} value="none">
									No access
								</SelectItem>
								<SelectItem index={1} value="read">
									Read only
								</SelectItem>
								<SelectItem index={2} value="write">
									Read and write
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				))}
				{input.access.canManage ? (
					<Button
						disabled={!changed || mutation.isPending}
						onClick={() => mutation.mutate()}
						size="sm"
					>
						{mutation.isPending ? "Saving…" : "Save access"}
					</Button>
				) : (
					<p className="text-muted-foreground text-xs">
						{input.access.scope === "shared"
							? "An organization owner or admin manages this access."
							: "Only the account owner manages this access."}
					</p>
				)}
				{mutation.isError ? (
					<div>
						<p className="text-destructive text-sm" role="alert">
							{mutation.error.message}
						</p>
						<Button onClick={input.onSaved} size="sm" variant="outline">
							Reload access
						</Button>
					</div>
				) : null}
			</fieldset>
			{input.children ? (
				<>
					{changed ? (
						<p className="mt-2 text-muted-foreground text-sm">
							Save your permission changes before continuing.
						</p>
					) : null}
					<p className="mt-2 text-muted-foreground text-xs">
						OpenMeld checks the original Agent’s permissions again when you
						continue.
					</p>
					{input.children(hasSavedAccess && !changed && !mutation.isPending)}
				</>
			) : null}
		</>
	);
}
