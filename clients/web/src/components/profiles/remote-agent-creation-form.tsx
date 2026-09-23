"use client";

import {
	DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { SpinnerButton } from "#/components/spinner-button";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import { createPresentedAgentProfileCreationRequest } from "#/query/profiles/agent-profile-creation-requests";
import { PersonalRemoteAgentConfiguration } from "./personal-remote-agent-configuration";

export function RemoteAgentCreationForm(input: {
	accountName: string | null;
	currentUserId: string;
	intentStorageScope: string;
	onAccepted: (request: AgentProfileCreationRequest) => void;
	onCancel: () => void;
	onFailed: () => void;
	onStarted: (creation: OptimisticAgentProfileCreation) => void;
	organizationId: string;
	requestedSpaceId: string | null;
}) {
	const queryClient = useQueryClient();
	const catalogQuery = useQuery(modelCatalogQueryOptions());
	const catalog = catalogQuery.data ?? null;
	const [name, setName] = useState(() =>
		input.accountName
			? `${input.accountName}’s Remote Agent`
			: "Your Remote Agent"
	);
	const [chosenModel, setChosenModel] = useState("");
	const intent = useRef<{ fingerprint: string; key: string } | null>(null);
	const modelId =
		chosenModel ||
		catalog?.agentControllers["center-agent"]?.defaultModelId ||
		"";
	const canSubmit = Boolean(
		name.trim() &&
			catalog?.agentControllers["center-agent"]?.models.some(
				(choice) =>
					choice.id === modelId && choice.hostedRuntime && !choice.unavailable
			)
	);
	const mutation = useMutation({
		mutationFn: async () => {
			const fingerprint = JSON.stringify([
				name.trim(),
				modelId,
				input.requestedSpaceId,
			]);
			if (intent.current?.fingerprint !== fingerprint) {
				intent.current = { fingerprint, key: crypto.randomUUID() };
			}
			return await createPresentedAgentProfileCreationRequest({
				configuration: {
					...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
					agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
					modelId,
				},
				idempotencyKey: intent.current.key,
				intentStorageScope: input.intentStorageScope,
				onAccepted: (request) => input.onAccepted(request),
				onFailed: input.onFailed,
				onStarted: input.onStarted,
				organizationId: input.organizationId,
				profileName: name.trim(),
				queryClient,
				requestedSpaceId: input.requestedSpaceId,
				targetOwnerUserId: input.currentUserId,
				waitForCompletion: false,
			});
		},
	});
	return (
		<form
			className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-6 sm:px-6 lg:px-8"
			onSubmit={(event) => {
				event.preventDefault();
				if (canSubmit && !mutation.isPending) {
					mutation.mutate();
				}
			}}
		>
			<PersonalRemoteAgentConfiguration
				isSubmitting={mutation.isPending}
				model={modelId}
				modelCatalog={catalog}
				name={name}
				onModelChange={setChosenModel}
				onNameChange={setName}
			/>
			{mutation.error ? (
				<p className="text-destructive text-sm" role="alert">
					{mutation.error instanceof Error
						? mutation.error.message
						: "Couldn’t submit this Agent. Check your connection and try again."}
				</p>
			) : null}
			<div className="flex items-center justify-between gap-3 border-border border-t pt-4">
				<Button onClick={input.onCancel} type="button" variant="secondary">
					Cancel
				</Button>
				<SpinnerButton
					disabled={!canSubmit}
					isLoading={mutation.isPending}
					type="submit"
				>
					Create Agent
				</SpinnerButton>
			</div>
		</form>
	);
}
