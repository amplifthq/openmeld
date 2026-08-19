"use client";

import type {
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { hasLocalAgentLogo } from "@openmeld/ui/components/local-agent-logo-utils";
import { SettingsComputerSummaryCardContent } from "@openmeld/ui/components/settings-computers";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { cn } from "@openmeld/ui/lib/utils";
import { DotsThreeIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { ForgetThisComputerAction } from "#/components/agents/forget-this-computer-action";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import type { ComputerSummaryStatus } from "#/lib/computer-summary-status";
import {
	type ComputerRecordState,
	formatComputerDialogDevice,
	formatComputerDialogLane,
	formatComputerTabAriaLabel,
	formatComputerTabLastSeen,
	formatComputerTabLocalAgents,
	formatComputerTabPlatform,
	resolveComputerRecordState,
	resolveCurrentExecutionTarget,
	SHOW_RUNTIME_LANE_TO_USER,
} from "./agents-page-computer";
import {
	formatMutationError,
	formatObservedAt,
} from "./agents-page-formatters";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;
type DeviceAgentCatalogEntry =
	LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"][number];

const COMPUTER_TABS_ID = "agents-computer-tabs";

export function ComputerTabs(input: {
	devices: readonly LocalRuntimeComputer[];
	recovery: AgentsPageController;
	selectedIndex: number;
	setSelectedDeviceId: (deviceId: string) => void;
}) {
	return (
		<div className="overflow-x-auto pb-1">
			<TabsSubtle
				aria-label="Computers"
				className="items-stretch gap-3 bg-transparent p-0"
				idPrefix={COMPUTER_TABS_ID}
				onSelect={(nextIndex) => {
					const nextDevice = input.devices[nextIndex];
					if (!nextDevice) {
						return;
					}

					input.setSelectedDeviceId(nextDevice.deviceId);
				}}
				selectedIndex={input.selectedIndex}
			>
				{input.devices.map((device, index) => {
					const recordState = resolveComputerRecordState({
						device,
						devices: input.devices,
					});
					return (
						<div className="relative shrink-0" key={device.deviceId}>
							<TabsSubtleItem
								aria-label={formatComputerTabAriaLabel({
									device,
									recordState,
								})}
								className={cn(
									"h-32 w-[22rem] items-stretch border border-border/70 bg-card/45 p-0 text-left transition-[border-color,background-color] duration-150 group-data-[state=active]:border-foreground/20 group-data-[state=active]:bg-transparent",
									recordState.kind === "older_same_name_record" &&
										"border-dashed bg-muted/20"
								)}
								index={index}
								label={device.deviceDisplayName}
							>
								<ComputerSummaryCardContent
									device={device}
									recordState={recordState}
									status={null}
								/>
							</TabsSubtleItem>
							<div className="absolute top-3 right-3 z-20 flex items-center gap-2">
								<ComputerActionsDialog
									computer={device}
									recordState={recordState}
									recovery={input.recovery}
								/>
							</div>
						</div>
					);
				})}
			</TabsSubtle>
		</div>
	);
}

export function ComputerSummaryCardContent(input: {
	device: LocalRuntimeComputer;
	recordState: ComputerRecordState;
	status: ComputerSummaryStatus | null;
}) {
	const executionTarget = resolveCurrentExecutionTarget(input.device);
	const localAgentIcons = resolveComputerTabLocalAgentIcons(executionTarget);

	return (
		<SettingsComputerSummaryCardContent
			lastSeenLabel={formatComputerTabLastSeen({
				recordState: input.recordState,
				value: input.device.lastObservedAtMs,
			})}
			localAgents={localAgentIcons}
			localAgentsSummaryLabel={formatComputerTabLocalAgents(executionTarget)}
			name={input.device.deviceDisplayName}
			platformLabel={formatComputerTabPlatform(input.device)}
			recordBadgeLabel={
				input.recordState.kind === "older_same_name_record"
					? "Older record"
					: null
			}
			status={input.status}
			statusIndicatorTestId={`computer-status-dot-${input.device.deviceId}`}
		/>
	);
}

type ComputerTabLocalAgentIcon = {
	agentId: string;
	displayName: string;
};

function resolveComputerTabLocalAgentIcons(
	executionTarget: LocalRuntimeExecutionTarget | null
): readonly ComputerTabLocalAgentIcon[] {
	if (executionTarget === null || executionTarget.status === "stale") {
		return [];
	}

	const icons: ComputerTabLocalAgentIcon[] = [];
	for (const entry of executionTarget.localAgentCatalog.entries) {
		if (isComputerTabLocalAgentIconEntry(entry)) {
			icons.push({
				agentId: entry.agentId,
				displayName: entry.displayName,
			});
		}
	}
	return icons;
}

function isComputerTabLocalAgentIconEntry(
	entry: DeviceAgentCatalogEntry
): boolean {
	return (
		entry.detected &&
		entry.selectable &&
		entry.lifecycleStatus !== "suspended" &&
		hasLocalAgentLogo(entry.agentId)
	);
}

export function ComputerActionsDialog(input: {
	computer: LocalRuntimeComputer;
	recordState: ComputerRecordState;
	recovery: AgentsPageController;
}) {
	const [isRenaming, setIsRenaming] = useState(false);
	const [draftName, setDraftName] = useState(input.computer.deviceDisplayName);
	const [message, setMessage] = useState<string | null>(null);
	const [isSavingName, setIsSavingName] = useState(false);

	const saveName = async (displayName: string | null) => {
		const trimmedName = displayName?.trim() ?? null;
		if (displayName !== null && (!trimmedName || trimmedName.length === 0)) {
			setMessage("Enter a computer name or use system name.");
			return;
		}

		setIsSavingName(true);
		setMessage(null);

		try {
			await input.recovery.setComputerDisplayName({
				deviceId: input.computer.deviceId,
				displayName: trimmedName,
			});
			setMessage(
				trimmedName === null
					? "OpenMeld will use this computer's system name."
					: "Computer name saved."
			);
			setIsRenaming(false);
		} catch (error) {
			setMessage(formatMutationError(error, "Failed to update computer name."));
		} finally {
			setIsSavingName(false);
		}
	};

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					return;
				}
				setDraftName(input.computer.deviceDisplayName);
				setMessage(null);
				setIsRenaming(false);
			}}
		>
			<DialogTrigger
				render={
					<Button
						aria-label={`Computer options for ${input.computer.deviceDisplayName}`}
						size="icon-sm"
						type="button"
						variant="ghost"
					/>
				}
			>
				<DotsThreeIcon aria-hidden="true" className="h-4 w-4" />
			</DialogTrigger>
			<DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Computer details</DialogTitle>
					<DialogDescription>
						Review this computer, rename it, or remove it from this OpenMeld
						account.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<dl className="border border-border">
						<ComputerContextRow
							label="Computer"
							value={input.computer.deviceDisplayName}
						/>
						<ComputerContextRow
							label="Status"
							value={formatComputerDialogRecordStatus({
								computer: input.computer,
								recordState: input.recordState,
							})}
						/>
						<ComputerContextRow
							label="Device"
							value={formatComputerDialogDevice(input.computer)}
						/>
						{SHOW_RUNTIME_LANE_TO_USER ? (
							<ComputerContextRow
								label="Lane"
								value={formatComputerDialogLane(input.computer)}
							/>
						) : null}
						<ComputerContextRow
							label="Local agents"
							value={formatComputerTabLocalAgents(
								resolveCurrentExecutionTarget(input.computer)
							)}
						/>
						<ComputerContextRow
							label="First seen"
							value={formatObservedAt(input.computer.firstSeenAtMs)}
						/>
						<ComputerContextRow
							label="Last seen"
							value={formatObservedAt(input.computer.lastObservedAtMs)}
						/>
					</dl>

					<div className="space-y-3 border border-border p-3">
						<div className="flex items-center justify-between gap-3">
							<div>
								<h3 className="font-medium text-sm">Rename</h3>
								<p className="text-muted-foreground text-xs">
									Use a clear name you will recognize later.
								</p>
							</div>
							{isRenaming ? null : (
								<Button
									onClick={() => {
										setIsRenaming(true);
										setMessage(null);
									}}
									size="sm"
									type="button"
									variant="outline"
								>
									<PencilSimpleIcon
										aria-hidden="true"
										data-icon="inline-start"
									/>
									Rename
								</Button>
							)}
						</div>

						{isRenaming ? (
							<div className="space-y-3">
								<div className="space-y-2">
									<Label
										htmlFor={`agents-computer-tab-name-${input.computer.deviceId}`}
									>
										Computer name
									</Label>
									<Input
										disabled={isSavingName}
										id={`agents-computer-tab-name-${input.computer.deviceId}`}
										onChange={(event) => setDraftName(event.target.value)}
										placeholder="Office MacBook"
										value={draftName}
									/>
								</div>
								<div className="flex flex-wrap gap-2">
									<Button
										disabled={isSavingName}
										onClick={() => {
											saveName(draftName).catch((error: unknown) => {
												console.error("Failed to save computer name.", error);
											});
										}}
										size="sm"
										type="button"
									>
										Save name
									</Button>
									<Button
										disabled={isSavingName}
										onClick={() => {
											saveName(null).catch((error: unknown) => {
												console.error(
													"Failed to use system computer name.",
													error
												);
											});
										}}
										size="sm"
										type="button"
										variant="outline"
									>
										Use system name
									</Button>
									<Button
										disabled={isSavingName}
										onClick={() => {
											setIsRenaming(false);
											setDraftName(input.computer.deviceDisplayName);
											setMessage(null);
										}}
										size="sm"
										type="button"
										variant="ghost"
									>
										Cancel
									</Button>
								</div>
							</div>
						) : null}
					</div>

					<div className="space-y-3 rounded-md border border-destructive/30 p-3">
						<div>
							<h3 className="font-medium text-destructive text-sm">
								Remove computer
							</h3>
							<p className="text-muted-foreground text-xs">
								{input.recordState.kind === "older_same_name_record"
									? "Remove this older record if you no longer use it."
									: "Remove this computer record from your OpenMeld account."}
							</p>
						</div>
						<ForgetThisComputerAction
							compact
							computerName={input.computer.deviceDisplayName}
							helperText={null}
							onForget={async () => {
								setMessage(null);
								await input.recovery.forgetComputer({
									deviceId: input.computer.deviceId,
								});
							}}
							onForgotten={() => {
								setMessage(
									input.computer.isCurrent
										? "This computer was forgotten. Set it up again when you want local agents here."
										: "This computer was forgotten."
								);
								input.recovery.refreshAll().catch((error: unknown) => {
									console.error(
										"Failed to refresh computers after forgetting one.",
										error
									);
								});
							}}
						/>
					</div>

					{message ? (
						<p
							className={cn(
								"text-xs",
								message.startsWith("Failed") || message.startsWith("Enter")
									? "text-destructive"
									: "text-muted-foreground"
							)}
						>
							{message}
						</p>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}

function formatComputerDialogRecordStatus(input: {
	computer: LocalRuntimeComputer;
	recordState: ComputerRecordState;
}): string {
	if (input.recordState.kind === "older_same_name_record") {
		return "Older record for this computer name";
	}
	if (input.computer.isCurrent) {
		return "Active in this browser";
	}
	return "Not active in this browser";
}

function ComputerContextRow(input: { label: string; value: string }) {
	return (
		<div className="grid gap-1 border-border border-b px-3 py-2.5 last:border-b-0 sm:grid-cols-[8rem_1fr] sm:gap-3">
			<dt className="text-muted-foreground text-xs">{input.label}</dt>
			<dd className="min-w-0 break-words font-medium text-foreground text-xs">
				{input.value}
			</dd>
		</div>
	);
}
