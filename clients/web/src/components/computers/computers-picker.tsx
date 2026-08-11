"use client";

import { SettingsAddComputerCardContent } from "@openmeld/ui/components/settings-computers";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	ADD_CARD_PICKER_CLASS_NAME,
	CARD_PICKER_GRID_CLASS_NAME,
	cardPickerCardClassName,
} from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { resolveComputerRecordState } from "#/components/agents/agents-page-computer";
import {
	ComputerActionsDialog,
	ComputerSummaryCardContent,
} from "#/components/agents/agents-page-computer-tabs";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import {
	DirectoryCardGrid,
	DirectoryCardItem,
	DirectoryOwnerGroup,
} from "#/components/directory/directory-card-grid";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { resolveConnectedLocalRuntime } from "#/lib/connect/connected-runtime";
import { buildOrganizationComputerPath } from "#/lib/organizations/organization-routes";
import {
	resolveCurrentLocalRuntimeServiceConnectionStatus,
	resolveCurrentLocalRuntimeSettingsAttention,
	resolveCurrentLocalRuntimeSettingsAttentionDeviceId,
	resolveCurrentLocalRuntimeSubjectDeviceId,
} from "#/lib/settings-attention";
import { OrganizationComputerPickerCard } from "./organization-computer-card";
import {
	formatComputerCount,
	type OrganizationComputerGroup,
} from "./organization-computers";

type LocalAgentRecoveryController = ReturnType<
	typeof useLocalAgentRecoveryController
>;

export function ComputersPicker(input: {
	computerGroups: readonly OrganizationComputerGroup[];
	directoryError: string | null;
	directoryIsPending: boolean;
	isOrganizationContext: boolean;
	isPending: boolean;
	isReconcilingCurrentToolsStatus: boolean;
	orgSlug: string;
	recovery: LocalAgentRecoveryController;
}) {
	if (input.isPending) {
		return (
			<div
				className={CARD_PICKER_GRID_CLASS_NAME}
				data-testid="computers-picker-loading"
			>
				<Skeleton className="h-40 w-full" />
				<Skeleton className="h-40 w-full" />
			</div>
		);
	}

	const currentReadiness = input.isReconcilingCurrentToolsStatus
		? null
		: (input.recovery.currentLocalRuntimeReplyReadinessQuery.data ?? null);
	const currentRuntimeSubjectDeviceId =
		resolveCurrentLocalRuntimeSubjectDeviceId(currentReadiness) ??
		resolveConnectedLocalRuntime(input.recovery)?.deviceId ??
		input.recovery.localRuntimesQuery.data?.currentDeviceId ??
		null;
	const settingsAttention =
		resolveCurrentLocalRuntimeSettingsAttention(currentReadiness);
	const settingsAttentionDeviceId =
		resolveCurrentLocalRuntimeSettingsAttentionDeviceId(currentReadiness) ??
		(settingsAttention ? currentRuntimeSubjectDeviceId : null);
	const serviceConnectionStatus =
		resolveCurrentLocalRuntimeServiceConnectionStatus(currentReadiness);
	const currentUserGroup = input.computerGroups.find(
		(group) => group.isCurrentUser
	);
	const otherMemberGroups = input.computerGroups.filter(
		(group) => !group.isCurrentUser
	);
	const ownedComputers =
		currentUserGroup?.computers.flatMap((computer) =>
			computer.ownedComputer ? [computer.ownedComputer] : []
		) ?? [];
	const renderGroupGrid = (group: OrganizationComputerGroup) => (
		<DirectoryCardGrid
			data-testid={group.isCurrentUser ? "computers-picker-list" : undefined}
		>
			{group.computers.map((computer) => {
				if (!computer.ownedComputer) {
					return (
						<DirectoryCardItem itemId={computer.routeId} key={computer.routeId}>
							<OrganizationComputerPickerCard
								computer={computer}
								orgSlug={input.orgSlug}
							/>
						</DirectoryCardItem>
					);
				}
				const device = computer.ownedComputer;
				return (
					<DirectoryCardItem itemId={computer.routeId} key={computer.routeId}>
						<ComputerPickerCard
							attention={
								device.deviceId === settingsAttentionDeviceId
									? settingsAttention
									: null
							}
							device={device}
							devices={ownedComputers}
							orgSlug={input.orgSlug}
							recovery={input.recovery}
							serviceConnectionStatus={
								device.deviceId === currentRuntimeSubjectDeviceId
									? serviceConnectionStatus
									: null
							}
						/>
					</DirectoryCardItem>
				);
			})}
			{group.isCurrentUser ? (
				<DirectoryCardItem
					className="bg-transparent"
					itemId={`${group.ownerUserId}:add-computer`}
				>
					<AddComputerPickerCard orgSlug={input.orgSlug} />
				</DirectoryCardItem>
			) : null}
		</DirectoryCardGrid>
	);

	if (!input.isOrganizationContext && currentUserGroup) {
		return renderGroupGrid(currentUserGroup);
	}

	return (
		<div className="flex flex-col gap-5">
			{currentUserGroup ? (
				<DirectoryOwnerGroup
					countLabel={formatComputerCount(currentUserGroup.computers.length)}
					ownerLabel={currentUserGroup.ownerLabel}
				>
					{renderGroupGrid(currentUserGroup)}
				</DirectoryOwnerGroup>
			) : null}
			{otherMemberGroups.map((group) => (
				<DirectoryOwnerGroup
					countLabel={formatComputerCount(group.computers.length)}
					key={group.ownerUserId}
					ownerLabel={group.ownerLabel}
				>
					{renderGroupGrid(group)}
				</DirectoryOwnerGroup>
			))}
			{input.directoryIsPending ? (
				<output className="text-muted-foreground text-xs">
					Loading other members&apos; computers…
				</output>
			) : null}
			{input.directoryError ? (
				<output className="text-destructive text-xs">
					{input.directoryError}
				</output>
			) : null}
		</div>
	);
}

function AddComputerPickerCard(input: { orgSlug: string }) {
	return (
		<Link
			aria-label="Add a Computer"
			className={ADD_CARD_PICKER_CLASS_NAME}
			data-testid="add-computer-picker-card"
			to={buildConnectComputerPath({
				orgSlug: input.orgSlug,
				session: "fresh",
			})}
		>
			<SettingsAddComputerCardContent />
		</Link>
	);
}

function ComputerPickerCard(input: {
	attention: Parameters<typeof ComputerSummaryCardContent>[0]["attention"];
	device: Parameters<typeof ComputerSummaryCardContent>[0]["device"];
	devices: Parameters<typeof resolveComputerRecordState>[0]["devices"];
	orgSlug: string;
	recovery: LocalAgentRecoveryController;
	serviceConnectionStatus: Parameters<
		typeof ComputerSummaryCardContent
	>[0]["serviceConnectionStatus"];
}) {
	const recordState = resolveComputerRecordState({
		device: input.device,
		devices: input.devices,
	});
	return (
		<div
			className="relative h-full"
			data-testid={`computer-picker-card-${input.device.deviceId}`}
		>
			<Link
				aria-label={`Open ${input.device.deviceDisplayName} details`}
				className={cn(
					cardPickerCardClassName({
						muted: recordState.kind === "older_same_name_record",
					}),
					"bg-transparent hover:border-border"
				)}
				to={buildOrganizationComputerPath({
					deviceId: input.device.deviceId,
					orgSlug: input.orgSlug,
				})}
			>
				<ComputerSummaryCardContent
					attention={input.attention}
					device={input.device}
					recordState={recordState}
					serviceConnectionStatus={input.serviceConnectionStatus}
				/>
			</Link>
			<div className="absolute top-3 right-3 z-20 flex items-center gap-2">
				<ComputerActionsDialog
					computer={input.device}
					recordState={recordState}
					recovery={input.recovery}
				/>
			</div>
		</div>
	);
}
