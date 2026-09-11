import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	PostSpaceWakeStopResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import { StopIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { createContext, useContext, useState } from "react";
import {
	resolveWakeStopTargetForProgressItem,
	type SpaceWakeStopRequestStatus,
	type SpaceWakeStopTargetResolution,
} from "#/lib/spaces/wake-stop-target";

export type SpaceWakeStopRequestHandler = (
	target: SpaceWakeStopTargetResolution
) => Promise<PostSpaceWakeStopResponse>;

type StopSelection = {
	targets: readonly SpaceWakeStopTargetResolution[];
	onStopWake: SpaceWakeStopRequestHandler;
};
const StopDialogContext = createContext<
	((selection: StopSelection) => void) | null
>(null);

/** The confirmation belongs to the conversation, not to a row that can move. */
export function SpaceWakeStopScope(input: {
	children: ReactNode;
	progressItems?: readonly WakeProgressItem[];
	stopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
}) {
	const [selection, setSelection] = useState<StopSelection | null>(null);
	return (
		<StopDialogContext.Provider value={setSelection}>
			{input.children}
			{selection ? (
				<SpaceWakeStopDialog
					onClose={() =>
						setSelection((current) => (current === selection ? null : current))
					}
					progressItems={input.progressItems ?? []}
					selection={selection}
					stopRequestStatusBySelectorKey={input.stopRequestStatusBySelectorKey}
				/>
			) : null}
		</StopDialogContext.Provider>
	);
}

export function SpaceWakeStopControl(input: {
	className?: string;
	onStopWake: SpaceWakeStopRequestHandler;
	target?: SpaceWakeStopTargetResolution | null;
	targets?: readonly SpaceWakeStopTargetResolution[];
	variant?: "timeline" | "details";
}) {
	const openDialog = useContext(StopDialogContext);
	if (!openDialog) {
		return (
			<SpaceWakeStopScope>
				<SpaceWakeStopControl {...input} />
			</SpaceWakeStopScope>
		);
	}
	const variant = input.variant ?? "timeline";
	const targets = normalizeWakeStopTargets(input.targets ?? input.target);
	const renderableTargets = targets.filter((target) =>
		shouldRenderSpaceWakeStopTarget(target, variant)
	);
	const primaryTarget = renderableTargets[0] ?? null;

	if (!primaryTarget) {
		return null;
	}

	const singleTargetState = renderSingleWakeStopTargetState({
		className: input.className,
		target: primaryTarget,
		targetCount: renderableTargets.length,
		variant,
	});
	if (singleTargetState) {
		return singleTargetState;
	}

	const targetLabel = resolveWakeStopTargetLabel(primaryTarget, {
		fallback: "this agent",
	});
	const controlLabel = resolveWakeStopControlLabel({
		isPending: false,
		targetCount: renderableTargets.length,
		targets: renderableTargets,
		status: primaryTarget.status,
		targetLabel,
	});
	const disabled = !renderableTargets.some((target) => target.canStop === true);
	const statusCopy = resolveWakeStopStatusCopy(primaryTarget.status);
	const buttonText = resolveWakeStopButtonText({
		isPending: false,
		targets: renderableTargets,
	});

	return (
		<div
			className={cn(
				variant === "timeline"
					? "inline-flex shrink-0 items-center"
					: "flex min-w-0 flex-col items-start gap-1.5",
				input.className
			)}
		>
			<Button
				aria-label={controlLabel}
				className={cn(
					variant === "timeline" && surfaceClasses(2),
					variant === "timeline"
						? "rounded-full px-1.5 py-0 text-foreground max-lg:min-h-0 max-lg:min-w-0"
						: "text-muted-foreground hover:text-foreground"
				)}
				disabled={disabled}
				onClick={() => {
					openDialog({
						targets: renderableTargets,
						onStopWake: input.onStopWake,
					});
				}}
				size={variant === "details" ? "sm" : "xs"}
				type="button"
				variant={variant === "details" ? "outline" : "ghost"}
			>
				<StopIcon aria-hidden="true" weight="fill" />
				<span>{buttonText}</span>
			</Button>
			{variant === "details" && statusCopy ? (
				<p className="text-muted-foreground text-xs leading-5">{statusCopy}</p>
			) : null}
		</div>
	);
}

function SpaceWakeStopDialog(input: {
	selection: StopSelection;
	progressItems: readonly WakeProgressItem[];
	stopRequestStatusBySelectorKey?: ReadonlyMap<
		string,
		SpaceWakeStopRequestStatus
	>;
	onClose: () => void;
}) {
	const [pendingSelectorKeys, setPendingSelectorKeys] = useState<
		ReadonlySet<string>
	>(() => new Set());
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [dialogTargetSnapshots, setDialogTargetSnapshots] = useState<
		readonly SpaceWakeStopTargetResolution[] | null
	>(input.selection.targets);
	const targets = input.progressItems.map((item) =>
		resolveWakeStopTargetForProgressItem({
			item,
			stopRequestStatusBySelectorKey: input.stopRequestStatusBySelectorKey,
		})
	);
	const dialogTargets = resolveWakeStopDialogTargets({
		dialogTargetSnapshots,
		renderableTargets: input.selection.targets,
		targets,
	});
	const dialogPrimaryTarget = dialogTargets[0];
	const setOpen = (open: boolean) => {
		if (!open) {
			input.onClose();
		}
	};
	return (
		<Dialog onOpenChange={setOpen} open={true}>
			<DialogContent>
				{dialogTargets.length > 1 ? (
					<MultiTargetWakeStopDialog
						onStopWake={input.selection.onStopWake}
						pendingSelectorKeys={pendingSelectorKeys}
						setPendingSelectorKeys={setPendingSelectorKeys}
						setStatusMessage={setStatusMessage}
						setStoppedTargetSnapshot={setDialogTargetSnapshots}
						statusMessage={statusMessage}
						targets={dialogTargets}
					/>
				) : null}
				{dialogTargets.length === 1 && dialogPrimaryTarget ? (
					<SingleTargetWakeStopDialog
						onStopWake={input.selection.onStopWake}
						pendingSelectorKeys={pendingSelectorKeys}
						setOpen={setOpen}
						setPendingSelectorKeys={setPendingSelectorKeys}
						setStatusMessage={setStatusMessage}
						setStoppedTargetSnapshot={setDialogTargetSnapshots}
						statusMessage={statusMessage}
						target={dialogPrimaryTarget}
					/>
				) : null}
				{dialogTargets.length === 0 ? (
					<>
						<DialogHeader>
							<DialogTitle>This Wake is no longer stoppable</DialogTitle>
							<DialogDescription>
								Its status has changed. Close this dialog to see the latest
								update.
							</DialogDescription>
						</DialogHeader>
						<DialogClose render={<Button variant="outline" />}>
							Close
						</DialogClose>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
}

function resolveWakeStopDialogTargets(input: {
	dialogTargetSnapshots: readonly SpaceWakeStopTargetResolution[] | null;
	renderableTargets: readonly SpaceWakeStopTargetResolution[];
	targets: readonly SpaceWakeStopTargetResolution[];
}): readonly SpaceWakeStopTargetResolution[] {
	if (
		!input.dialogTargetSnapshots ||
		input.dialogTargetSnapshots.length === 0
	) {
		return input.renderableTargets;
	}
	const targetByKey = new Map<string, SpaceWakeStopTargetResolution>();
	for (const target of input.targets) {
		const key = resolveWakeStopTargetDialogKey(target);
		if (key) {
			targetByKey.set(key, target);
		}
	}
	return input.dialogTargetSnapshots
		.map((snapshot) => {
			const key = resolveWakeStopTargetDialogKey(snapshot);
			return key ? (targetByKey.get(key) ?? snapshot) : snapshot;
		})
		.filter((target): target is SpaceWakeStopTargetResolution =>
			Boolean(
				target?.selector &&
					target.status !== "not_stoppable" &&
					target.status !== "unavailable"
			)
		);
}

function resolveWakeStopTargetDialogKey(
	target: SpaceWakeStopTargetResolution
): string | null {
	return (
		target.selectorKey ??
		target.targetProfileId ??
		target.sourceSignalId ??
		target.targetLabel
	);
}

function renderSingleWakeStopTargetState(input: {
	className?: string;
	target: SpaceWakeStopTargetResolution;
	targetCount: number;
	variant: "timeline" | "details";
}): ReactNode | null {
	if (input.targetCount !== 1) {
		return null;
	}
	if (input.target.status === "stopped") {
		return (
			<p
				className={cn(
					"text-muted-foreground text-xs",
					input.variant === "details" ? "text-sm" : null,
					input.className
				)}
			>
				Wake was stopped.
			</p>
		);
	}
	if (input.target.status !== "unsupported" || input.variant !== "details") {
		return null;
	}
	return (
		<p
			className={cn("text-muted-foreground text-xs leading-5", input.className)}
		>
			Stop is not supported for this local agent.
		</p>
	);
}

export function shouldRenderSpaceWakeStopControl(
	target:
		| SpaceWakeStopTargetResolution
		| readonly SpaceWakeStopTargetResolution[]
		| null
		| undefined,
	variant: "timeline" | "details" = "timeline"
): boolean {
	return normalizeWakeStopTargets(target).some((candidate) =>
		shouldRenderSpaceWakeStopTarget(candidate, variant)
	);
}

function shouldRenderSpaceWakeStopTarget(
	target: SpaceWakeStopTargetResolution,
	variant: "timeline" | "details"
): boolean {
	if (!target.selector) {
		return false;
	}
	if (target.status === "not_stoppable" || target.status === "unavailable") {
		return false;
	}
	if (variant === "timeline" && target.status === "unsupported") {
		return false;
	}
	return variant === "details" || target.status !== "stopped";
}

async function handleConfirmStop(input: {
	onStopWake: SpaceWakeStopRequestHandler;
	setPendingSelectorKeys: (
		updater: (current: ReadonlySet<string>) => ReadonlySet<string>
	) => void;
	setOpen: (open: boolean) => void;
	setStatusMessage: (message: string | null) => void;
	setStoppedTargetSnapshot: (
		updater: (
			current: readonly SpaceWakeStopTargetResolution[] | null
		) => readonly SpaceWakeStopTargetResolution[] | null
	) => void;
	target: SpaceWakeStopTargetResolution;
}): Promise<void> {
	setWakeStopTargetPending({
		pending: true,
		setPendingSelectorKeys: input.setPendingSelectorKeys,
		target: input.target,
	});
	input.setStatusMessage(null);
	try {
		const response = await input.onStopWake(input.target);
		input.setStatusMessage(resolveWakeStopResponseMessage(response));
		input.setStoppedTargetSnapshot((current) =>
			updateWakeStopDialogTargetSnapshots({
				current,
				response,
				target: input.target,
			})
		);
		if (response.status === "cancellation_requested" || response.ok) {
			input.setOpen(false);
		}
	} catch (error) {
		input.setStatusMessage(resolveWakeStopRequestErrorMessage(error));
	} finally {
		setWakeStopTargetPending({
			pending: false,
			setPendingSelectorKeys: input.setPendingSelectorKeys,
			target: input.target,
		});
	}
}

async function handleConfirmStopAll(input: {
	onStopWake: SpaceWakeStopRequestHandler;
	setPendingSelectorKeys: (
		updater: (current: ReadonlySet<string>) => ReadonlySet<string>
	) => void;
	setStatusMessage: (message: string | null) => void;
	setStoppedTargetSnapshot: (
		updater: (
			current: readonly SpaceWakeStopTargetResolution[] | null
		) => readonly SpaceWakeStopTargetResolution[] | null
	) => void;
	targets: readonly SpaceWakeStopTargetResolution[];
}): Promise<void> {
	const stoppableTargets = input.targets.filter((target) => target.canStop);
	if (stoppableTargets.length === 0) {
		input.setStatusMessage("This Wake is no longer stoppable.");
		return;
	}

	input.setStatusMessage(null);
	let requestedCount = 0;
	for (const target of stoppableTargets) {
		setWakeStopTargetPending({
			pending: true,
			setPendingSelectorKeys: input.setPendingSelectorKeys,
			target,
		});
		try {
			const response = await input.onStopWake(target);
			input.setStoppedTargetSnapshot((current) =>
				updateWakeStopDialogTargetSnapshots({ current, response, target })
			);
			requestedCount += 1;
		} catch (error) {
			input.setStatusMessage(resolveWakeStopRequestErrorMessage(error));
			return;
		} finally {
			setWakeStopTargetPending({
				pending: false,
				setPendingSelectorKeys: input.setPendingSelectorKeys,
				target,
			});
		}
	}

	input.setStatusMessage(
		`Stop requested for ${requestedCount} ${requestedCount === 1 ? "agent" : "agents"}.`
	);
}

function SingleTargetWakeStopDialog(input: {
	onStopWake: SpaceWakeStopRequestHandler;
	pendingSelectorKeys: ReadonlySet<string>;
	setOpen: (open: boolean) => void;
	setPendingSelectorKeys: (
		updater: (current: ReadonlySet<string>) => ReadonlySet<string>
	) => void;
	setStatusMessage: (message: string | null) => void;
	setStoppedTargetSnapshot: (
		updater: (
			current: readonly SpaceWakeStopTargetResolution[] | null
		) => readonly SpaceWakeStopTargetResolution[] | null
	) => void;
	statusMessage: string | null;
	target: SpaceWakeStopTargetResolution;
}) {
	const targetLabel = resolveWakeStopTargetLabel(input.target, {
		fallback: "this agent",
	});
	const isPending = isWakeStopTargetPending({
		pendingSelectorKeys: input.pendingSelectorKeys,
		target: input.target,
	});
	const description = input.target.isWaitingForDevice
		? `Cancel this waiting task for ${targetLabel}. If it has just started, OpenMeld will request a stop instead.`
		: `OpenMeld will stop this Wake for ${targetLabel}. If the agent has already started, confirmation may take a moment.`;
	const actionLabel = input.target.isWaitingForDevice
		? "Cancel waiting"
		: "Stop Wake";
	const dismissLabel = input.target.isWaitingForDevice
		? "Keep waiting"
		: "Keep Running";

	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{input.target.isWaitingForDevice
						? "Cancel waiting?"
						: "Stop this Wake?"}
				</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
			</DialogHeader>
			{input.statusMessage ? (
				<p className="text-muted-foreground text-xs leading-5">
					{input.statusMessage}
				</p>
			) : null}
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					{isPending || input.target.status === "stopping"
						? "Close"
						: dismissLabel}
				</DialogClose>
				<Button
					disabled={isPending || !input.target.canStop}
					onClick={() => {
						handleConfirmStop({
							onStopWake: input.onStopWake,
							setOpen: input.setOpen,
							setPendingSelectorKeys: input.setPendingSelectorKeys,
							setStatusMessage: input.setStatusMessage,
							setStoppedTargetSnapshot: input.setStoppedTargetSnapshot,
							target: input.target,
						}).catch((error) => {
							console.error("Failed to stop a Space Wake.", error);
						});
					}}
					type="button"
					variant="destructive"
				>
					{isPending ? "Requesting Stop..." : actionLabel}
				</Button>
			</DialogFooter>
		</>
	);
}

function MultiTargetWakeStopDialog(input: {
	onStopWake: SpaceWakeStopRequestHandler;
	pendingSelectorKeys: ReadonlySet<string>;
	setPendingSelectorKeys: (
		updater: (current: ReadonlySet<string>) => ReadonlySet<string>
	) => void;
	setStatusMessage: (message: string | null) => void;
	setStoppedTargetSnapshot: (
		updater: (
			current: readonly SpaceWakeStopTargetResolution[] | null
		) => readonly SpaceWakeStopTargetResolution[] | null
	) => void;
	statusMessage: string | null;
	targets: readonly SpaceWakeStopTargetResolution[];
}) {
	const canStopTargets = input.targets.filter((target) => target.canStop);
	const hasPendingRequest = input.pendingSelectorKeys.size > 0;

	return (
		<>
			<DialogHeader>
				<DialogTitle>Stop agents in this Wake</DialogTitle>
				<DialogDescription>
					Choose which agent to stop. OpenMeld will keep the others running.
				</DialogDescription>
			</DialogHeader>
			<div className="flex flex-col divide-y divide-border/70">
				{input.targets.map((target) => {
					const targetLabel = resolveWakeStopTargetLabel(target, {
						fallback: "Agent",
						includeProfileIdFallback: true,
					});
					const isPending = isWakeStopTargetPending({
						pendingSelectorKeys: input.pendingSelectorKeys,
						target,
					});
					const rowStatus = resolveWakeStopTargetRowStatus({
						isPending,
						target,
					});
					return (
						<div
							className="flex min-w-0 items-center justify-between gap-3 py-3"
							key={target.selectorKey ?? target.targetProfileId ?? targetLabel}
						>
							<div className="min-w-0">
								<p className="truncate font-medium text-sm">{targetLabel}</p>
								<p className="text-muted-foreground text-xs leading-5">
									{rowStatus}
								</p>
							</div>
							<Button
								aria-label={resolveWakeStopTargetActionLabel({
									target,
									targetLabel,
								})}
								disabled={hasPendingRequest || !target.canStop}
								onClick={() => {
									handleConfirmStop({
										onStopWake: input.onStopWake,
										setOpen: () => undefined,
										setPendingSelectorKeys: input.setPendingSelectorKeys,
										setStatusMessage: input.setStatusMessage,
										setStoppedTargetSnapshot: input.setStoppedTargetSnapshot,
										target,
									}).catch((error) => {
										console.error("Failed to stop a Space Wake.", error);
									});
								}}
								size="sm"
								type="button"
								variant={target.canStop ? "destructive" : "outline"}
							>
								{resolveWakeStopTargetActionText({ isPending, target })}
							</Button>
						</div>
					);
				})}
			</div>
			{input.statusMessage ? (
				<p className="text-muted-foreground text-xs leading-5">
					{input.statusMessage}
				</p>
			) : null}
			<DialogFooter>
				<DialogClose render={<Button type="button" variant="outline" />}>
					Close
				</DialogClose>
				{canStopTargets.length > 1 ? (
					<Button
						disabled={hasPendingRequest}
						onClick={() => {
							handleConfirmStopAll({
								onStopWake: input.onStopWake,
								setPendingSelectorKeys: input.setPendingSelectorKeys,
								setStatusMessage: input.setStatusMessage,
								setStoppedTargetSnapshot: input.setStoppedTargetSnapshot,
								targets: canStopTargets,
							}).catch((error) => {
								console.error("Failed to stop Space Wake targets.", error);
							});
						}}
						type="button"
						variant="destructive"
					>
						Stop All
					</Button>
				) : null}
			</DialogFooter>
		</>
	);
}

function resolveWakeStopRequestErrorMessage(error: unknown): string {
	const failure = toStructuredApiClientFailure(error);
	return `OpenMeld couldn't request Stop. ${failure.message}`;
}

function updateWakeStopDialogTargetSnapshots(input: {
	current: readonly SpaceWakeStopTargetResolution[] | null;
	response: PostSpaceWakeStopResponse;
	target: SpaceWakeStopTargetResolution;
}): readonly SpaceWakeStopTargetResolution[] | null {
	if (!input.current || input.current.length === 0) {
		return input.current;
	}
	const targetKey = resolveWakeStopTargetDialogKey(input.target);
	if (!targetKey) {
		return input.current;
	}
	const nextTargetState = resolveWakeStopResponseTargetState(input.response);
	if (!nextTargetState) {
		return input.current;
	}
	return input.current.map((candidate) => {
		if (resolveWakeStopTargetDialogKey(candidate) !== targetKey) {
			return candidate;
		}
		return {
			...candidate,
			...nextTargetState,
		};
	});
}

function resolveWakeStopResponseTargetState(
	response: PostSpaceWakeStopResponse
): Pick<SpaceWakeStopTargetResolution, "canStop" | "status"> | null {
	switch (response.status) {
		case "already_cancelled":
		case "cancelled":
			return {
				canStop: false,
				status: "stopped",
			};
		case "cancellation_requested":
			return {
				canStop: false,
				status: "stopping",
			};
		case "retry_later":
			return {
				canStop: true,
				status: "retry_later",
			};
		case "unsupported":
			return {
				canStop: false,
				status: "unsupported",
			};
		case "not_found":
		case "not_stoppable":
			return {
				canStop: false,
				status: "not_stoppable",
			};
		default:
			return null;
	}
}

function resolveWakeStopControlLabel(input: {
	isPending: boolean;
	status: SpaceWakeStopTargetResolution["status"];
	targetCount: number;
	targetLabel: string;
	targets: readonly SpaceWakeStopTargetResolution[];
}): string {
	if (
		input.targets.length === 1 &&
		input.targets[0]?.isWaitingForDevice &&
		input.status === "active"
	) {
		return `Cancel waiting for ${input.targetLabel}`;
	}
	if (input.isPending) {
		return input.targetCount > 1
			? "Stop request pending for this Wake"
			: `Stop request pending for ${input.targetLabel}`;
	}
	if (input.targetCount > 1) {
		const stoppableCount = input.targets.filter(
			(target) => target.canStop
		).length;
		if (stoppableCount === 0) {
			return "Stop request pending for this Wake";
		}
		return `Stop Wake for ${input.targetCount} agents`;
	}
	switch (input.status) {
		case "stopping":
			return `Stop request pending for ${input.targetLabel}`;
		case "retry_later":
			return `Retry Stop for ${input.targetLabel}`;
		case "unsupported":
			return `Wake Stop unavailable for ${input.targetLabel}`;
		case "unavailable":
			return `Wake Stop unavailable for ${input.targetLabel}`;
		default:
			return `Stop Wake for ${input.targetLabel}`;
	}
}

function resolveWakeStopButtonText(input: {
	isPending: boolean;
	targets: readonly SpaceWakeStopTargetResolution[];
}): string {
	const hasStoppableTarget = input.targets.some((target) => target.canStop);
	const hasStoppingTarget = input.targets.some(
		(target) => target.status === "stopping"
	);
	if (input.isPending || (!hasStoppableTarget && hasStoppingTarget)) {
		return "Stopping...";
	}
	if (input.targets.some((target) => target.status === "retry_later")) {
		return "Retry Stop";
	}
	if (input.targets.length === 1 && input.targets[0]?.isWaitingForDevice) {
		return "Cancel waiting";
	}
	return "Stop";
}

function resolveWakeStopStatusCopy(
	status: SpaceWakeStopTargetResolution["status"]
): string | null {
	switch (status) {
		case "stopping":
			return "Stop requested. Waiting for OpenMeld to confirm this Wake was stopped.";
		case "unsupported":
			return "Stop is not supported for this local agent.";
		case "unavailable":
			return null;
		case "retry_later":
			return "OpenMeld could not reach the local service. Try again in a moment.";
		default:
			return null;
	}
}

function resolveWakeStopResponseMessage(
	response: PostSpaceWakeStopResponse
): string {
	switch (response.status) {
		case "cancellation_requested":
			return "Stop requested. Waiting for OpenMeld to confirm this Wake was stopped.";
		case "cancelled":
		case "already_cancelled":
			return "Stop confirmed. Refreshing Wake status.";
		case "unsupported":
			return "Stop is not supported for this local agent.";
		case "retry_later":
			return "OpenMeld could not reach the local service. Try again in a moment.";
		case "not_found":
		case "not_stoppable":
			return "This Wake is no longer stoppable.";
		default:
			return "OpenMeld received the Stop response. Refreshing Wake status.";
	}
}

function normalizeWakeStopTargets(
	target:
		| SpaceWakeStopTargetResolution
		| readonly SpaceWakeStopTargetResolution[]
		| null
		| undefined
): readonly SpaceWakeStopTargetResolution[] {
	if (!target) {
		return [];
	}
	if (Array.isArray(target)) {
		return target;
	}
	return [target as SpaceWakeStopTargetResolution];
}

function resolveWakeStopTargetLabel(
	target: SpaceWakeStopTargetResolution,
	input: { fallback: string; includeProfileIdFallback?: boolean }
): string {
	const label = target.targetLabel?.trim();
	if (label) {
		return label;
	}
	const profileId = target.targetProfileId?.trim();
	if (profileId && input.includeProfileIdFallback) {
		return profileId;
	}
	return input.fallback;
}

function isWakeStopTargetPending(input: {
	pendingSelectorKeys: ReadonlySet<string>;
	target: SpaceWakeStopTargetResolution;
}): boolean {
	return Boolean(
		input.target.selectorKey &&
			input.pendingSelectorKeys.has(input.target.selectorKey)
	);
}

function setWakeStopTargetPending(input: {
	pending: boolean;
	setPendingSelectorKeys: (
		updater: (current: ReadonlySet<string>) => ReadonlySet<string>
	) => void;
	target: SpaceWakeStopTargetResolution;
}): void {
	const selectorKey = input.target.selectorKey;
	if (!selectorKey) {
		return;
	}
	input.setPendingSelectorKeys((current) => {
		const next = new Set(current);
		if (input.pending) {
			next.add(selectorKey);
		} else {
			next.delete(selectorKey);
		}
		return next;
	});
}

function resolveWakeStopTargetRowStatus(input: {
	isPending: boolean;
	target: SpaceWakeStopTargetResolution;
}): string {
	if (input.isPending || input.target.status === "stopping") {
		return "Stopping...";
	}
	switch (input.target.status) {
		case "retry_later":
			return "Ready to retry.";
		case "unsupported":
			return "Stop is not supported for this local agent.";
		case "stopped":
			return "Stopped.";
		default:
			return input.target.canStop ? "Ready to stop." : "Not stoppable.";
	}
}

function resolveWakeStopTargetActionText(input: {
	isPending: boolean;
	target: SpaceWakeStopTargetResolution;
}): string {
	if (input.isPending || input.target.status === "stopping") {
		return "Stopping...";
	}
	if (input.target.status === "stopped") {
		return "Stopped";
	}
	if (input.target.status === "retry_later") {
		return "Retry";
	}
	if (!input.target.canStop) {
		return "Unavailable";
	}
	return "Stop";
}

function resolveWakeStopTargetActionLabel(input: {
	target: SpaceWakeStopTargetResolution;
	targetLabel: string;
}): string {
	switch (input.target.status) {
		case "stopped":
			return `${input.targetLabel} stopped`;
		case "retry_later":
			return `Retry Stop for ${input.targetLabel}`;
		case "unsupported":
		case "unavailable":
		case "not_stoppable":
			return `Wake Stop unavailable for ${input.targetLabel}`;
		default:
			return `Stop ${input.targetLabel}`;
	}
}
