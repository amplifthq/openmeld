import type { ExecutionRecoveryAction } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import {
	type ReactNode,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
	useState,
} from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export type SpaceExecutionRecoveryRequest = {
	dispatchId: string;
	resultRef: string | null;
	targetProfileId: string;
};

export type AnchoredSpaceExecutionRecoveryState =
	| { request: SpaceExecutionRecoveryRequest; status: "inspect" }
	| { request: null; status: "closed" | "invalid" | "legacy" };

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
		| "Start a new Wake"
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

export function resolveAnchoredSpaceExecutionRecoveryRequest(input: {
	notices: readonly SpaceTimelineItem[];
	outcomeNotice: SpaceTimelineItem;
}): SpaceExecutionRecoveryRequest | null {
	const state = resolveAnchoredSpaceExecutionRecoveryState(input);
	return state.status === "inspect" ? state.request : null;
}

export function resolveAnchoredSpaceExecutionRecoveryState(input: {
	notices: readonly SpaceTimelineItem[];
	outcomeNotice: SpaceTimelineItem;
}): AnchoredSpaceExecutionRecoveryState {
	const terminalFailure = input.outcomeNotice;
	if (terminalFailure.systemNoticeType !== "terminal_failure") {
		return { request: null, status: "legacy" };
	}
	const dispatchId = terminalFailure?.systemNoticeDispatchId?.trim() ?? "";
	const targetProfileId =
		terminalFailure?.systemNoticeTargetProfileId?.trim() ?? "";
	if (!(dispatchId && targetProfileId)) {
		return { request: null, status: "legacy" };
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
		return { request: null, status: "invalid" };
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
		return { request: null, status: "closed" };
	}
	return {
		request: {
			dispatchId,
			resultRef,
			targetProfileId,
		},
		status: "inspect",
	};
}

export function SpaceExecutionRecoveryButton(input: {
	className?: string;
	onRecoverExecution: SpaceExecutionRecoveryHandler;
	presentation?: "compact" | "detailed";
	request: SpaceExecutionRecoveryRequest;
	unavailableFallback?: ReactNode;
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
	useEffect(() => {
		if (resolution?.status !== "in_progress") {
			return;
		}
		let cancelled = false;
		const timer = setTimeout(() => {
			inspectRecovery({
				dispatchId: recoveryDispatchId,
				resultRef: recoveryResultRef,
				targetProfileId: recoveryTargetProfileId,
			})
				.then((next) => {
					if (!cancelled) {
						setResolution(next);
					}
				})
				.catch(() => {
					if (!cancelled) {
						setInspectionFailed(true);
					}
				});
		}, 2000);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [
		resolution,
		recoveryDispatchId,
		recoveryResultRef,
		recoveryTargetProfileId,
	]);
	if (resolution === null) {
		return null;
	}
	if (inspectionFailed || resolution.status === "outcome_unknown") {
		return (
			<div className="flex flex-col items-start gap-1.5 text-xs">
				<p className="text-muted-foreground">
					Couldn't confirm whether your reply is ready. Your message is saved.
				</p>
				<Button
					disabled={isPending}
					onClick={async () => {
						if (pendingRef.current) {
							return;
						}
						pendingRef.current = true;
						setIsPending(true);
						try {
							const next = await input.onRecoverExecution({
								...input.request,
								action: null,
								operationId: null,
							});
							setResolution(next);
							setInspectionFailed(false);
						} catch {
							setInspectionFailed(true);
						} finally {
							pendingRef.current = false;
							setIsPending(false);
						}
					}}
					size="sm"
					variant="outline"
				>
					{isPending ? "Checking…" : "Check status"}
				</Button>
			</div>
		);
	}
	if (resolution.status !== "available") {
		if (resolution.status === "in_progress") {
			return (
				<output className="text-muted-foreground text-xs">
					Preparing your reply…
				</output>
			);
		}
		return resolution.status === "unavailable" ? (
			<>
				{resolution.warning ? (
					<p className="text-muted-foreground text-xs">{resolution.warning}</p>
				) : null}
				{input.unavailableFallback ?? null}
			</>
		) : null;
	}
	if (resolution.action === "retry_as_new_execution") {
		return null;
	}
	const recover = async () => {
		if (
			pendingRef.current ||
			resolution?.status !== "available" ||
			!resolution.action
		) {
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
		isPending,
		resolution,
	});
	if (recoveryLabel === null) {
		return null;
	}
	const recoveryWarning = resolution.warning;
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
				disabled={isPending}
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
	isPending: boolean;
	resolution: SpaceExecutionRecoveryResolution | null;
}): string | null {
	if (input.isPending) {
		if (input.resolution?.action === "resume_controller_conversation") {
			return "Recovering reply...";
		}
		return "Recovering result...";
	}
	if (input.didFail) {
		return "Recovery failed. Try again";
	}
	return input.resolution?.label ?? null;
}
