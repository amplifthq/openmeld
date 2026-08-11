import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type { ExecutionRecoveryAction } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { isSpaceComposerSendOutcomeUnknown } from "#/lib/spaces/errors";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { createClientMessageId } from "./use-space-landing-controller-helpers";

export type SpaceWakeRetryRequest = {
	sourceText: string;
	targetProfileId: string;
	threadContext?: SpaceWakeRetryThreadContext;
};

export type SpaceWakeRetryThreadContext = {
	rootSignalId: string;
	threadId: string;
};

export type SpaceWakeRetryAttempt = SpaceWakeRetryRequest & {
	clientMessageId: string;
};

export type SpaceExecutionRecoveryRequest = {
	dispatchId: string;
	resultRef: string | null;
	targetProfileId: string;
};

export type SpaceExecutionRecoveryAttempt = SpaceExecutionRecoveryRequest & {
	action: ExecutionRecoveryAction | null;
	operationId: string | null;
};

export type SpaceExecutionRecoveryResolution = {
	action: ExecutionRecoveryAction | null;
	label:
		| "Continue conversation"
		| "Recover reply"
		| "Recover result"
		| "Retry as new execution"
		| null;
	status:
		| "available"
		| "in_progress"
		| "outcome_unknown"
		| "recovered"
		| "unavailable";
	warning: string | null;
};

export type SpaceExecutionRecoveryHandler = (
	input: SpaceExecutionRecoveryAttempt
) => Promise<SpaceExecutionRecoveryResolution>;

export type SpaceWakeRetryHandler = (
	input: SpaceWakeRetryAttempt
) => Promise<void>;

export function resolveSpaceWakeRetryRequest(input: {
	notice?: SpaceTimelineItem;
	retrySourceText: string | null;
}): SpaceWakeRetryRequest | null {
	if (
		!input.retrySourceText ||
		input.notice?.systemNoticeType !== "terminal_failure" ||
		input.notice.systemNoticeReasonCode ===
			"runtime_coordinator.late_result_available" ||
		input.notice.systemNoticeFailureStage === "publication"
	) {
		return null;
	}
	const targetProfileId =
		input.notice.systemNoticeTargetProfileId?.trim() ?? "";
	if (!targetProfileId) {
		return null;
	}
	return {
		sourceText: input.retrySourceText,
		targetProfileId,
	};
}

function resolveSpaceWakeRetrySourceText(
	item: SpaceTimelineItem
): string | null {
	if (item.signalType !== "signal.text") {
		return null;
	}
	const sourceText = item.text.trim();
	return sourceText.length > 0 ? sourceText : null;
}

export function resolveAnchoredSpaceWakeRetryRequest(input: {
	notices: readonly SpaceTimelineItem[];
	outcomeNotice: SpaceTimelineItem;
	sourceItem: SpaceTimelineItem;
}): SpaceWakeRetryRequest | null {
	if (input.sourceItem.attachments.length > 0) {
		return null;
	}
	const notice = input.outcomeNotice;
	const sourceTargetProfileId =
		notice.systemNoticeTargetProfileId?.trim() ?? "";
	if (
		notice.systemNoticeType !== "terminal_failure" ||
		!sourceTargetProfileId ||
		!input.sourceItem.wakeTargetProfileIds.includes(sourceTargetProfileId)
	) {
		return null;
	}
	// Modern terminal failures always re-enter through the Core-owned recovery
	// control plane. This legacy direct Wake fallback is reserved for historical
	// notices that predate durable dispatch identity.
	if (notice.systemNoticeDispatchId?.trim()) {
		return null;
	}
	if (input.sourceItem.wakeTargetProfileIds.length !== 1) {
		return null;
	}
	if (
		resolveAnchoredExecutionRecoveryEvidence({
			notices: input.notices,
			outcomeNotice: notice,
		})
	) {
		return null;
	}
	return resolveSpaceWakeRetryRequest({
		notice,
		retrySourceText: resolveSpaceWakeRetrySourceText(input.sourceItem),
	});
}

export function resolveAnchoredSpaceExecutionRecoveryRequest(input: {
	notices: readonly SpaceTimelineItem[];
	outcomeNotice: SpaceTimelineItem;
}): SpaceExecutionRecoveryRequest | null {
	const terminalFailure = input.outcomeNotice;
	if (terminalFailure.systemNoticeType !== "terminal_failure") {
		return null;
	}
	const dispatchId = terminalFailure?.systemNoticeDispatchId?.trim() ?? "";
	const targetProfileId =
		terminalFailure?.systemNoticeTargetProfileId?.trim() ?? "";
	if (!(dispatchId && targetProfileId)) {
		return null;
	}
	const exactAvailableNotices = input.notices.filter(
		(notice) =>
			notice.systemNoticeType === "execution_recovery_available" &&
			notice.systemNoticeDispatchId?.trim() === dispatchId &&
			notice.systemNoticeTargetProfileId?.trim() === targetProfileId &&
			Boolean(notice.systemNoticeResultRef?.trim())
	);
	const availableResultRefs = [
		...new Set(
			exactAvailableNotices.flatMap((notice) => {
				const resultRef = notice.systemNoticeResultRef?.trim();
				return resultRef ? [resultRef] : [];
			})
		),
	];
	if (availableResultRefs.length > 1) {
		return null;
	}
	const resultRef = availableResultRefs[0] ?? null;
	const completed = input.notices.some(
		(notice) =>
			notice.systemNoticeType === "execution_recovery_completed" &&
			notice.systemNoticeDispatchId?.trim() === dispatchId &&
			notice.systemNoticeTargetProfileId?.trim() === targetProfileId &&
			(resultRef === null || notice.systemNoticeResultRef?.trim() === resultRef)
	);
	if (completed) {
		return null;
	}
	return {
		dispatchId,
		resultRef,
		targetProfileId,
	};
}

function resolveAnchoredExecutionRecoveryEvidence(input: {
	notices: readonly SpaceTimelineItem[];
	outcomeNotice: SpaceTimelineItem;
}): {
	completed: boolean;
	request: SpaceExecutionRecoveryRequest;
} | null {
	const terminalFailure = input.outcomeNotice;
	if (terminalFailure.systemNoticeType !== "terminal_failure") {
		return null;
	}
	const dispatchId = terminalFailure?.systemNoticeDispatchId?.trim() ?? "";
	const targetProfileId =
		terminalFailure?.systemNoticeTargetProfileId?.trim() ?? "";
	if (!(dispatchId && targetProfileId)) {
		return null;
	}
	const exactRecoveryNotices = input.notices.filter(
		(notice) =>
			notice.systemNoticeType === "execution_recovery_available" &&
			notice.systemNoticeDispatchId?.trim() === dispatchId &&
			notice.systemNoticeTargetProfileId?.trim() === targetProfileId &&
			Boolean(notice.systemNoticeResultRef?.trim())
	);
	if (exactRecoveryNotices.length !== 1) {
		return null;
	}
	const resultRef = exactRecoveryNotices[0]?.systemNoticeResultRef?.trim();
	if (!resultRef) {
		return null;
	}
	const completed = input.notices.some(
		(notice) =>
			notice.systemNoticeType === "execution_recovery_completed" &&
			notice.systemNoticeDispatchId?.trim() === dispatchId &&
			notice.systemNoticeTargetProfileId?.trim() === targetProfileId &&
			notice.systemNoticeResultRef?.trim() === resultRef
	);
	return {
		completed,
		request: { dispatchId, resultRef, targetProfileId },
	};
}

export function SpaceWakeRetryButton(input: {
	className?: string;
	onRetryWakeTarget: SpaceWakeRetryHandler;
	request: SpaceWakeRetryRequest;
	warning?: string | null;
}) {
	const warningId = useId();
	const warning =
		input.warning ??
		"This starts a new execution and may run the task and its side effects again.";
	const clientMessageIdRef = useRef<string | null>(null);
	const pendingRef = useRef(false);
	const [didFail, setDidFail] = useState(false);
	const [isPending, setIsPending] = useState(false);
	const [wasOutcomeUnknown, setWasOutcomeUnknown] = useState(false);
	const retryWake = async () => {
		if (pendingRef.current) {
			return;
		}
		const clientMessageId =
			clientMessageIdRef.current ?? createClientMessageId();
		clientMessageIdRef.current = clientMessageId;
		pendingRef.current = true;
		setDidFail(false);
		setIsPending(true);
		setWasOutcomeUnknown(false);
		try {
			await input.onRetryWakeTarget({
				...input.request,
				clientMessageId,
			});
			clientMessageIdRef.current = null;
		} catch (error) {
			const failure = toStructuredApiClientFailure(error);
			if (isSpaceComposerSendOutcomeUnknown(failure)) {
				setWasOutcomeUnknown(true);
			} else {
				clientMessageIdRef.current = null;
				setDidFail(true);
				console.error("Failed to retry the Wake.", error);
			}
		} finally {
			pendingRef.current = false;
			setIsPending(false);
		}
	};
	let retryLabel = "Retry as new execution";
	if (isPending) {
		retryLabel = "Starting new execution...";
	} else if (wasOutcomeUnknown) {
		retryLabel = "New execution not confirmed. Try again";
	} else if (didFail) {
		retryLabel = "New execution failed. Try again";
	}

	return (
		<div className="flex max-w-sm flex-col items-start gap-1.5">
			<p className="text-muted-foreground text-xs leading-5" id={warningId}>
				{warning}
			</p>
			<Button
				aria-describedby={warningId}
				aria-live="polite"
				className={input.className}
				disabled={isPending}
				onClick={() => {
					retryWake().catch((error) => {
						console.error("Unexpected Wake retry failure.", error);
					});
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				{retryLabel}
			</Button>
		</div>
	);
}

export function SpaceExecutionRecoveryButton(input: {
	className?: string;
	onRecoverExecution: SpaceExecutionRecoveryHandler;
	presentation?: "compact" | "detailed";
	request: SpaceExecutionRecoveryRequest;
}) {
	const isCompact = input.presentation === "compact";
	const warningId = useId();
	const pendingRef = useRef(false);
	const [resolution, setResolution] =
		useState<SpaceExecutionRecoveryResolution | null>(null);
	const [inspectionFailed, setInspectionFailed] = useState(false);
	const [isPending, setIsPending] = useState(false);
	const [didFail, setDidFail] = useState(false);
	const inspectRecovery = useEffectEvent(
		async (request: SpaceExecutionRecoveryRequest) =>
			input.onRecoverExecution({
				...request,
				action: null,
				operationId: null,
			})
	);
	const {
		dispatchId: recoveryDispatchId,
		resultRef: recoveryResultRef,
		targetProfileId: recoveryTargetProfileId,
	} = input.request;
	useEffect(() => {
		let cancelled = false;
		setResolution(null);
		setInspectionFailed(false);
		inspectRecovery({
			dispatchId: recoveryDispatchId,
			resultRef: recoveryResultRef,
			targetProfileId: recoveryTargetProfileId,
		})
			.then((nextResolution) => {
				if (!cancelled) {
					setResolution(nextResolution);
				}
			})
			.catch((error) => {
				if (!cancelled) {
					setInspectionFailed(true);
				}
				console.error("Failed to inspect execution recovery.", error);
			});
		return () => {
			cancelled = true;
		};
	}, [recoveryDispatchId, recoveryResultRef, recoveryTargetProfileId]);
	if (resolution && resolution.action === null) {
		return null;
	}
	const recover = async () => {
		if (pendingRef.current || !resolution?.action) {
			return;
		}
		const operationId = buildSpaceExecutionRecoveryOperationId({
			action: resolution.action,
			request: input.request,
		});
		pendingRef.current = true;
		setDidFail(false);
		setIsPending(true);
		try {
			const nextResolution = await input.onRecoverExecution({
				...input.request,
				action: resolution.action,
				operationId,
			});
			setResolution(nextResolution);
		} catch (error) {
			setDidFail(true);
			console.error("Failed to recover the retained result.", error);
		} finally {
			pendingRef.current = false;
			setIsPending(false);
		}
	};
	const recoveryLabel = resolveSpaceExecutionRecoveryButtonLabel({
		didFail,
		inspectionFailed,
		isPending,
		resolution,
	});
	const recoveryWarning =
		resolution?.action === "retry_as_new_execution"
			? (resolution.warning ??
				"This starts a new execution and may run the task and its side effects again.")
			: (resolution?.warning ?? null);
	return (
		<div
			className={cn(
				isCompact
					? "inline-flex shrink-0 items-center"
					: "flex max-w-sm flex-col items-start gap-1.5"
			)}
		>
			{recoveryWarning ? (
				<p
					className={cn(
						"text-muted-foreground text-xs leading-5",
						isCompact && "sr-only"
					)}
					id={warningId}
				>
					{recoveryWarning}
				</p>
			) : null}
			<Button
				aria-describedby={recoveryWarning ? warningId : undefined}
				aria-live="polite"
				className={input.className}
				disabled={isPending || resolution === null}
				onClick={() => {
					recover().catch((error) => {
						console.error("Unexpected result recovery failure.", error);
					});
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				{recoveryLabel}
			</Button>
		</div>
	);
}

export function buildSpaceExecutionRecoveryOperationId(input: {
	action: ExecutionRecoveryAction;
	request: SpaceExecutionRecoveryRequest;
}): string {
	return [
		"space-execution-recovery",
		input.request.dispatchId,
		input.request.targetProfileId,
		input.action,
	].join(":");
}

function resolveSpaceExecutionRecoveryButtonLabel(input: {
	didFail: boolean;
	inspectionFailed: boolean;
	isPending: boolean;
	resolution: SpaceExecutionRecoveryResolution | null;
}): string {
	if (input.isPending) {
		if (input.resolution?.action === "resume_controller_conversation") {
			return "Recovering reply...";
		}
		return input.resolution?.action === "retry_as_new_execution"
			? "Starting new execution..."
			: "Recovering result...";
	}
	if (input.didFail) {
		return "Recovery failed. Try again";
	}
	if (input.inspectionFailed) {
		return "Recovery unavailable";
	}
	if (input.resolution?.action === "resume_controller_conversation") {
		return "Recover reply";
	}
	return input.resolution?.label ?? "Checking recovery...";
}
