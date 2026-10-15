import type { PeopleComputerTarget } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { managePeopleComputerLocalAgentSetup } from "#/lib/connect/local-runtimes";
import { formatMutationError } from "./agents-page-formatters";

export function LocalAgentSetupControl(input: {
	target: PeopleComputerTarget;
	storageScope: string;
	agentId: string;
	onChanged?: () => void;
}) {
	const client = useQueryClient();
	const refreshed = useRef<string | null>(null);
	const key = [
		"local-agent-setup",
		input.storageScope,
		input.target.deviceId,
		input.target.runtimeLane,
		input.agentId,
	];
	const query = useQuery({
		queryKey: key,
		queryFn: () =>
			managePeopleComputerLocalAgentSetup({
				...input.target,
				agentId: input.agentId,
			}),
		retry: false,
		refetchInterval: (q) =>
			q.state.data?.operation?.status === "running" ? 2000 : false,
	});
	const mutation = useMutation({
		mutationFn: (action: "install" | "login") =>
			managePeopleComputerLocalAgentSetup({
				...input.target,
				agentId: input.agentId,
				request: { operationId: crypto.randomUUID(), action },
			}),
		retry: false,
		onSuccess: (data) => {
			client.setQueryData(key, data);
		},
		onError: () => {
			return query.refetch();
		},
	});
	const state = query.data;
	useEffect(() => {
		if (
			state?.operation?.status === "succeeded" &&
			refreshed.current !== state.operation.operationId
		) {
			refreshed.current = state.operation.operationId;
			input.onChanged?.();
		}
	}, [state, input.onChanged]);
	const running = mutation.isPending || state?.operation?.status === "running";
	const pendingAction = mutation.isPending
		? mutation.variables
		: state?.operation?.action;
	const nextAction = state?.installed ? "login" : "install";
	const action = running ? (pendingAction ?? nextAction) : nextAction;
	const title =
		running && action === "install"
			? "Installing Grok Bot connection tools."
			: setupTitle(state);
	const labels =
		action === "install"
			? ["Install connection tools", "Installing…"]
			: ["Sign in", "Waiting for sign-in…"];
	return (
		<section aria-label="Grok Bot connection setup" className="grid gap-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="grid gap-1">
					<h3 className="font-medium text-sm">{title}</h3>
					<p className="text-muted-foreground text-xs">
						{setupDescription(running, Boolean(state?.installed))}
					</p>
				</div>
				{state?.signedIn ? null : (
					<Button
						disabled={
							running ||
							!state?.supported ||
							state.operation?.status === "outcome_unknown" ||
							query.isError
						}
						onClick={() => mutation.mutate(action)}
						size="sm"
						type="button"
						variant="outline"
					>
						{labels[running ? 1 : 0]}
					</Button>
				)}
			</div>
			{state?.operation && !running ? (
				<output className="text-muted-foreground text-xs">
					{state.operation.message}
				</output>
			) : null}
			{mutation.isError || query.isError ? (
				<p className="text-destructive text-xs" role="alert">
					{formatMutationError(
						mutation.error ?? query.error,
						"Couldn’t check connection setup. Try again."
					)}
				</p>
			) : null}
			{query.isError ? (
				<Button
					onClick={() => query.refetch()}
					size="sm"
					type="button"
					variant="ghost"
				>
					Check status
				</Button>
			) : null}
			<a
				className="text-sm underline underline-offset-4"
				href="https://docs.openmeld.ai/docs/start/local-agents/grok-bot"
				rel="noreferrer"
				target="_blank"
			>
				Setup help
			</a>
		</section>
	);
}

function setupDescription(running: boolean, installed: boolean) {
	if (running) {
		return "You can close this dialog and keep using OpenMeld.";
	}
	if (installed) {
		return "Sign in in the browser on the selected computer.";
	}
	return "OpenMeld installs the connection tools on the selected computer.";
}

function setupTitle(
	state: { signedIn: boolean; installed: boolean } | undefined
) {
	if (state?.signedIn) {
		return "Signed in to Grok Bot.";
	}
	if (state?.installed) {
		return "Sign in to connect Grok Bot.";
	}
	return "Connect your existing Grok Bot.";
}
