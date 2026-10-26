import {
	type DesktopComputerConnectionOperation,
	type DesktopComputerConnectionProgress,
	type DesktopComputerConnectionRequest,
	type DesktopComputerConnectionResult,
	type DesktopComputerDisconnectOperation,
	type DesktopComputerDisconnectPhase,
	type DesktopComputerDisconnectResult,
	type DesktopComputerOperation,
	desktopComputerConnectionResultSchema,
	desktopComputerDisconnectResultSchema,
} from "@openmeld/schemas";
import type {
	CreatePrepareSessionRequest,
	PrepareSessionSnapshot,
} from "@openmeld/schemas/types";
import {
	formatComputerConnectionElapsed,
	isNewerComputerConnectionProgress,
	presentComputerConnectionProgress,
} from "@openmeld/start";
import { Button } from "@openmeld/ui/components/button";
import { SettingsAddComputerCardContent } from "@openmeld/ui/components/settings-computers";
import { CheckIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBringAgentsSetupContext } from "#/components/connect/bring-agents-setup-context";
import { useAuthSession } from "#/hooks/auth.hooks";
import {
	buildConnectComputerPath,
	buildConnectRouteSearch,
	type ConnectRouteIntent,
	resolveConnectCompletionTarget,
} from "#/lib/connect/connect-route";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationConnectPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import { formatDesktopError } from "./desktop-error";
import { getDesktopPlatform, openDesktopWeb } from "./platform";
import { useDesktopComputerConnection } from "./use-computer-connection";

type ComputerConnectionProps = {
	allowDisconnect?: boolean;
	orgSlug?: string;
	sourceNavigationAction?: CreatePrepareSessionRequest["sourceNavigationAction"];
	onCompleted?: (
		connection: Pick<PrepareSessionSnapshot, "deviceId" | "runtimeLane">
	) => void;
	onContinue?: () => void | Promise<void>;
};

function buildConnectionRequestKey(
	request: DesktopComputerConnectionRequest
): string {
	return JSON.stringify([
		request.expectedAccount,
		request.humanProfileId ?? null,
		request.targetSpaceId ?? null,
		request.connectedComputerId ?? null,
		request.resetThisComputer === true,
		request.sourceNavigationAction?.spaceId ?? null,
		request.sourceNavigationAction?.signalId ?? null,
		request.serviceAction ?? null,
	]);
}

function canAdoptConnectionOperation(input: {
	adoptedOperationId: string | null;
	handledSettlementIds: ReadonlySet<string>;
	operationId: string;
}): boolean {
	return (
		!input.handledSettlementIds.has(input.operationId) &&
		(input.adoptedOperationId === null ||
			input.adoptedOperationId === input.operationId)
	);
}

async function applyAdoptedConnectionSettlement(input: {
	connectionRefetch(): Promise<unknown>;
	isActive(): boolean;
	localRuntimesRefetch(): Promise<unknown>;
	onCompleted?: ComputerConnectionProps["onCompleted"];
	onContinue?: ComputerConnectionProps["onContinue"];
	operationState: Pick<
		DesktopComputerConnectionOperation,
		"result" | "errorMessage"
	>;
	setDiagnosticId(value: string | null): void;
	setDiagnosticsPath(value: string | null): void;
	setFailed(value: boolean): void;
	setMessage(value: string | null): void;
	setRefreshWarning(value: string | null): void;
	requireUpdate?: boolean;
}) {
	if (input.operationState.errorMessage) {
		input.setFailed(true);
		input.setMessage(
			formatDesktopError(
				new Error(input.operationState.errorMessage),
				"This computer could not connect. Try again."
			)
		);
		return;
	}
	const result = input.operationState.result;
	if (!result) {
		return;
	}
	if (result.status === "cancelled") {
		input.setMessage("Connection unchanged.");
		return;
	}
	if (result.status === "failed") {
		input.setFailed(true);
		input.setMessage(result.message);
		input.setDiagnosticId(result.diagnosticId);
		input.setDiagnosticsPath(result.diagnosticsPath ?? null);
		return;
	}
	if (input.requireUpdate && result.status === "reused") {
		input.setFailed(true);
		input.setMessage("The update was not confirmed. Try again.");
		return;
	}
	if (input.requireUpdate) {
		input.setMessage("OpenMeld Tools updated.");
	} else {
		input.setMessage(
			result.status === "completed"
				? "Computer connected."
				: "Using the existing connection."
		);
	}
	await refreshConnectionDisplay(input);
	if (!input.isActive()) {
		return;
	}
	input.onCompleted?.(
		result.status === "completed" ? result.snapshot : result.connection
	);
	await input.onContinue?.();
}

async function refreshConnectionDisplay(input: {
	connectionRefetch(): Promise<unknown>;
	localRuntimesRefetch(): Promise<unknown>;
	isActive(): boolean;
	setRefreshWarning(value: string | null): void;
}) {
	const refresh = async (read: () => Promise<unknown>) => {
		try {
			const result = await read();
			if (
				result &&
				typeof result === "object" &&
				"isError" in result &&
				result.isError
			) {
				throw new Error("Connection display refresh failed");
			}
		} catch {
			if (input.isActive()) {
				input.setRefreshWarning(
					"The operation completed, but the connection display could not refresh. Check the connection again."
				);
			}
		}
	};
	// The native result already confirms the operation. The cloud directory is
	// independent and must not hold its completion callback or misreport failure.
	refresh(input.localRuntimesRefetch);
	await refresh(input.connectionRefetch);
}

export function DesktopComputerConnection(input: ComputerConnectionProps) {
	const { routeIntent, selectedHumanProfileId, targetSpaceId } =
		useBringAgentsSetupContext();
	const account = useAuthSession().data?.user.id;
	const navigate = useNavigate();
	const continueToCompletionTarget = useCallback(
		() =>
			navigate({
				to: resolveConnectCompletionTarget(routeIntent, input.orgSlug),
			}),
		[navigate, routeIntent, input.orgSlug]
	);
	if (
		routeIntent.serviceAction === "update_service" &&
		!getDesktopPlatform()?.updateComputer
	) {
		return <DesktopWebConnection {...input} intent={routeIntent} />;
	}
	// Each mounted observer belongs to one account AND request. An old async
	// completion cannot mutate a new request, including A → B → A navigation.
	const requestKey = JSON.stringify([
		account,
		selectedHumanProfileId,
		targetSpaceId,
		routeIntent.resetThisComputer,
		routeIntent.connectedComputerId,
		routeIntent.serviceAction,
		input.sourceNavigationAction?.spaceId,
		input.sourceNavigationAction?.signalId,
		input.allowDisconnect,
	]);
	return (
		<NativeComputerConnection
			{...input}
			key={requestKey}
			onContinue={
				input.onContinue ??
				(routeIntent.kind === "space_recovery" ||
				routeIntent.serviceAction === "update_service"
					? continueToCompletionTarget
					: undefined)
			}
		/>
	);
}

function useComputerConnection(input: ComputerConnectionProps) {
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const setup = useBringAgentsSetupContext();
	const session = useAuthSession();
	const connection = useDesktopComputerConnection();
	const [operation, setOperation] = useState<"connect" | "disconnect" | null>(
		null
	);
	const pending = operation !== null;
	const [message, setMessage] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const [diagnosticId, setDiagnosticId] = useState<string | null>(null);
	const [diagnosticsPath, setDiagnosticsPath] = useState<string | null>(null);
	const [progress, setProgress] =
		useState<DesktopComputerConnectionProgress | null>(null);
	const progressRef = useRef<DesktopComputerConnectionProgress | null>(null);
	const ownedOperationRef = useRef<"connect" | "disconnect" | null>(null);
	const operationRef = useRef<"connect" | "disconnect" | null>(null);
	const actionRevisionRef = useRef(0);
	const [disconnectPhase, setDisconnectPhase] =
		useState<DesktopComputerDisconnectPhase>("checking");
	const disconnectPhaseRef = useRef<DesktopComputerDisconnectPhase>("checking");
	const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
	const [needsCheck, setNeedsCheck] = useState(false);
	const [diagnosticCode, setDiagnosticCode] = useState<string | null>(null);
	const adoptedOperationIdRef = useRef<string | null>(null);
	const adoptedRequestKeyRef = useRef<string | null>(null);
	const handledSettlementIdsRef = useRef(new Set<string>());
	const settledProgressIdsRef = useRef(new Set<string>());
	const expectedAccount = session.data?.user.id;
	const intent = setup.routeIntent;
	const updateService = intent.serviceAction === "update_service";
	const refetchConnectionContext =
		intent.kind === "space_recovery" || updateService
			? setup.refreshAll
			: setup.localRuntimesQuery.refetch;
	const requiresConnection = Boolean(
		intent.resetThisComputer ||
			updateService ||
			setup.targetSpaceId ||
			input.sourceNavigationAction ||
			intent.connectedComputerId
	);
	const connectionRequest: DesktopComputerConnectionRequest | null =
		expectedAccount === undefined
			? null
			: {
					expectedAccount,
					humanProfileId: setup.selectedHumanProfileId,
					targetSpaceId: setup.targetSpaceId,
					resetThisComputer: intent.resetThisComputer,
					sourceNavigationAction: input.sourceNavigationAction,
					connectedComputerId: intent.connectedComputerId,
					...(updateService
						? { serviceAction: "update_service" as const }
						: {}),
				};
	const connectionRequestKey = connectionRequest
		? buildConnectionRequestKey(connectionRequest)
		: null;
	const canDisconnect = Boolean(input.allowDisconnect && !requiresConnection);
	const trustedDisplay = Boolean(
		connection.data &&
			(connection.data.status === "unavailable" ||
				connection.data.accountId === expectedAccount)
	);
	const connected =
		connection.data?.status === "available" &&
		connection.data.accountId === expectedAccount &&
		setup.localRuntimesQuery.data?.peopleComputers.computers.some(
			(computer) =>
				computer.connection.status === "connected" &&
				computer.connection.sessions.some(
					(target) =>
						connection.data?.status === "available" &&
						target.deviceId === connection.data.target.deviceId &&
						target.runtimeLane === connection.data.target.runtimeLane
				)
		) === true;
	const isCurrentAction = useCallback(
		(revision: number) =>
			active.current && actionRevisionRef.current === revision,
		[]
	);
	const refreshDisplay = useCallback(
		(revision: number) =>
			refreshConnectionDisplay({
				connectionRefetch: connection.refetch,
				localRuntimesRefetch: refetchConnectionContext,
				isActive: () => isCurrentAction(revision),
				setRefreshWarning,
			}),
		[connection.refetch, refetchConnectionContext, isCurrentAction]
	);
	const applyDisconnectResult = useCallback(
		async (result: DesktopComputerDisconnectResult, revision: number) => {
			if (!isCurrentAction(revision)) {
				return;
			}
			if (result.status === "cancelled") {
				setMessage("Disconnect cancelled. The connection was not changed.");
				return;
			}
			if (result.status === "disconnected") {
				setMessage(
					"Disconnected. This Mac remains in your Computers list. Desktop stays signed in."
				);
				await refreshDisplay(revision);
				return;
			}
			setFailed(true);
			setNeedsCheck(true);
			setMessage(result.message);
			setDiagnosticCode(result.code);
			setDiagnosticId(result.diagnosticId ?? null);
			setDiagnosticsPath(result.diagnosticsPath ?? null);
		},
		[isCurrentAction, refreshDisplay]
	);
	useEffect(() => {
		if (adoptedRequestKeyRef.current !== connectionRequestKey) {
			adoptedRequestKeyRef.current = connectionRequestKey;
			adoptedOperationIdRef.current = null;
			handledSettlementIdsRef.current.clear();
			settledProgressIdsRef.current.clear();
			progressRef.current = null;
			setProgress(null);
			setOperation(null);
		}
		const desktop = getDesktopPlatform();
		if (!desktop) {
			return;
		}
		let observing = true;
		let receivedEvent = false;
		const readRevision = actionRevisionRef.current;
		const accept = (event: DesktopComputerConnectionProgress): boolean => {
			if (
				!(observing && active.current) ||
				operationRef.current === "disconnect" ||
				event.expectedAccount !== expectedAccount ||
				settledProgressIdsRef.current.has(event.operationId) ||
				!isNewerComputerConnectionProgress(progressRef.current, event)
			) {
				return false;
			}
			progressRef.current = event;
			setProgress(event);
			return true;
		};
		const settleAdoptedOperation = async (
			operationState: DesktopComputerConnectionOperation
		) => {
			if (
				connectionRequestKey === null ||
				buildConnectionRequestKey(operationState.request) !==
					connectionRequestKey ||
				operationState.status !== "settled" ||
				!active.current ||
				!canAdoptConnectionOperation({
					adoptedOperationId: adoptedOperationIdRef.current,
					handledSettlementIds: handledSettlementIdsRef.current,
					operationId: operationState.operationId,
				})
			) {
				return;
			}
			adoptedOperationIdRef.current = operationState.operationId;
			handledSettlementIdsRef.current.add(operationState.operationId);
			if (operationState.progress) {
				settledProgressIdsRef.current.add(operationState.progress.operationId);
			}
			if (operationState.progress) {
				const finalProgress =
					operationState.progress.state === "active"
						? null
						: operationState.progress;
				progressRef.current = finalProgress;
				setProgress(finalProgress);
			}
			if (ownedOperationRef.current) {
				return;
			}
			const revision = actionRevisionRef.current;
			operationRef.current = "connect";
			setOperation("connect");
			await applyAdoptedConnectionSettlement({
				connectionRefetch: connection.refetch,
				isActive: () => isCurrentAction(revision),
				localRuntimesRefetch: refetchConnectionContext,
				onCompleted: input.onCompleted,
				onContinue: input.onContinue,
				operationState,
				requireUpdate: updateService,
				setDiagnosticId,
				setDiagnosticsPath,
				setFailed,
				setMessage,
				setRefreshWarning,
			});
			if (isCurrentAction(revision)) {
				operationRef.current = null;
				setOperation(null);
			}
		};
		const acceptDisconnectOperation = (
			operationState: DesktopComputerDisconnectOperation
		) => {
			if (
				!canDisconnect ||
				operationState.request.expectedAccount !== expectedAccount ||
				ownedOperationRef.current === "connect" ||
				!canAdoptConnectionOperation({
					adoptedOperationId: adoptedOperationIdRef.current,
					handledSettlementIds: handledSettlementIdsRef.current,
					operationId: operationState.operationId,
				})
			) {
				return;
			}
			adoptedOperationIdRef.current = operationState.operationId;
			progressRef.current = null;
			setProgress(null);
			if (operationState.status === "pending") {
				const phases: DesktopComputerDisconnectPhase[] = [
					"checking",
					"waiting_for_confirmation",
					"disconnecting",
				];
				if (
					phases.indexOf(operationState.phase) >=
					phases.indexOf(disconnectPhaseRef.current)
				) {
					disconnectPhaseRef.current = operationState.phase;
					setDisconnectPhase(operationState.phase);
				}
				operationRef.current = "disconnect";
				setOperation("disconnect");
				return;
			}
			handledSettlementIdsRef.current.add(operationState.operationId);
			if (ownedOperationRef.current) {
				return;
			}
			const revision = actionRevisionRef.current;
			operationRef.current = "disconnect";
			setOperation("disconnect");
			applyDisconnectResult(
				operationState.result ?? {
					status: "unconfirmed",
					code: "desktop.disconnect.unconfirmed",
					message:
						"The Disconnect result could not be confirmed. Check the connection before trying again.",
				},
				revision
			).finally(() => {
				if (isCurrentAction(revision)) {
					operationRef.current = null;
					setOperation(null);
				}
			});
		};
		const acceptConnectOperation = (
			operationState: DesktopComputerConnectionOperation
		) => {
			if (
				ownedOperationRef.current === "disconnect" ||
				operationRef.current === "disconnect" ||
				connectionRequestKey === null ||
				buildConnectionRequestKey(operationState.request) !==
					connectionRequestKey
			) {
				return;
			}
			if (operationState.status === "pending") {
				if (
					!canAdoptConnectionOperation({
						adoptedOperationId: adoptedOperationIdRef.current,
						handledSettlementIds: handledSettlementIdsRef.current,
						operationId: operationState.operationId,
					})
				) {
					return;
				}
				adoptedOperationIdRef.current = operationState.operationId;
				if (operationState.progress) {
					accept(operationState.progress);
				}
				if (!ownedOperationRef.current) {
					operationRef.current = "connect";
					setOperation("connect");
				}
				return;
			}
			const revision = actionRevisionRef.current;
			settleAdoptedOperation(operationState).catch(() => {
				if (!isCurrentAction(revision)) {
					return;
				}
				setRefreshWarning(
					"The connection result was received, but the page could not finish refreshing. Check the connection again."
				);
				operationRef.current = null;
				setOperation(null);
			});
		};
		const readOperation =
			desktop.computerOperationCurrent ?? desktop.connectionOperationCurrent;
		const acceptOperation = (operationState: DesktopComputerOperation) => {
			if (!(observing && active.current)) {
				return;
			}
			if ("kind" in operationState) {
				acceptDisconnectOperation(operationState);
			} else {
				acceptConnectOperation(operationState);
			}
		};
		readOperation()
			.then((operationState) => {
				if (
					operationState &&
					observing &&
					!receivedEvent &&
					isCurrentAction(readRevision)
				) {
					acceptOperation(operationState);
				}
			})
			.catch(() => {
				if (observing && isCurrentAction(readRevision)) {
					setRefreshWarning(
						"The current computer operation could not be checked. Check the connection again."
					);
				}
			});
		const stopProgress = desktop.onConnectionProgress(accept);
		const subscribe =
			desktop.onComputerOperation ?? desktop.onConnectionOperation;
		const stopOperation = subscribe((operationState) => {
			receivedEvent = true;
			acceptOperation(operationState);
		});
		return () => {
			observing = false;
			stopProgress();
			stopOperation();
		};
	}, [
		applyDisconnectResult,
		canDisconnect,
		connection.refetch,
		connectionRequestKey,
		expectedAccount,
		input.onCompleted,
		input.onContinue,
		isCurrentAction,
		refetchConnectionContext,
		updateService,
	]);
	const beginOperation = (kind: "connect" | "disconnect") => {
		if (
			operationRef.current ||
			!trustedDisplay ||
			needsCheck ||
			!expectedAccount
		) {
			return null;
		}
		if (adoptedOperationIdRef.current) {
			handledSettlementIdsRef.current.add(adoptedOperationIdRef.current);
		}
		if (progressRef.current) {
			settledProgressIdsRef.current.add(progressRef.current.operationId);
		}
		adoptedOperationIdRef.current = null;
		actionRevisionRef.current += 1;
		operationRef.current = kind;
		ownedOperationRef.current = kind;
		setOperation(kind);
		setFailed(false);
		setDiagnosticId(null);
		setDiagnosticsPath(null);
		setDiagnosticCode(null);
		setRefreshWarning(null);
		setProgress(null);
		progressRef.current = null;
		setMessage(null);
		disconnectPhaseRef.current = "checking";
		setDisconnectPhase("checking");
		return actionRevisionRef.current;
	};
	const finishOwnedOperation = (revision: number) => {
		if (!isCurrentAction(revision)) {
			return;
		}
		if (adoptedOperationIdRef.current) {
			handledSettlementIdsRef.current.add(adoptedOperationIdRef.current);
		}
		if (progressRef.current) {
			settledProgressIdsRef.current.add(progressRef.current.operationId);
		}
		ownedOperationRef.current = null;
		operationRef.current = null;
		setOperation(null);
	};
	const connect = async () => {
		const desktop = getDesktopPlatform();
		const action = updateService
			? desktop?.updateComputer
			: desktop?.connectComputer;
		if (!(action && connectionRequest && setup.selectedHumanProfileId)) {
			return;
		}
		const revision = beginOperation("connect");
		if (revision === null) {
			return;
		}
		let result: DesktopComputerConnectionResult;
		try {
			result = desktopComputerConnectionResultSchema.parse(
				await action(connectionRequest)
			);
		} catch (error) {
			if (isCurrentAction(revision)) {
				setFailed(true);
				setMessage(
					formatDesktopError(
						error,
						"This computer could not connect. Try again."
					)
				);
			}
			finishOwnedOperation(revision);
			return;
		}
		if (!isCurrentAction(revision)) {
			return;
		}
		try {
			await applyAdoptedConnectionSettlement({
				connectionRefetch: connection.refetch,
				localRuntimesRefetch: refetchConnectionContext,
				isActive: () => isCurrentAction(revision),
				onCompleted: input.onCompleted,
				onContinue: input.onContinue,
				operationState: {
					result,
					errorMessage: null,
				},
				requireUpdate: updateService,
				setDiagnosticId,
				setDiagnosticsPath,
				setFailed,
				setMessage,
				setRefreshWarning,
			});
		} catch {
			if (isCurrentAction(revision)) {
				setRefreshWarning(
					"The connection result was received, but the page could not finish refreshing. Check the connection again."
				);
			}
		} finally {
			finishOwnedOperation(revision);
		}
	};
	const disconnect = async () => {
		const desktop = getDesktopPlatform();
		if (
			!(desktop && expectedAccount && connected && canDisconnect) ||
			connection.data?.status !== "available"
		) {
			return;
		}
		const revision = beginOperation("disconnect");
		if (revision === null) {
			return;
		}
		try {
			const result = desktop.disconnectComputerWithFeedback
				? desktopComputerDisconnectResultSchema.parse(
						await desktop.disconnectComputerWithFeedback({
							expectedAccount,
							expectedConnection: connection.data.target,
						})
					)
				: {
						status: (await desktop.disconnectComputer({ expectedAccount }))
							? ("disconnected" as const)
							: ("cancelled" as const),
					};
			await applyDisconnectResult(result, revision);
		} catch {
			await applyDisconnectResult(
				{
					status: "unconfirmed",
					code: "desktop.disconnect.unconfirmed",
					message:
						"The Disconnect result could not be confirmed. Check the connection before trying again.",
				},
				revision
			);
		} finally {
			finishOwnedOperation(revision);
		}
	};
	const checkConnection = async () => {
		const revision = actionRevisionRef.current;
		try {
			const result = await connection.refetch({ throwOnError: true });
			if (isCurrentAction(revision) && !result.isError) {
				setNeedsCheck(false);
				setRefreshWarning(null);
			}
		} catch {
			// The query's existing error is the visible result; no mutation retry.
		}
	};
	const continueWithConnection = () => {
		if (connection.data?.status !== "available") {
			return;
		}
		input.onCompleted?.(connection.data.target);
		input.onContinue?.();
	};
	const useExistingConnection = connected && !requiresConnection;
	return {
		updateService,
		connection,
		connect: useExistingConnection ? continueWithConnection : connect,
		disconnect,
		connected,
		canDisconnect,
		requiresConnection,
		pending,
		operation,
		message,
		failed,
		diagnosticId,
		diagnosticsPath,
		progress,
		disconnectPhase,
		refreshWarning,
		needsCheck,
		diagnosticCode,
		checkConnection,
		checking: !trustedDisplay && connection.isPending,
		disabled:
			pending ||
			needsCheck ||
			!trustedDisplay ||
			!expectedAccount ||
			!(connected || setup.selectedHumanProfileId),
	};
}

function DesktopWebConnection(
	input: ComputerConnectionProps & { intent: ConnectRouteIntent }
) {
	const { intent } = input;
	const [message, setMessage] = useState<string | null>(null);
	const search = buildConnectRouteSearch(intent);
	const path =
		intent.kind === "space_recovery"
			? buildConnectComputerPath({
					...search,
					returnTo: "space",
					spaceId: intent.spaceId,
					agentProfileIds: intent.agentProfileIds,
					orgSlug: input.orgSlug,
				})
			: buildConnectComputerPath({
					...search,
					returnTo: intent.returnTo,
					orgSlug: input.orgSlug,
				});
	const destination = input.sourceNavigationAction
		? buildOrganizationSpacePath({
				orgSlug: input.orgSlug ?? "login",
				spaceId: input.sourceNavigationAction.spaceId,
			})
		: path;
	return (
		<div className="space-y-3">
			<p className="text-sm">
				{input.sourceNavigationAction
					? "Continue the original request in your browser."
					: "Finish recovery in your browser. Your selections will be kept."}
			</p>
			<Button
				onClick={() =>
					openDesktopWeb(destination).catch((error: Error) =>
						setMessage(error.message)
					)
				}
			>
				{input.sourceNavigationAction
					? "Open request in Web"
					: "Continue in Web"}
			</Button>
			{message ? (
				<p className="text-sm" role="alert">
					{message}
				</p>
			) : null}
		</div>
	);
}

function nativeConnectionActionLabel(
	state: Pick<
		ReturnType<typeof useComputerConnection>,
		| "failed"
		| "connected"
		| "canDisconnect"
		| "requiresConnection"
		| "operation"
		| "disconnectPhase"
		| "checking"
		| "updateService"
	>,
	disconnectFeedbackAvailable: boolean
) {
	if (state.updateService) {
		if (state.operation === "connect") {
			return "Updating OpenMeld Tools…";
		}
		return state.failed ? "Try again" : "Update OpenMeld Tools";
	}
	if (state.operation === "disconnect") {
		return disconnectFeedbackAvailable
			? {
					checking: "Checking connection…",
					waiting_for_confirmation: "Waiting for confirmation…",
					disconnecting: "Disconnecting…",
				}[state.disconnectPhase]
			: "Disconnect requested…";
	}
	if (state.operation === "connect") {
		return "Connecting…";
	}
	if (state.checking) {
		return "Checking this Mac…";
	}
	if (state.connected) {
		if (state.canDisconnect) {
			return "Disconnect this Mac";
		}
		if (state.requiresConnection) {
			return state.failed ? "Try again" : "Reconnect this Mac";
		}
		return "Continue";
	}
	return state.failed ? "Try again" : "Connect this Mac";
}

function ConnectionDiagnostics(input: {
	diagnosticId: string | null;
	diagnosticCode: string | null;
	diagnosticsPath: string | null;
}) {
	if (!(input.diagnosticId || input.diagnosticCode || input.diagnosticsPath)) {
		return null;
	}
	return (
		<details className="max-w-full text-muted-foreground text-xs">
			<summary>Connection details</summary>
			{input.diagnosticCode ? (
				<p className="break-all">{input.diagnosticCode}</p>
			) : null}
			{input.diagnosticId ? (
				<p className="break-all">{input.diagnosticId}</p>
			) : null}
			{input.diagnosticsPath ? (
				<p className="break-all">Diagnostic file: {input.diagnosticsPath}</p>
			) : null}
		</details>
	);
}

function DisconnectProgress(input: {
	detailed: boolean;
	phase: DesktopComputerDisconnectPhase;
}) {
	const description = input.detailed
		? {
				checking: "Checking this Mac before Disconnect…",
				waiting_for_confirmation:
					"Waiting for confirmation in Desktop. Choose Cancel or Disconnect this Mac in the native dialog.",
				disconnecting:
					"Disconnect confirmed. Waiting for OpenMeld to report the final result…",
			}[input.phase]
		: "Waiting for Desktop to confirm or complete Disconnect…";
	return (
		<output aria-live="polite" className="text-muted-foreground text-sm">
			{description}
		</output>
	);
}

function ConnectionReadError({ error }: { error: unknown }) {
	if (!error) {
		return null;
	}
	return (
		<p className="text-sm" role="alert">
			{formatDesktopError(error, "Couldn’t check this Mac’s connection.")}
		</p>
	);
}

function nativeConnectionDescription(
	state: Pick<
		ReturnType<typeof useComputerConnection>,
		| "connected"
		| "requiresConnection"
		| "connection"
		| "pending"
		| "updateService"
	>
) {
	if (state.updateService) {
		return "Install the latest OpenMeld Tools and verify the background Service before continuing.";
	}
	if (state.connected) {
		return state.requiresConnection
			? "This Mac is connected to OpenMeld. Reconnect to refresh its connection."
			: "This Mac is connected to OpenMeld. You don’t need to connect it again.";
	}
	if (state.connection.data?.status === "unavailable" && !state.pending) {
		return state.connection.data.message;
	}
	return "Local agents can keep working after you quit Desktop.";
}

function NativeComputerConnection(input: ComputerConnectionProps) {
	const state = useComputerConnection(input);
	const {
		updateService,
		connection,
		connect,
		disconnect,
		connected,
		canDisconnect,
		requiresConnection,
		pending,
		operation,
		message,
		failed,
		diagnosticId,
		diagnosticsPath,
		progress,
		disabled,
		disconnectPhase,
		refreshWarning,
		needsCheck,
		diagnosticCode,
		checkConnection,
		checking,
	} = state;
	const disconnectFeedbackAvailable = Boolean(
		getDesktopPlatform()?.disconnectComputerWithFeedback
	);
	const actionLabel = nativeConnectionActionLabel(
		{
			updateService,
			failed,
			connected,
			canDisconnect,
			requiresConnection,
			operation,
			disconnectPhase,
			checking,
		},
		disconnectFeedbackAvailable
	);
	let title = connected ? "Connected" : "Connect this Mac";
	if (updateService) {
		title = "Update OpenMeld Tools";
	}
	if (needsCheck) {
		title = "Connection unconfirmed";
	}
	const description = nativeConnectionDescription({
		updateService,
		connected,
		requiresConnection,
		connection,
		pending,
	});
	const disconnectAction = connected && canDisconnect;
	const observeInWebPath = buildObserveConnectionProgressPath({
		orgSlug: input.orgSlug,
		prepareSessionId: progress?.prepareSessionId ?? null,
	});
	return (
		<div className="mx-auto flex w-full min-w-0 max-w-lg flex-col items-center gap-4 rounded-md border border-border border-dashed px-6 py-8 text-center [overflow-wrap:anywhere]">
			<SettingsAddComputerCardContent
				description={description}
				descriptionClassName="max-w-sm"
				icon={
					connected && !needsCheck ? (
						<CheckIcon aria-hidden="true" className="size-5" />
					) : undefined
				}
				title={title}
			/>
			<ConnectionReadError error={connection.error} />
			{refreshWarning ? (
				<output className="text-sm">{refreshWarning}</output>
			) : null}
			{connection.isError || refreshWarning || needsCheck ? (
				<Button
					disabled={connection.isFetching || pending}
					onClick={checkConnection}
					size="sm"
					variant="outline"
				>
					Check connection
				</Button>
			) : null}
			<ConnectAgentNextStep orgSlug={input.orgSlug} state={state} />
			<Button
				disabled={disabled}
				onClick={disconnectAction ? disconnect : connect}
				type="button"
				variant={disconnectAction ? "destructive" : "default"}
			>
				{actionLabel}
			</Button>
			{operation === "connect" || (checking && !pending) ? (
				<ConnectionProgress progress={progress} />
			) : null}
			{operation === "disconnect" ? (
				<DisconnectProgress
					detailed={disconnectFeedbackAvailable}
					phase={disconnectPhase}
				/>
			) : null}
			<ObserveConnectionProgressInWebButton path={observeInWebPath} />
			<ConnectionDiagnostics
				diagnosticCode={diagnosticCode}
				diagnosticId={diagnosticId}
				diagnosticsPath={diagnosticsPath}
			/>
			{message ? (
				<p className="text-sm" role={failed ? "alert" : "status"}>
					{message}
				</p>
			) : null}
		</div>
	);
}

function ConnectAgentNextStep({
	orgSlug,
	state,
}: {
	orgSlug?: string;
	state: ReturnType<typeof useComputerConnection>;
}) {
	const navigate = useNavigate();
	const [error, setError] = useState<string | null>(null);
	if (
		!(orgSlug && state.connected && state.canDisconnect) ||
		state.pending ||
		state.disabled ||
		state.failed ||
		state.connection.isError ||
		state.refreshWarning
	) {
		return null;
	}
	return (
		<div className="flex flex-col items-center gap-3">
			<p className="text-muted-foreground text-sm">
				Choose a local Agent to connect next.
			</p>
			<Button
				onClick={() => {
					setError(null);
					navigate({ to: buildOrganizationAgentCreationPath(orgSlug) }).catch(
						() => setError("Couldn’t open Agent setup. Try again.")
					);
				}}
				type="button"
			>
				Connect an Agent
			</Button>
			{error ? (
				<p className="text-sm" role="alert">
					{error}
				</p>
			) : null}
		</div>
	);
}

function ObserveConnectionProgressInWebButton({
	path,
}: {
	path: string | null;
}) {
	if (!path) {
		return null;
	}
	return (
		<Button
			onClick={() => {
				openDesktopWeb(path).catch((error: unknown) => {
					console.error("Could not open connection progress in Web.", error);
				});
			}}
			size="sm"
			type="button"
			variant="ghost"
		>
			View connection progress in Web
		</Button>
	);
}

function buildObserveConnectionProgressPath(input: {
	orgSlug?: string;
	prepareSessionId: string | null;
}): string | null {
	if (!(input.orgSlug && input.prepareSessionId)) {
		return null;
	}
	return buildOrganizationConnectPath({
		orgSlug: input.orgSlug,
		search: { observePrepareSessionId: input.prepareSessionId },
	});
}

function ConnectionProgress({
	progress,
}: {
	progress: DesktopComputerConnectionProgress | null;
}) {
	const [nowMs, setNowMs] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
		return () => window.clearInterval(timer);
	}, []);
	if (!progress) {
		return (
			<output className="block text-muted-foreground text-sm">
				Checking this Mac’s connection…
			</output>
		);
	}
	const view = presentComputerConnectionProgress(progress);
	const elapsed = formatComputerConnectionElapsed(progress.startedAt, nowMs);
	return (
		<div className="block w-full max-w-sm space-y-2 text-left">
			<div className="flex items-center justify-between gap-3 text-sm">
				<output aria-live="polite" className="font-medium text-foreground">
					{view.stage}
				</output>
				{view.percentage === null ? null : (
					<span className="text-muted-foreground tabular-nums">
						{view.percentage}%
					</span>
				)}
			</div>
			<div
				{...(view.determinate
					? {
							role: "progressbar",
							"aria-label": view.stage,
							"aria-valuemin": 0,
							"aria-valuemax": 100,
							"aria-valuenow": view.percentage ?? 0,
						}
					: {})}
				className="h-1.5 overflow-hidden rounded-full bg-muted"
			>
				<div
					className={
						view.determinate
							? "h-full rounded-full bg-primary transition-[width]"
							: "h-full w-1/3 rounded-full bg-primary motion-safe:animate-pulse"
					}
					style={
						view.determinate ? { width: `${view.percentage ?? 0}%` } : undefined
					}
				/>
			</div>
			<p className="text-muted-foreground text-xs">
				{view.description}
				{elapsed ? ` ${elapsed} elapsed.` : ""}
			</p>
		</div>
	);
}
