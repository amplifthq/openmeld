"use client";

import { pluginPermissionSchema } from "@openmeld/schemas";
import type {
	ConnectorService,
	PluginAccess,
	PluginAccessPolicy,
	PluginConsumer,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	listPluginAccess,
	updatePluginAccess,
} from "#/lib/organizations/connector-connections";
import { organizationPluginConnectionQueryKeys } from "#/query/organizations/plugin-connections";

const CONSUMERS: { id: PluginConsumer; label: string }[] = [
	{ id: "center_agent", label: "Center Agent" },
	{ id: "local_agent", label: "Local Agents" },
	{ id: "remote_agent", label: "Personal Remote Agents" },
];

export function PluginAgentAccess(input: {
	organizationId: string;
	service: ConnectorService;
}) {
	const queryClient = useQueryClient();
	const queryKey = [
		...organizationPluginConnectionQueryKeys.service(
			input.organizationId,
			input.service
		),
		"access",
	];
	const access = useQuery({
		queryKey,
		queryFn: ({ signal }) => listPluginAccess({ ...input, signal }),
	});
	if (access.isPending) {
		return (
			<output className="block px-5 py-4 text-muted-foreground text-sm">
				Loading Agent access…
			</output>
		);
	}
	if (access.isError) {
		return (
			<div className="px-5 py-4">
				<p role="alert">Agent access could not be loaded.</p>
				<Button onClick={() => access.refetch()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	const active = access.data.connections;
	if (active.length === 0) {
		return null;
	}
	return (
		<section
			aria-label="Agent access"
			className="border-border/70 border-t px-4 py-4 sm:px-5"
		>
			<h3 className="font-medium text-sm">Agent access</h3>
			<p className="mt-1 text-muted-foreground text-xs leading-5">
				Choose what each type of Agent can do. Personal accounts are used only
				for their owner’s requests. Shared accounts are available to
				organization members within these permissions.
			</p>
			{active.map((item) => {
				return (
					<ConnectionAgentAccess
						key={`${item.connectionName}:${item.revision}`}
						{...input}
						access={item}
						label={item.scope === "shared" ? "Shared account" : "Your account"}
						onSaved={() => queryClient.invalidateQueries({ queryKey })}
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
	return (
		<fieldset
			className="mt-4 space-y-3"
			disabled={!input.access.canManage || mutation.isPending}
		>
			<legend className="mb-2 font-medium text-xs">{input.label}</legend>
			{CONSUMERS.map(({ id: consumer, label }) => (
				<div
					className="flex max-w-lg items-center justify-between gap-4"
					key={consumer}
				>
					<label className="text-sm" htmlFor={`${id}-${consumer}`}>
						{label}
					</label>
					<select
						className="h-8 rounded-md border border-input bg-background px-2 text-sm disabled:opacity-70"
						id={`${id}-${consumer}`}
						onChange={(event) => {
							const value = pluginPermissionSchema.parse(event.target.value);
							setPolicy((previous) => ({ ...previous, [consumer]: value }));
						}}
						value={policy[consumer]}
					>
						<option value="none">No access</option>
						<option value="read">Read only</option>
						<option value="write">Read and write</option>
					</select>
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
					An organization owner or admin manages this access.
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
	);
}
