import {
	type DesktopComputerConnectionOperation,
	type DesktopComputerConnectionProgress,
	type DesktopComputerConnectionRequest,
	desktopComputerConnectionResultSchema,
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
import { useEffect, useRef, useState } from "react";
import { useBringAgentsSetupContext } from "#/components/connect/bring-agents-setup-context";
import { useAuthSession } from "#/hooks/auth.hooks";
import {
	buildConnectComputerPath,
	buildConnectRouteSearch,
	type ConnectRouteIntent,
} from "#/lib/connect/connect-route";
import {
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
	onContinue?: () => void;
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
	operationState: DesktopComputerConnectionOperation;
	setDiagnosticId(value: string | null): void;
	setDiagnosticsPath(value: string | null): void;
	setFailed(value: boolean): void;
	setMessage(value: string | null): void;
}) {
	if (input.operationState.errorMessage) {
		input.setFailed(true);
		input.setMessage(input.operationState.errorMessage);
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
	await Promise.all([input.localRuntimesRefetch(), input.connectionRefetch()]);
	if (!input.isActive()) {
		return;
	}
	input.onCompleted?.(
		result.status === "completed" ? result.snapshot : result.connection
	);
	input.setMessage(
		result.status === "completed" ? null : "Using the existing connection."
	);
	input.onContinue?.();
}

export function DesktopComputerConnection(input: ComputerConnectionProps) {
	const { routeIntent } = useBringAgentsSetupContext();
	const account = useAuthSession().data?.user.id;
	if (
		routeIntent.serviceAction === "update_service" ||
		routeIntent.kind === "space_recovery"
	) {
		return <DesktopWebConnection {...input} intent={routeIntent} />;
	}
	return <NativeComputerConnection {...input} key={account} />;
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
	const ownedConnectRef = useRef(false);
	const adoptedOperationIdRef = useRef<string | null>(null);
	const adoptedRequestKeyRef = useRef<string | null>(null);
	const handledSettlementIdsRef = useRef(new Set<string>());
	const settledProgressIdsRef = useRef(new Set<string>());
	const expectedAccount = session.data?.user.id;
	const intent = setup.routeIntent;
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
				};
	const connectionRequestKey = connectionRequest
		? buildConnectionRequestKey(connectionRequest)
		: null;
	const connected =
		input.allowDisconnect &&
		!intent.resetThisComputer &&
		!input.sourceNavigationAction &&
		!intent.connectedComputerId &&
		connection.data?.status === "available";
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
		const accept = (event: DesktopComputerConnectionProgress): boolean => {
			if (
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
				ownedConnectRef.current ||
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
			setOperation(null);
			await applyAdoptedConnectionSettlement({
				connectionRefetch: connection.refetch,
				isActive: () => active.current,
				localRuntimesRefetch: setup.localRuntimesQuery.refetch,
				onCompleted: input.onCompleted,
				onContinue: input.onContinue,
				operationState,
				setDiagnosticId,
				setDiagnosticsPath,
				setFailed,
				setMessage,
			});
		};
		const acceptOperation = (
			operationState: DesktopComputerConnectionOperation
		) => {
			if (
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
				if (!ownedConnectRef.current) {
					setOperation("connect");
				}
				return;
			}
			settleAdoptedOperation(operationState).catch((error: unknown) => {
				if (!active.current) {
					return;
				}
				setFailed(true);
				setMessage(
					formatDesktopError(
						error,
						"This computer could not confirm its connection. Try again."
					)
				);
				setOperation(null);
			});
		};
		desktop.connectionOperationCurrent().then((operationState) => {
			if (operationState && active.current) {
				acceptOperation(operationState);
			}
		});
		const stopProgress = desktop.onConnectionProgress(accept);
		const stopOperation = desktop.onConnectionOperation(acceptOperation);
		return () => {
			stopProgress();
			stopOperation();
		};
	}, [
		connection.refetch,
		connectionRequestKey,
		expectedAccount,
		input.onCompleted,
		input.onContinue,
		setup.localRuntimesQuery.refetch,
	]);
	const connect = async () => {
		const desktop = getDesktopPlatform();
		if (!(desktop && connectionRequest)) {
			return;
		}
		setOperation("connect");
		ownedConnectRef.current = true;
		setFailed(false);
		setDiagnosticId(null);
		setDiagnosticsPath(null);
		setProgress(null);
		progressRef.current = null;
		setMessage(null);
		try {
			const result = desktopComputerConnectionResultSchema.parse(
				await desktop.connectComputer(connectionRequest)
			);
			if (!active.current) {
				return;
			}
			if (result.status === "cancelled") {
				setMessage("Connection unchanged.");
				return;
			}
			if (result.status === "failed") {
				setFailed(true);
				setMessage(result.message);
				setDiagnosticId(result.diagnosticId);
				setDiagnosticsPath(result.diagnosticsPath ?? null);
				return;
			}
			await setup.localRuntimesQuery.refetch();
			await connection.refetch();
			if (!active.current) {
				return;
			}
			input.onCompleted?.(
				result.status === "completed" ? result.snapshot : result.connection
			);
			setMessage(
				result.status === "completed" ? null : "Using the existing connection."
			);
			input.onContinue?.();
		} catch (error) {
			setFailed(true);
			setMessage(
				formatDesktopError(error, "This computer could not connect. Try again.")
			);
		} finally {
			ownedConnectRef.current = false;
			setOperation(null);
		}
	};
	const disconnect = async () => {
		const desktop = getDesktopPlatform();
		if (!(desktop && expectedAccount)) {
			return;
		}
		setOperation("disconnect");
		setFailed(false);
		setMessage(null);
		setDiagnosticId(null);
		setDiagnosticsPath(null);
		setProgress(null);
		try {
			if (await desktop.disconnectComputer({ expectedAccount })) {
				if (!active.current) {
					return;
				}
				await Promise.all([
					connection.refetch(),
					setup.localRuntimesQuery.refetch(),
				]);
				if (!active.current) {
					return;
				}
				setMessage("Disconnected. This Mac remains in your Computers list.");
			}
		} catch (error) {
			setFailed(true);
			setMessage(
				formatDesktopError(
					error,
					"This Mac could not disconnect. Check its connection and try again."
				)
			);
		} finally {
			setOperation(null);
		}
	};
	return {
		connection,
		connect,
		disconnect,
		connected,
		pending,
		operation,
		message,
		failed,
		diagnosticId,
		diagnosticsPath,
		progress,
		disabled:
			pending ||
			connection.isFetching ||
			connection.isPending ||
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

function NativeComputerConnection(input: ComputerConnectionProps) {
	const {
		connection,
		connect,
		disconnect,
		connected,
		pending,
		operation,
		message,
		failed,
		diagnosticId,
		diagnosticsPath,
		progress,
		disabled,
	} = useComputerConnection(input);
	let actionLabel = failed ? "Try again" : "Connect this Mac";
	if (connected) {
		actionLabel = "Disconnect this Mac";
	}
	if (operation === "connect") {
		actionLabel = "Connecting…";
	}
	if (operation === "disconnect") {
		actionLabel = "Disconnecting…";
	}
	let description = "Local agents can keep working after you quit Desktop.";
	if (connection.data?.status === "unavailable" && !pending) {
		description = connection.data.message;
	}
	const observeInWebPath = buildObserveConnectionProgressPath({
		orgSlug: input.orgSlug,
		prepareSessionId: progress?.prepareSessionId ?? null,
	});
	return (
		<div className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 rounded-md border border-border border-dashed px-6 py-8 text-center">
			<SettingsAddComputerCardContent
				description={description}
				descriptionClassName="max-w-sm"
				icon={
					connected ? (
						<CheckIcon aria-hidden="true" className="size-5" />
					) : undefined
				}
				title={connected ? "Connected" : "Connect this Mac"}
			/>
			{connection.isError ? (
				<div className="space-y-2 text-sm" role="alert">
					<p>
						{formatDesktopError(
							connection.error,
							"Couldn’t check this Mac’s connection."
						)}
					</p>
					<Button
						disabled={connection.isFetching || pending}
						onClick={() => connection.refetch()}
						size="sm"
						variant="outline"
					>
						Check connection
					</Button>
				</div>
			) : null}
			<Button
				disabled={disabled}
				onClick={connected ? disconnect : connect}
				type="button"
				variant={connected ? "destructive" : "default"}
			>
				{actionLabel}
			</Button>
			{pending ? <ConnectionProgress progress={progress} /> : null}
			<ObserveConnectionProgressInWebButton path={observeInWebPath} />
			{diagnosticId ? (
				<details className="text-muted-foreground text-xs">
					<summary>Connection details</summary>
					<p>{diagnosticId}</p>
					{diagnosticsPath ? (
						<p className="break-all">Diagnostic file: {diagnosticsPath}</p>
					) : null}
				</details>
			) : null}
			{message ? (
				<p className="text-sm" role={failed ? "alert" : "status"}>
					{message}
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
