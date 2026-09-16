"use client";

import { Combobox } from "@base-ui/react/combobox";
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
import { CaretDownIcon, CheckIcon, InfoIcon } from "@phosphor-icons/react";
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
	organizationId: string;
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
		draft?.organizationId === input.organizationId &&
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
						key={configuration.organizationId}
						onSave={() => updateMutation.mutate()}
						onValueChange={(value) =>
							setDraft({
								configurationRevision: configuration.configurationRevision,
								organizationId: input.organizationId,
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
	const [search, setSearch] = useState("");
	const [providerId, setProviderId] = useState("all");
	const providers = [
		...new Set(
			input.configuration.choices.flatMap((choice) => {
				const id = modelProviderId(choice);
				return id ? [id] : [];
			})
		),
	].sort((a, b) => modelProviderLabel(a).localeCompare(modelProviderLabel(b)));
	const choices = input.configuration.choices.toSorted(
		(a, b) =>
			Number(modelPreferenceValue(b.preference) === input.savedValue) -
			Number(modelPreferenceValue(a.preference) === input.savedValue)
	);
	const unselectedLabel =
		input.selectedValue === input.savedValue
			? input.configuration.effectiveModel.displayName
			: "Choose a model";
	return (
		<>
			{input.canEdit ? (
				<div className="space-y-2">
					<div className="mb-4 space-y-2">
						<Label htmlFor="center-agent-model-provider">Provider</Label>
						<Select
							disabled={input.isSaving}
							onValueChange={(id) => {
								setProviderId(id);
								setSearch("");
								if (
									id !== "all" &&
									(!input.selectedChoice ||
										modelProviderId(input.selectedChoice) !== id)
								) {
									input.onValueChange("");
								}
							}}
							value={providerId}
						>
							<SelectTrigger
								aria-label="Provider"
								className="min-h-10 w-full text-sm max-lg:min-h-11 sm:max-w-sm"
								displayValue={
									providerId === "all"
										? "All providers"
										: modelProviderLabel(providerId)
								}
								id="center-agent-model-provider"
							/>
							<SelectContent>
								<SelectItem index={0} value="all">
									All providers
								</SelectItem>
								{providers.map((id, index) => (
									<SelectItem index={index + 1} key={id} value={id}>
										{modelProviderLabel(id)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-muted-foreground text-xs">
							Choose a provider, or search across all providers. Models are
							served through OpenRouter.
						</p>
					</div>
					<Label htmlFor="center-agent-primary-model">Primary model</Label>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start">
						<Combobox.Root
							disabled={input.isSaving}
							filteredItems={choices.filter(
								(choice) =>
									(providerId === "all" ||
										modelProviderId(choice) === providerId) &&
									`${modelChoiceLabel(choice)} ${modelPreferenceValue(choice.preference)} ${modelProviderLabel(modelProviderId(choice) ?? "")}`
										.toLowerCase()
										.includes(search.trim().toLowerCase())
							)}
							inputValue={search}
							isItemEqualToValue={(a, b) =>
								modelPreferenceValue(a.preference) ===
								modelPreferenceValue(b.preference)
							}
							items={choices}
							itemToStringLabel={modelChoiceLabel}
							onInputValueChange={setSearch}
							onOpenChange={(open) => {
								if (open) {
									setSearch("");
								}
							}}
							onValueChange={(choice) => {
								if (choice) {
									input.onValueChange(modelPreferenceValue(choice.preference));
								}
							}}
							value={input.selectedChoice ?? null}
						>
							<Combobox.Trigger
								aria-label="Primary model"
								className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-lg:min-h-11 sm:max-w-sm"
								id="center-agent-primary-model"
							>
								{input.selectedChoice
									? modelChoicePresentation(input.selectedChoice)
									: unselectedLabel}
								<CaretDownIcon
									aria-hidden="true"
									className="size-4 shrink-0 text-muted-foreground"
								/>
							</Combobox.Trigger>
							<Combobox.Portal>
								<Combobox.Positioner className="z-50" sideOffset={6}>
									<Combobox.Popup className="w-[var(--anchor-width)] max-w-[var(--available-width)] overflow-hidden rounded-md border border-border bg-card text-card-foreground shadow-md">
										<div className="border-border border-b px-3 py-2 text-muted-foreground text-xs">
											Current: {input.configuration.effectiveModel.displayName}
										</div>
										<Combobox.Input
											aria-label="Search models"
											className="w-full border-border border-b bg-transparent px-3 py-2 text-sm outline-none"
											placeholder="Search models…"
										/>
										<Combobox.Empty className="p-3 text-muted-foreground text-sm empty:hidden">
											No models found.
										</Combobox.Empty>
										<Combobox.List className="max-h-60 overflow-y-auto p-1">
											{(choice: CenterAgentModelChoice) => (
												<Combobox.Item
													aria-label={modelChoiceAccessibleLabel(choice)}
													className="flex cursor-default items-center gap-2 rounded-sm px-2 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground max-lg:min-h-11"
													key={modelPreferenceValue(choice.preference)}
													value={choice}
												>
													{modelChoicePresentation(choice)}
													{modelPreferenceValue(choice.preference) ===
													input.savedValue ? (
														<span className="ml-auto text-muted-foreground text-xs">
															Current
														</span>
													) : null}
													<Combobox.ItemIndicator>
														<CheckIcon
															aria-hidden="true"
															className="size-4 shrink-0"
														/>
													</Combobox.ItemIndicator>
												</Combobox.Item>
											)}
										</Combobox.List>
									</Combobox.Popup>
								</Combobox.Positioner>
							</Combobox.Portal>
						</Combobox.Root>
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

function modelProviderId(choice: CenterAgentModelChoice): string | null {
	return choice.preference.kind === "selected_model"
		? choice.preference.modelId.split("/")[0]
		: null;
}

function modelProviderLabel(id: string): string {
	const labels: Record<string, string> = {
		anthropic: "Anthropic",
		deepseek: "DeepSeek",
		google: "Google",
		openai: "OpenAI",
		"x-ai": "xAI",
		"z-ai": "Z.ai",
	};
	return labels[id] ?? id;
}
