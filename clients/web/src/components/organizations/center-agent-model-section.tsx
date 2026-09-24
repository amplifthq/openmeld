"use client";

import type {
	CenterAgentModelChoice,
	CenterAgentModelConfigurationResponse,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { SkeletonForm } from "@openmeld/ui/components/skeleton-content";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { InfoIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
	HostedModelSelect,
	HostedReasoningSelect,
	hostedModelPreferenceValue as modelPreferenceValue,
} from "#/components/models/hosted-model-select";
import { ModelBadge } from "#/components/models/model-badge";
import {
	isCenterAgentModelConfigurationChanged,
	resolveCenterAgentErrorMessage,
	updateCurrentCenterAgentModel,
} from "#/lib/organizations/center-agent";
import {
	centerAgentModelQueryOptions,
	centerAgentQueryKeys,
} from "#/query/organizations/center-agent";

type ModelDraft = {
	configurationRevision: number;
	organizationId: string;
	value: string;
	reasoningLevel: string;
};

export function CenterAgentModelSection(input: {
	canManage: boolean;
	enabled: boolean;
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const [draft, setDraft] = useState<ModelDraft | null>(null);
	const modelQuery = useQuery(
		centerAgentModelQueryOptions({
			enabled: input.enabled,
			organizationId: input.organizationId,
		})
	);
	const configuration = modelQuery.data;
	const savedValue = configuration
		? modelPreferenceValue(configuration.preference)
		: "";
	const selectedValue =
		configuration &&
		draft?.organizationId === input.organizationId &&
		draft?.configurationRevision === configuration.configurationRevision
			? draft.value
			: savedValue;
	const selectedChoice = configuration?.choices.find(
		(choice) => modelPreferenceValue(choice.preference) === selectedValue
	);
	const savedReasoningLevel = configuration?.reasoningLevel ?? "";
	const selectedReasoningLevel =
		configuration &&
		draft?.organizationId === input.organizationId &&
		draft?.configurationRevision === configuration.configurationRevision
			? draft.reasoningLevel
			: savedReasoningLevel;
	const canEdit =
		input.canManage && configuration?.canManage === true && !modelQuery.isError;
	const updateMutation = useMutation({
		mutationFn: async () => {
			if (!(configuration && selectedChoice)) {
				throw new Error("Center Agent model selection is unavailable.");
			}
			return await updateCurrentCenterAgentModel({
				expectedConfigurationRevision: configuration.configurationRevision,
				organizationId: input.organizationId,
				preference: selectedChoice.preference,
				...(configuration.effectiveReasoningLevel === undefined
					? {}
					: { reasoningLevel: selectedReasoningLevel || null }),
			});
		},
		onError: (error) => {
			if (!isCenterAgentModelConfigurationChanged(error)) {
				return;
			}
			setDraft(null);
			queryClient
				.invalidateQueries({
					queryKey: centerAgentQueryKeys.model(input.organizationId),
				})
				.catch((refreshError) => {
					console.error(
						"Failed to refresh the changed Center Agent model.",
						refreshError
					);
				});
		},
		onSuccess: (response) => {
			queryClient.setQueryData(
				centerAgentQueryKeys.model(input.organizationId),
				response
			);
			setDraft(null);
			toast.success(
				response.changed
					? `Center Agent will use ${response.effectiveModel.displayName} for new work.`
					: "Center Agent model is already up to date."
			);
		},
	});

	return (
		<section className="border border-border/70 bg-card/20">
			<div className="border-border/70 border-b px-5 py-4">
				<div className="flex items-center gap-1.5">
					<h2 className="font-medium text-foreground text-sm">Model</h2>
					{configuration ? (
						<Tooltip>
							<TooltipTrigger
								aria-label="About Center Agent model behavior"
								className="grid touch-manipulation place-items-center text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground max-lg:size-11"
							>
								<InfoIcon aria-hidden="true" className="size-3.5" />
							</TooltipTrigger>
							<TooltipContent
								className="max-w-72 text-left leading-5"
								side="bottom"
							>
								{modelBehaviorSummary()}
							</TooltipContent>
						</Tooltip>
					) : null}
				</div>
			</div>
			<div className="space-y-5 px-5 py-5">
				{modelQuery.isPending ? (
					<SkeletonForm fields={1} label="Loading Center Agent model" />
				) : null}
				{modelQuery.isError ? (
					<div className="space-y-3">
						<p className="text-destructive text-sm" role="alert">
							{resolveCenterAgentErrorMessage(modelQuery.error, "model_read")}
						</p>
						<Button
							onClick={() => {
								modelQuery.refetch().catch((error) => {
									console.error(
										"Failed to refresh the Center Agent model.",
										error
									);
								});
							}}
							size="sm"
							type="button"
							variant="outline"
						>
							Try again
						</Button>
					</div>
				) : null}
				{configuration ? (
					<ModelConfigurationContent
						canEdit={canEdit}
						configuration={configuration}
						isSaving={updateMutation.isPending}
						key={configuration.organizationId}
						onReasoningLevelChange={(reasoningLevel) =>
							setDraft({
								configurationRevision: configuration.configurationRevision,
								organizationId: input.organizationId,
								value: selectedValue,
								reasoningLevel,
							})
						}
						onSave={() => updateMutation.mutate()}
						onValueChange={(value) =>
							setDraft({
								configurationRevision: configuration.configurationRevision,
								organizationId: input.organizationId,
								value,
								reasoningLevel:
									value === selectedValue ? selectedReasoningLevel : "",
							})
						}
						savedReasoningLevel={savedReasoningLevel}
						savedValue={savedValue}
						selectedChoice={selectedChoice}
						selectedReasoningLevel={selectedReasoningLevel}
						selectedValue={selectedValue}
						updateError={updateMutation.isError ? updateMutation.error : null}
					/>
				) : null}
			</div>
		</section>
	);
}

function ModelConfigurationContent(input: {
	canEdit: boolean;
	configuration: CenterAgentModelConfigurationResponse;
	isSaving: boolean;
	onSave: () => void;
	onValueChange: (value: string) => void;
	onReasoningLevelChange: (value: string) => void;
	savedValue: string;
	savedReasoningLevel: string;
	selectedChoice: CenterAgentModelChoice | undefined;
	selectedReasoningLevel: string;
	selectedValue: string;
	updateError: unknown | null;
}) {
	return (
		<>
			{input.canEdit ? (
				<div className="space-y-2">
					<div className="max-w-sm">
						<HostedModelSelect
							choices={input.configuration.choices.map((choice) => ({
								value: modelPreferenceValue(choice.preference),
								modelId:
									choice.preference.kind === "selected_model"
										? choice.preference.modelId
										: null,
								label: modelChoiceLabel(choice),
								badgeLabel: choice.badgeLabel,
							}))}
							currentModelName={input.configuration.effectiveModel.displayName}
							disabled={input.isSaving}
							modelLabel="Primary model"
							onValueChange={input.onValueChange}
							savedValue={input.savedValue}
							value={input.selectedValue}
						/>
						{input.selectedChoice?.defaultReasoningLevel &&
						input.selectedChoice.supportedReasoningLevels ? (
							<HostedReasoningSelect
								defaultLevel={input.selectedChoice.defaultReasoningLevel}
								disabled={input.isSaving}
								levels={input.selectedChoice.supportedReasoningLevels}
								onValueChange={input.onReasoningLevelChange}
								value={input.selectedReasoningLevel}
							/>
						) : null}
						<Button
							disabled={
								input.isSaving ||
								!input.selectedChoice ||
								(input.selectedValue === input.savedValue &&
									input.selectedReasoningLevel === input.savedReasoningLevel)
							}
							onClick={input.onSave}
							type="button"
						>
							{input.isSaving ? "Saving..." : "Save model settings"}
						</Button>
					</div>
					{input.selectedValue !== input.savedValue && input.selectedChoice ? (
						<output
							aria-label="Model change impact"
							className="block text-muted-foreground text-sm"
						>
							This change applies to new turns across this workspace, including
							existing conversations. Work already in progress keeps its current
							model. Switching to a different model may rebuild the prompt cache
							and increase input costs on the next turn.
						</output>
					) : null}
				</div>
			) : (
				<div>
					<p className="text-muted-foreground text-xs">Primary model</p>
					<div className="mt-1 flex flex-wrap items-center gap-2">
						<p className="font-medium text-foreground">
							{input.configuration.effectiveModel.displayName}
						</p>
						{input.configuration.preference.kind === "system_default" ? (
							<Badge variant="outline">OpenMeld default</Badge>
						) : null}
						{input.selectedChoice?.badgeLabel ? (
							<ModelBadge label={input.selectedChoice.badgeLabel} />
						) : null}
					</div>
					<p className="mt-2 text-muted-foreground text-xs">
						Only organization owners and admins can change this setting.
					</p>
				</div>
			)}
			{input.updateError ? (
				<p className="text-destructive text-sm" role="alert">
					{resolveCenterAgentErrorMessage(input.updateError, "model_update")}
				</p>
			) : null}
		</>
	);
}

function modelBehaviorSummary(): string {
	return "Images use a vision model. New turns only. Doesn't switch on failure.";
}

function modelChoiceLabel(choice: CenterAgentModelChoice): string {
	return choice.preference.kind === "system_default"
		? `${choice.displayName} (${choice.effectiveModelDisplayName})`
		: choice.displayName;
}
