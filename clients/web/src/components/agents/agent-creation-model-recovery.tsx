import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	AgentProfileCreationRequest,
	RetryAgentProfileCreationRequestBody,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AgentProfileModelSelectionFields } from "#/components/profiles/create-profile-form";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";

type AgentCreationModelRecoveryProps = {
	request: AgentProfileCreationRequest | null;
	pending: boolean;
	onClose: () => void;
	onRetry: (
		request: AgentProfileCreationRequest,
		correction: RetryAgentProfileCreationRequestBody
	) => void;
};

export function AgentCreationModelRecovery(
	input: AgentCreationModelRecoveryProps
) {
	return input.request ? (
		<AgentCreationModelRecoveryDialog
			key={input.request.id}
			{...input}
			request={input.request}
		/>
	) : null;
}

function AgentCreationModelRecoveryDialog(
	input: Omit<AgentCreationModelRecoveryProps, "request"> & {
		request: AgentProfileCreationRequest;
	}
) {
	const [modelId, setModelId] = useState(
		input.request.configuration.modelId ?? ""
	);
	const [reasoningLevel, setReasoningLevel] = useState(
		input.request.configuration.reasoningLevel ?? ""
	);
	const catalog = useQuery(modelCatalogQueryOptions());
	const controller = parseAgentControllerRef(
		input.request.configuration.agentControllerRef ?? ""
	);
	const model = catalog.data?.agentControllers[
		controller?.id ?? ""
	]?.models.find((choice) => choice.id === modelId);
	const valid = Boolean(
		model &&
			(!reasoningLevel ||
				model.supportedReasoningLevels.includes(reasoningLevel))
	);
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!(open || input.pending)) {
					input.onClose();
				}
			}}
			open
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						Review model for {input.request.profileName}
					</DialogTitle>
					<DialogDescription>
						Choose a supported model and retry this setup. Your Agent, working
						folder, and Space selection will stay the same.
					</DialogDescription>
				</DialogHeader>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (valid && !input.pending) {
							input.onRetry(input.request, {
								expectedUpdatedAt: input.request.updatedAt,
								modelSelection: {
									modelId,
									reasoningLevel: reasoningLevel || null,
								},
							});
						}
					}}
				>
					{catalog.isError ? (
						<p className="text-destructive text-sm">{catalog.error.message}</p>
					) : null}
					<AgentProfileModelSelectionFields
						agentId={controller?.id ?? ""}
						disabled={input.pending || !catalog.data}
						modelCatalog={catalog.data ?? null}
						modelId={modelId}
						onChangeModelId={(value) => {
							setModelId(value);
							setReasoningLevel("");
						}}
						onChangeReasoningLevel={setReasoningLevel}
						reasoningLevel={reasoningLevel}
					/>
					<div className="flex justify-end gap-2">
						<Button
							disabled={input.pending}
							onClick={input.onClose}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={!valid || input.pending} type="submit">
							{input.pending ? "Retrying…" : "Retry setup"}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
