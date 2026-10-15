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
	const unsupported = state?.supported === false;
	const title = setupTitle(state, running && action === "install");
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
						{setupDescription(running, Boolean(state?.installed), unsupported)}
					</p>
				</div>
				{state?.signedIn || unsupported ? null : (
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
			{query.isError ||
			unsupported ||
			state?.operation?.status === "outcome_unknown" ? (
				<Button
					onClick={async () => {
						await query.refetch();
						input.onChanged?.();
					}}
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

function setupDescription(
	running: boolean,
	installed: boolean,
	unsupported: boolean
) {
	if (unsupported) {
		return "Follow the setup guide, then check again.";
	}
	if (running) {
		return "You can close this dialog and keep using OpenMeld.";
	}
	if (installed) {
		return "Sign in in the browser on the selected computer.";
	}
	return "OpenMeld installs the connection tools on the selected computer.";
}

function setupTitle(
	state:
		| { signedIn: boolean; installed: boolean; supported: boolean }
		| undefined,
	installing: boolean
) {
	if (state?.supported === false) {
		return "Set up Grok Bot manually on this computer.";
	}
	if (installing) {
		return "Installing Grok Bot connection tools.";
	}
	if (state?.signedIn) {
		return "Signed in to Grok Bot.";
	}
	if (state?.installed) {
		return "Sign in to connect Grok Bot.";
	}
	return "Connect your existing Grok Bot.";
}
