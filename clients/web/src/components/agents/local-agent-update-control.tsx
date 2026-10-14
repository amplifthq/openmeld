import type {
	LocalAgentUpdateState,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { managePeopleComputerLocalAgentUpdate } from "#/lib/connect/local-runtimes";
import { formatMutationError } from "./agents-page-formatters";

// Desktop embeds this same Computer surface and uses the same authorized API.
export function LocalAgentUpdateControl(input: {
	agentId: string;
	target: PeopleComputerTarget;
	storageScope: string;
	installationId: string;
	blocked: boolean;
	onChanged: () => Promise<unknown>;
}) {
	const client = useQueryClient();
	const [uncertain, setUncertain] = useState(false);
	const pendingOperationId = useRef<string | null>(null);
	const refreshedOperationId = useRef<string | null>(null);
	const key = [
		"local-agent-update",
		input.storageScope,
		input.target.deviceId,
		input.target.runtimeLane,
		input.agentId,
	];
	const query = useQuery({
		queryKey: key,
		queryFn: () =>
			managePeopleComputerLocalAgentUpdate({
				...input.target,
				agentId: input.agentId,
			}),
		retry: false,
		refetchInterval: (current) =>
			current.state.data?.operation?.status === "running" || uncertain
				? 2000
				: false,
	});
	const mutation = useMutation({
		mutationFn: () => {
			pendingOperationId.current = crypto.randomUUID();
			return managePeopleComputerLocalAgentUpdate({
				...input.target,
				agentId: input.agentId,
				request: {
					installationId: input.installationId,
					operationId: pendingOperationId.current,
				},
			});
		},
		retry: false,
		onSuccess: (data) => {
			setUncertain(false);
			client.setQueryData<LocalAgentUpdateState>(key, data);
			input
				.onChanged()
				.catch((error: unknown) =>
					console.error("Failed to refresh installation status.", error)
				);
		},
		onError: (error) => {
			const status = (error as { status?: number }).status;
			setUncertain(!(status && status >= 400 && status < 500));
			query
				.refetch()
				.catch((error: unknown) =>
					console.error("Failed to check update status.", error)
				);
		},
	});
	const operation = query.data?.operation;
	const status = operation?.status;
	useEffect(() => {
		if (operation?.operationId === pendingOperationId.current) {
			setUncertain(false);
		}
		if (
			operation &&
			status !== "running" &&
			refreshedOperationId.current !== operation.operationId
		) {
			refreshedOperationId.current = operation.operationId;
			input
				.onChanged()
				.catch((error: unknown) =>
					console.error(
						"Failed to refresh the local agent after an update.",
						error
					)
				);
		}
	}, [operation, status, input.onChanged]);
	if (query.isError && !query.data) {
		return (
			<div className="flex items-center justify-between gap-3 text-muted-foreground text-sm">
				<span>Update status is unavailable.</span>
				<Button
					onClick={() => query.refetch()}
					size="sm"
					type="button"
					variant="ghost"
				>
					Check status
				</Button>
			</div>
		);
	}
	if (!(query.data?.supported || operation)) {
		return null;
	}
	const updating = mutation.isPending || status === "running";
	const cannotRetry = uncertain || status === "outcome_unknown";
	return (
		<div className="grid gap-2 border-border/60 border-t pt-3">
			<div className="flex items-center justify-between gap-4">
				<div className="min-w-0 text-muted-foreground text-xs leading-5">
					Uses Claude Code's configured release channel. Existing sessions keep
					their current version.
				</div>
				<Button
					disabled={
						!query.data?.supported ||
						input.blocked ||
						updating ||
						cannotRetry ||
						query.isError
					}
					onClick={() => mutation.mutate()}
					size="sm"
					type="button"
					variant="outline"
				>
					{updating ? "Updating…" : "Update"}
				</Button>
			</div>
			{operation ? (
				<output className="break-words text-muted-foreground text-sm">
					{operation.message}
				</output>
			) : null}
			{status === "outcome_unknown" ? (
				<a
					className="w-fit text-sm underline underline-offset-4"
					href="https://code.claude.com/docs/en/setup#update-manually"
					rel="noreferrer"
					target="_blank"
				>
					View manual update instructions
				</a>
			) : null}
			{uncertain ? (
				<output className="text-muted-foreground text-sm">
					The update request was not confirmed. Check its status before trying
					again.
				</output>
			) : null}
			{mutation.isError && !uncertain ? (
				<p className="text-destructive text-sm" role="alert">
					{formatMutationError(
						mutation.error,
						"The update could not start. Check the installation and try again."
					)}
				</p>
			) : null}
			{query.isError || uncertain ? (
				<Button
					className="w-fit"
					onClick={() => query.refetch()}
					size="sm"
					type="button"
					variant="ghost"
				>
					Check status
				</Button>
			) : null}
		</div>
	);
}
