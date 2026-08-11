"use client";

import type { CenterAgentRoutineTargetSpace } from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { cn } from "@openmeld/ui/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { resolveCenterAgentRoutineErrorMessage } from "#/lib/organizations/center-agent-routines";
import { buildOrganizationSpacesPath } from "#/lib/organizations/organization-routes";
import { centerAgentRoutineTargetSpacesQueryOptions } from "#/query/organizations/center-agent-routines";

export type CenterAgentRoutineTargetSpacePreparation = {
	errorMessage: string | null;
	isPending: boolean;
	isReady: boolean;
	onRetry: () => void;
};

export type CenterAgentRoutineTargetSpaceFieldState = {
	currentTargetUnavailable: boolean;
	errorMessage: string | null;
	isEligibleTarget: boolean;
	isLoading: boolean;
	isRetrying: boolean;
	selectedLabel: string | undefined;
	selectedSpace: CenterAgentRoutineTargetSpace | undefined;
	showEmptyState: boolean;
	showPicker: boolean;
	spaces: CenterAgentRoutineTargetSpace[];
};

const TARGET_SPACE_ERROR_ID = "routine-target-space-error";
const UNAVAILABLE_TARGET_MESSAGE =
	"This routine's current target is no longer available. Choose an eligible replacement before saving this routine.";

export function useCenterAgentRoutineTargetSpaceFieldState(input: {
	currentTargetSpaceId?: string;
	mode: "create" | "edit";
	organizationId: string;
	preparation: CenterAgentRoutineTargetSpacePreparation;
	targetSpaceId: string;
}): CenterAgentRoutineTargetSpaceFieldState {
	const spacesQuery = useQuery(
		centerAgentRoutineTargetSpacesQueryOptions({
			enabled: input.preparation.isReady,
			organizationId: input.organizationId,
		})
	);
	const spaces = spacesQuery.data?.spaces ?? [];
	return resolveTargetSpaceFieldState({
		currentTargetSpaceId: input.currentTargetSpaceId,
		mode: input.mode,
		preparation: input.preparation,
		queryError: spacesQuery.error,
		queryIsError: spacesQuery.isError,
		queryIsPending: spacesQuery.isPending,
		queryIsRefetching: spacesQuery.isRefetching,
		queryIsSuccess: spacesQuery.isSuccess,
		spaces,
		targetSpaceId: input.targetSpaceId,
	});
}

export function CenterAgentRoutineTargetSpaceField(input: {
	ariaLabel?: string;
	currentTargetSpaceId?: string;
	fieldState: CenterAgentRoutineTargetSpaceFieldState;
	helpText?: string;
	label?: string;
	onRetry: () => void;
	onTargetSpaceChange: (spaceId: string) => void;
	orgSlug: string;
	targetSpaceId: string;
}) {
	const fieldState = input.fieldState;
	const accessibility = resolveTargetSpaceFieldAccessibility(fieldState);
	const label = input.label ?? "Target Space";
	const ariaLabel = input.ariaLabel ?? label;

	return (
		<div aria-busy={fieldState.isLoading} className="grid gap-1.5">
			<Label htmlFor="routine-target-space">{label}</Label>
			{fieldState.isLoading ? (
				<output className="block text-muted-foreground text-xs">
					Preparing eligible target Spaces.
				</output>
			) : null}
			{fieldState.errorMessage ? (
				<div className="flex flex-wrap items-center gap-3">
					<p
						className="break-words text-destructive text-xs"
						id={TARGET_SPACE_ERROR_ID}
						role="alert"
						tabIndex={-1}
					>
						{fieldState.errorMessage}
					</p>
					<Button
						disabled={fieldState.isRetrying}
						onClick={input.onRetry}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry target Spaces
					</Button>
				</div>
			) : null}
			{fieldState.showPicker ? (
				<Select
					onValueChange={input.onTargetSpaceChange}
					value={
						fieldState.selectedSpace || fieldState.currentTargetUnavailable
							? input.targetSpaceId
							: ""
					}
				>
					<SelectTrigger
						aria-errormessage={accessibility.unavailableTargetErrorId}
						aria-invalid={fieldState.currentTargetUnavailable}
						aria-label={ariaLabel}
						displayValue={fieldState.selectedLabel}
						error={
							fieldState.currentTargetUnavailable
								? UNAVAILABLE_TARGET_MESSAGE
								: undefined
						}
						id="routine-target-space"
						placeholder="Choose a Space"
					/>
					<SelectContent>
						{fieldState.currentTargetUnavailable ? (
							<SelectItem
								disabled
								index={0}
								value={input.currentTargetSpaceId ?? input.targetSpaceId}
							>
								Current target (unavailable)
							</SelectItem>
						) : null}
						{fieldState.spaces.map((space, index) => (
							<SelectItem
								className="min-w-0 break-words"
								index={index + accessibility.optionIndexOffset}
								key={space.spaceId}
								value={space.spaceId}
							>
								{formatTargetSpaceLabel(space)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			) : null}
			{input.helpText ? (
				<p className="text-muted-foreground text-xs leading-5">
					{input.helpText}
				</p>
			) : null}
			{fieldState.currentTargetUnavailable ? (
				<span className="sr-only" id={TARGET_SPACE_ERROR_ID}>
					{UNAVAILABLE_TARGET_MESSAGE}
				</span>
			) : null}
			{fieldState.showEmptyState ? (
				<div
					className="border border-border/70 bg-muted/20 p-3"
					id={accessibility.emptyStateErrorId}
					tabIndex={accessibility.emptyStateTabIndex}
				>
					<p className="text-foreground text-xs">
						{accessibility.emptyStateMessage}
					</p>
					<a
						className={cn(
							buttonVariants({ size: "sm", variant: "outline" }),
							"mt-3"
						)}
						href={buildOrganizationSpacesPath(input.orgSlug)}
					>
						Go to Spaces
					</a>
				</div>
			) : null}
		</div>
	);
}

function resolveTargetSpaceFieldAccessibility(
	fieldState: CenterAgentRoutineTargetSpaceFieldState
) {
	const emptyStateOwnsError =
		fieldState.showEmptyState &&
		!fieldState.currentTargetUnavailable &&
		!fieldState.errorMessage;
	return {
		emptyStateErrorId: emptyStateOwnsError ? TARGET_SPACE_ERROR_ID : undefined,
		emptyStateMessage: fieldState.currentTargetUnavailable
			? "No eligible replacement Spaces are available. This routine cannot be saved until you create or join a Space where the Center Agent can publish."
			: "No eligible target Spaces are available. Create or join a Space where the Center Agent can publish, then try again.",
		emptyStateTabIndex: emptyStateOwnsError ? -1 : undefined,
		optionIndexOffset: fieldState.currentTargetUnavailable ? 1 : 0,
		unavailableTargetErrorId: fieldState.currentTargetUnavailable
			? TARGET_SPACE_ERROR_ID
			: undefined,
	};
}

function resolveTargetSpaceFieldState(input: {
	currentTargetSpaceId?: string;
	mode: "create" | "edit";
	preparation: CenterAgentRoutineTargetSpacePreparation;
	queryError: unknown;
	queryIsError: boolean;
	queryIsPending: boolean;
	queryIsRefetching: boolean;
	queryIsSuccess: boolean;
	spaces: CenterAgentRoutineTargetSpace[];
	targetSpaceId: string;
}) {
	const selectedSpace = input.spaces.find(
		(space) => space.spaceId === input.targetSpaceId
	);
	const ownerTruthReady = input.preparation.isReady && input.queryIsSuccess;
	const currentTargetUnavailable =
		input.mode === "edit" &&
		ownerTruthReady &&
		input.targetSpaceId === input.currentTargetSpaceId &&
		selectedSpace === undefined;
	let errorMessage = input.preparation.errorMessage;
	if (!errorMessage && input.queryIsError) {
		errorMessage = resolveCenterAgentRoutineErrorMessage(
			input.queryError,
			"target_spaces"
		);
	}
	let selectedLabel: string | undefined;
	if (selectedSpace) {
		selectedLabel = formatTargetSpaceLabel(selectedSpace);
	} else if (currentTargetUnavailable) {
		selectedLabel = "Current target (unavailable)";
	}
	return {
		currentTargetUnavailable,
		errorMessage,
		isEligibleTarget: ownerTruthReady && selectedSpace !== undefined,
		isLoading:
			input.preparation.isPending ||
			(input.preparation.isReady && input.queryIsPending),
		isRetrying: input.preparation.isPending || input.queryIsRefetching,
		selectedLabel,
		selectedSpace,
		showEmptyState: ownerTruthReady && input.spaces.length === 0,
		showPicker:
			ownerTruthReady && (input.spaces.length > 0 || currentTargetUnavailable),
		spaces: input.spaces,
	};
}

function formatTargetSpaceLabel(input: CenterAgentRoutineTargetSpace): string {
	return input.kind === "center_agent_dm"
		? `${input.name} — Center Agent conversation`
		: input.name;
}
