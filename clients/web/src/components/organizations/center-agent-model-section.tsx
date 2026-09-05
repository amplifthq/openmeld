"use client";

import type {
	CenterAgentModelChoice,
	CenterAgentModelConfigurationResponse,
	CenterAgentModelPreference,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Label } from "@openmeld/ui/components/label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { InfoIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
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
	value: string;
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
		draft?.configurationRevision === configuration.configurationRevision
			? draft.value
			: savedValue;
	const selectedChoice = configuration?.choices.find(
		(choice) => modelPreferenceValue(choice.preference) === selectedValue
	);
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
					<p className="text-muted-foreground text-sm">
						Loading Center Agent model.
					</p>
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
						onSave={() => updateMutation.mutate()}
						onValueChange={(value) =>
							setDraft({
								configurationRevision: configuration.configurationRevision,
								value,
							})
						}
						savedValue={savedValue}
						selectedChoice={selectedChoice}
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
	savedValue: string;
	selectedChoice: CenterAgentModelChoice | undefined;
	selectedValue: string;
	updateError: unknown | null;
}) {
	return (
		<>
			{input.canEdit ? (
				<div className="space-y-2">
					<Label htmlFor="center-agent-primary-model">Primary model</Label>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start">
						<Select
							disabled={input.isSaving}
							onValueChange={input.onValueChange}
							value={input.selectedValue}
						>
							<SelectTrigger
								aria-label="Primary model"
								className="w-full sm:max-w-sm"
								displayValue={
									input.selectedChoice
										? modelChoicePresentation(input.selectedChoice)
										: input.configuration.effectiveModel.displayName
								}
								id="center-agent-primary-model"
							/>
							<SelectContent>
								{input.configuration.choices.map((choice, index) => (
									<SelectItem
										aria-label={modelChoiceAccessibleLabel(choice)}
										index={index}
										key={modelPreferenceValue(choice.preference)}
										value={modelPreferenceValue(choice.preference)}
									>
										{modelChoicePresentation(choice)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							disabled={
								input.isSaving ||
								input.selectedValue === input.savedValue ||
								!input.selectedChoice
							}
							onClick={input.onSave}
							type="button"
						>
							{input.isSaving ? "Saving..." : "Save model"}
						</Button>
					</div>
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

function modelChoiceAccessibleLabel(choice: CenterAgentModelChoice): string {
	return [modelChoiceLabel(choice), choice.badgeLabel]
		.filter((part): part is string => Boolean(part))
		.join(" ");
}

function modelChoicePresentation(choice: CenterAgentModelChoice) {
	return (
		<span className="flex min-w-0 items-center gap-2">
			<span className="min-w-0 truncate">{modelChoiceLabel(choice)}</span>
			{choice.badgeLabel ? <ModelBadge label={choice.badgeLabel} /> : null}
		</span>
	);
}

function modelPreferenceValue(preference: CenterAgentModelPreference): string {
	return preference.kind === "system_default"
		? "system_default"
		: `model:${preference.modelId}`;
}
