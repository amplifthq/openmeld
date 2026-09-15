import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	AgentProfileCreationRequest,
	OrganizationComputersResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { formatLocalAgentDisplayName } from "#/components/profiles/local-agent-display-name";
import { buildOrganizationComputersPath } from "#/lib/organizations/organization-routes";
import { formatAgentCreationFailure } from "#/lib/profiles/agent-creation-failure";
import {
	readPendingAgentProfileCreationLocalSetup,
	transferPendingAgentProfileCreationLocalSetup,
} from "#/lib/profiles/agent-profile-creation-local-setup";
import { restartAgentProfileCreationOnComputer } from "#/lib/profiles/agent-profile-creation-requests";
import { organizationComputersQueryOptions } from "#/query/organizations/organization-directory";

export function recoveryComputers(
	request: AgentProfileCreationRequest,
	computers: OrganizationComputersResponse["computers"]
) {
	return computers.filter(
		(computer) =>
			computer.ownerUserId === request.targetOwnerUserId &&
			computer.serviceState === "connected" &&
			(request.sessionStrategy === "new" ||
				computer.computerId === request.configuration.targetComputerId) &&
			computer.localAgents.some(
				(agent) =>
					agent.agentControllerRef ===
						request.configuration.agentControllerRef &&
					agent.enabled &&
					agent.status === "ready"
			)
	);
}

export function AgentCreationComputerRecovery(input: {
	request: AgentProfileCreationRequest;
	currentUserId: string;
	storageScope: string;
	orgSlug?: string;
	onClose: () => void;
	onRecovered: (request: AgentProfileCreationRequest) => Promise<void>;
}) {
	const { request } = input;
	const [computerId, setComputerId] = useState("");
	const customFolderPending = Boolean(
		readPendingAgentProfileCreationLocalSetup({
			organizationId: request.organizationId,
			requestId: request.id,
			storageScope: input.storageScope,
		})
	);
	const computers = useQuery(
		organizationComputersQueryOptions({
			organizationId: request.organizationId,
			enabled: true,
		})
	);
	const choices = recoveryComputers(request, computers.data?.computers ?? []);
	const controller = parseAgentControllerRef(
		request.configuration.agentControllerRef ?? ""
	);
	const agentName = controller
		? formatLocalAgentDisplayName(controller.id)
		: "the local agent";
	const mutation = useMutation({
		mutationFn: () =>
			restartAgentProfileCreationOnComputer({
				onAccepted: (replacement) => {
					if (
						!transferPendingAgentProfileCreationLocalSetup({
							fromRequest: request,
							toRequest: replacement,
							storageScope: input.storageScope,
						})
					) {
						toast.warning(
							"Your Agent setup was accepted. Open the Agent when setup finishes to choose its working folder again."
						);
					}
				},
				organizationId: request.organizationId,
				requestId: request.id,
				currentUserId: input.currentUserId,
				computerId,
			}),
		onSuccess: async ({ request: result }) => {
			await input.onRecovered(result);
			input.onClose();
		},
	});
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || mutation.isPending)) {
					input.onClose();
				}
			}}
			open
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Finish setting up {request.profileName}</DialogTitle>
					<DialogDescription>
						This Agent hasn’t been created yet. Choose a computer where{" "}
						{agentName} is available. Your Agent’s name, model, and settings
						will stay the same.
					</DialogDescription>
				</DialogHeader>
				{request.configuration.modelId ? (
					<p className="text-muted-foreground text-sm">
						Model: {request.configuration.modelId}
					</p>
				) : null}
				{customFolderPending ? (
					<p className="text-muted-foreground text-sm">
						This setup includes a custom working folder. If you choose another
						computer, choose the folder again in Agent settings after setup.
					</p>
				) : null}
				{request.sessionStrategy !== "new" ? (
					<p className="text-muted-foreground text-sm">
						This setup uses an existing conversation, so it must stay on the
						original computer.
					</p>
				) : null}
				{computers.isPending ? <output>Checking your computers…</output> : null}
				{computers.isError ? (
					<p role="alert">
						Couldn’t check your computers. Check your internet connection, then
						select Refresh computers.
					</p>
				) : null}
				{computers.isSuccess && choices.length === 0 ? (
					<p className="text-sm">
						No connected computer has {agentName} ready. Open OpenMeld on the
						computer you want to use and make sure {agentName} is installed and
						signed in. Then refresh this list.
					</p>
				) : null}
				{choices.length > 0 ? (
					<label className="grid gap-2 font-medium text-sm">
						Computer
						<select
							className="h-9 rounded-md border bg-background px-3 font-normal"
							disabled={mutation.isPending}
							onChange={(event) => setComputerId(event.target.value)}
							value={computerId}
						>
							<option value="">Choose a computer</option>
							{choices.map((computer) => (
								<option key={computer.computerId} value={computer.computerId}>
									{computer.deviceDisplayName}
								</option>
							))}
						</select>
					</label>
				) : null}
				<div className="flex items-center gap-3">
					<Button
						disabled={computers.isFetching || mutation.isPending}
						onClick={() => computers.refetch()}
						size="sm"
						variant="outline"
					>
						Refresh computers
					</Button>
					{input.orgSlug ? (
						<a
							className="text-sm underline underline-offset-4"
							href={buildOrganizationComputersPath(input.orgSlug)}
							rel="noreferrer"
							target="_blank"
						>
							Manage computers
						</a>
					) : null}
				</div>
				<p className="text-muted-foreground text-xs">
					Continuing cancels the previous attempt and starts setup on the
					computer you choose.
				</p>
				{mutation.isError ? (
					<div className="text-destructive text-sm" role="alert">
						<p>{formatAgentCreationFailure(mutation.error.message)}</p>
						<p>
							You can try again here. If setup was already accepted, continuing
							will open that attempt.
						</p>
					</div>
				) : null}
				<div className="flex justify-end gap-2">
					<Button
						disabled={mutation.isPending}
						onClick={input.onClose}
						variant="outline"
					>
						Back
					</Button>
					<Button
						disabled={
							mutation.isPending ||
							!choices.some((computer) => computer.computerId === computerId)
						}
						onClick={() => mutation.mutate()}
					>
						{mutation.isPending ? "Starting setup…" : "Continue setup"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}
