"use client";

import type {
	ConnectorConnection,
	ConnectorConnectionListResponse,
	ConnectorCredentialConnectResponse,
	ConnectorDisconnectResponse,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowSquareOutIcon,
	CheckIcon,
	CircleNotchIcon,
	LinkBreakIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	connectCurrentMemberConnectorCredential,
	connectCurrentOrganizationSharedConnectorCredential,
	disconnectOrganizationConnectorConnection,
	disconnectSharedOrganizationConnectorConnection,
	isConnectorConnectionConfirmationRetryable,
	resolveConnectorConnectionErrorMessage,
	startCurrentMemberConnectorAuthorization,
	startCurrentOrganizationSharedConnectorAuthorization,
} from "#/lib/organizations/connector-connections";
import {
	invalidateOrganizationPluginConnections,
	organizationPluginConnectionQueryKeys,
	organizationPluginServiceConnectionsQueryOptions,
} from "#/query/organizations/plugin-connections";
import type {
	PluginConnection,
	PluginConnectionAuth,
	PluginCredentialAuth,
	PluginDefinition,
} from "./plugin-catalog";
import {
	PluginAccessLoadingSkeleton,
	usePluginConnectionSnapshotCurrent,
} from "./plugin-connection-status-ui";

const AUTHORIZATION_POLL_INTERVAL_MS = 1200;
const AUTHORIZATION_POPUP_CHECK_INTERVAL_MS = 250;
const AUTHORIZATION_TIMEOUT_MS = 120_000;

type AuthorizationScope = "member" | "shared";
type ConnectPending = {
	authKind: PluginConnectionAuth["kind"];
	scope: AuthorizationScope;
};
type DisconnectRequest = {
	scope: AuthorizationScope;
	userId?: string;
};
type LocalConnectionError = {
	message: string;
	retryConnectionStatus?: boolean;
};

function canRetryConnectionStatus(input: {
	connectionError: unknown;
	connectionErrorVisible: boolean;
	localError: LocalConnectionError | null;
}): boolean {
	return (
		input.connectionErrorVisible &&
		isConnectorConnectionConfirmationRetryable(input.connectionError) &&
		(input.localError === null ||
			input.localError.retryConnectionStatus === true)
	);
}

function resolveConnectPending(input: {
	authorizationScope: AuthorizationScope | null;
	credentialScope: AuthorizationScope | null;
}): ConnectPending | null {
	if (input.authorizationScope) {
		return { authKind: "oauth", scope: input.authorizationScope };
	}
	if (input.credentialScope) {
		return { authKind: "credential", scope: input.credentialScope };
	}
	return null;
}

function resolveActiveConnectionGroups(input: {
	canManage: boolean;
	connections?: ConnectorConnection[];
	currentUserId?: string;
	mode: "all" | "member";
}) {
	const activeConnections =
		input.connections?.filter((connection) => connection.status === "active") ??
		[];
	return {
		currentUserConnection: activeConnections.find(
			(connection) =>
				connection.scope === "member" &&
				connection.userId === input.currentUserId
		),
		otherMemberConnections:
			input.canManage && input.mode === "all"
				? activeConnections.filter(
						(connection) =>
							connection.scope === "member" &&
							connection.userId !== input.currentUserId
					)
				: [],
		sharedConnection: activeConnections.find(
			(connection) => connection.scope === "shared"
		),
	};
}

function isAuthorizationScopeConnected(input: {
	response?: ConnectorConnectionListResponse;
	scope: AuthorizationScope;
}): boolean {
	return Boolean(
		input.response?.connections.some(
			(connection) =>
				connection.status === "active" &&
				connection.scope === input.scope &&
				(input.scope === "shared" ||
					connection.userId === input.response?.currentUserId)
		)
	);
}

type PluginConnectionCardProps = {
	plugin: Extract<PluginDefinition, { availability: "available" }>;
	canManage: boolean;
	isPersonalWorkspace?: boolean;
	mode: "all" | "member";
	organizationId: string;
};

export function PluginConnectionCard(input: PluginConnectionCardProps) {
	return (
		<PluginConnectionCardState
			{...input}
			key={`${input.organizationId}:${input.plugin.service}:${input.mode}`}
		/>
	);
}

function PluginConnectionCardState(input: PluginConnectionCardProps) {
	const queryClient = useQueryClient();
	const [waitingScope, setWaitingScope] = useState<AuthorizationScope | null>(
		null
	);
	const [localError, setLocalError] = useState<LocalConnectionError | null>(
		null
	);
	const [credentialResetKey, setCredentialResetKey] = useState(0);
	const authorizationPopupRef = useRef<Window | null>(null);
	const authorizationFailureSettledRef = useRef(false);
	const authorizationTimeoutReconcilingRef = useRef(false);
	const connectionsQuery = useQuery(
		organizationPluginServiceConnectionsQueryOptions({
			organizationId: input.organizationId,
			queryClient,
			refetchInterval: waitingScope
				? AUTHORIZATION_POLL_INTERVAL_MS
				: undefined,
			service: input.plugin.service,
		})
	);
	const refetchConnections = connectionsQuery.refetch;
	const { currentUserConnection, otherMemberConnections, sharedConnection } =
		resolveActiveConnectionGroups({
			canManage: input.canManage,
			connections: connectionsQuery.data?.connections,
			currentUserId: connectionsQuery.data?.currentUserId,
			mode: input.mode,
		});
	const authorizationCompleted =
		(waitingScope === "member" && Boolean(currentUserConnection)) ||
		(waitingScope === "shared" && Boolean(sharedConnection));
	const sharedScopeName = input.isPersonalWorkspace
		? "Workspace"
		: "Organization";
	const serviceConnectionsQueryKey =
		organizationPluginConnectionQueryKeys.service(
			input.organizationId,
			input.plugin.service
		);
	const settleAuthorizationFailure = useCallback(
		(error: unknown, scope: AuthorizationScope) => {
			if (authorizationFailureSettledRef.current) {
				return;
			}
			authorizationFailureSettledRef.current = true;
			console.error(
				"[openmeld.web.connector_authorization_confirmation_failed]",
				{
					error,
					organizationId: input.organizationId,
					scope,
					service: input.plugin.service,
				}
			);
			authorizationPopupRef.current?.close();
			authorizationPopupRef.current = null;
			setWaitingScope(null);
			setLocalError({
				message: resolveConnectorConnectionErrorMessage(
					error,
					input.plugin.name
				),
			});
		},
		[input.plugin.name, input.plugin.service, input.organizationId]
	);

	useEffect(
		() => () => {
			authorizationPopupRef.current?.close();
			authorizationPopupRef.current = null;
		},
		[]
	);

	useEffect(() => {
		if (!authorizationCompleted) {
			return;
		}
		const completion = window.setTimeout(() => {
			authorizationPopupRef.current?.close();
			authorizationPopupRef.current = null;
			setWaitingScope(null);
			setLocalError(null);
			toast.success(
				waitingScope === "shared"
					? `${input.plugin.name} ${sharedScopeName} access connected.`
					: `${input.plugin.name} connected.`
			);
		}, 0);
		return () => window.clearTimeout(completion);
	}, [
		authorizationCompleted,
		input.plugin.name,
		sharedScopeName,
		waitingScope,
	]);

	useEffect(() => {
		if (
			!(waitingScope && connectionsQuery.isError) ||
			isConnectorConnectionConfirmationRetryable(connectionsQuery.error)
		) {
			return;
		}
		settleAuthorizationFailure(connectionsQuery.error, waitingScope);
	}, [
		connectionsQuery.error,
		connectionsQuery.isError,
		settleAuthorizationFailure,
		waitingScope,
	]);

	useEffect(() => {
		if (!waitingScope) {
			return;
		}
		let isCurrentAttempt = true;
		let isConfirmingClosedPopup = false;
		let hasObservedClosedPopup = false;
		let hasLoggedConfirmationFailure = false;
		let nextConfirmationAtMs = 0;
		const handleConfirmationFailure = (error: unknown) => {
			if (!isConnectorConnectionConfirmationRetryable(error)) {
				settleAuthorizationFailure(error, waitingScope);
				return;
			}
			if (!hasLoggedConfirmationFailure) {
				console.error(
					"[openmeld.web.connector_authorization_confirmation_failed]",
					{
						error,
						organizationId: input.organizationId,
						scope: waitingScope,
						service: input.plugin.service,
					}
				);
				hasLoggedConfirmationFailure = true;
			}
			isConfirmingClosedPopup = false;
			nextConfirmationAtMs = Date.now() + AUTHORIZATION_POLL_INTERVAL_MS;
		};
		const popupCheck = window.setInterval(() => {
			if (authorizationTimeoutReconcilingRef.current) {
				return;
			}
			if (!hasObservedClosedPopup) {
				const popup = authorizationPopupRef.current;
				if (!popup?.closed) {
					return;
				}
				hasObservedClosedPopup = true;
				authorizationPopupRef.current = null;
			}
			if (isConfirmingClosedPopup || Date.now() < nextConfirmationAtMs) {
				return;
			}
			isConfirmingClosedPopup = true;
			refetchConnections()
				.then((result) => {
					if (!isCurrentAttempt) {
						return;
					}
					if (result.error) {
						handleConfirmationFailure(result.error);
						return;
					}
					if (
						isAuthorizationScopeConnected({
							response: result.data,
							scope: waitingScope,
						})
					) {
						return;
					}
					setWaitingScope(null);
					setLocalError({
						message: `${input.plugin.name} wasn’t connected. Try again when you’re ready.`,
					});
				})
				.catch((error: unknown) => {
					if (isCurrentAttempt) {
						handleConfirmationFailure(error);
					}
				});
		}, AUTHORIZATION_POPUP_CHECK_INTERVAL_MS);
		return () => {
			isCurrentAttempt = false;
			window.clearInterval(popupCheck);
		};
	}, [
		input.plugin.name,
		input.plugin.service,
		input.organizationId,
		refetchConnections,
		settleAuthorizationFailure,
		waitingScope,
	]);

	useEffect(() => {
		if (!waitingScope) {
			return;
		}
		let isCurrentAttempt = true;
		const settleTimeout = () => {
			if (!isCurrentAttempt) {
				return;
			}
			setWaitingScope(null);
			setLocalError({
				message: `${input.plugin.name} authorization timed out. Start again when you are ready.`,
				retryConnectionStatus: true,
			});
		};
		const settleReconciliationError = (error: unknown) => {
			if (!isCurrentAttempt) {
				return;
			}
			if (!isConnectorConnectionConfirmationRetryable(error)) {
				settleAuthorizationFailure(error, waitingScope);
				return;
			}
			settleTimeout();
		};
		const reconcileTimeout = async () => {
			authorizationTimeoutReconcilingRef.current = true;
			authorizationPopupRef.current?.close();
			authorizationPopupRef.current = null;
			try {
				await queryClient.cancelQueries({
					exact: true,
					queryKey: organizationPluginConnectionQueryKeys.service(
						input.organizationId,
						input.plugin.service
					),
				});
				if (!isCurrentAttempt) {
					return;
				}
				const result = await refetchConnections();
				if (!isCurrentAttempt) {
					return;
				}
				if (result.error) {
					settleReconciliationError(result.error);
					return;
				}
				if (
					isAuthorizationScopeConnected({
						response: result.data,
						scope: waitingScope,
					})
				) {
					return;
				}
				settleTimeout();
			} catch (error) {
				settleReconciliationError(error);
			}
		};
		const timeout = window.setTimeout(
			reconcileTimeout,
			AUTHORIZATION_TIMEOUT_MS
		);
		return () => {
			isCurrentAttempt = false;
			window.clearTimeout(timeout);
		};
	}, [
		input.plugin.name,
		input.plugin.service,
		input.organizationId,
		queryClient,
		refetchConnections,
		settleAuthorizationFailure,
		waitingScope,
	]);

	const authorizationMutation = useMutation({
		mutationFn: async (scope: AuthorizationScope) =>
			scope === "shared"
				? await startCurrentOrganizationSharedConnectorAuthorization({
						organizationId: input.organizationId,
						service: input.plugin.service,
					})
				: await startCurrentMemberConnectorAuthorization({
						organizationId: input.organizationId,
						service: input.plugin.service,
					}),
		onError: (error) => {
			authorizationPopupRef.current?.close();
			authorizationPopupRef.current = null;
			setWaitingScope(null);
			setLocalError({
				message: resolveConnectorConnectionErrorMessage(
					error,
					input.plugin.name
				),
			});
		},
		onMutate: () => {
			authorizationFailureSettledRef.current = false;
			authorizationTimeoutReconcilingRef.current = false;
			setLocalError(null);
		},
		onSuccess: (authorization, scope) => {
			const popup = authorizationPopupRef.current;
			if (!popup || popup.closed) {
				setLocalError({
					message: `The ${input.plugin.name} window closed before authorization started. Try again.`,
				});
				return;
			}
			popup.location.href = authorization.authorizationUrl;
			setWaitingScope(scope);
			popup.focus();
		},
	});
	const credentialMutation = useMutation<
		ConnectorCredentialConnectResponse,
		unknown,
		{
			authType: PluginCredentialAuth["authType"];
			scope: AuthorizationScope;
			values: Record<string, string>;
		},
		{ previousConnections: ConnectorConnectionListResponse | undefined }
	>({
		mutationFn: async (request: {
			authType: PluginCredentialAuth["authType"];
			scope: AuthorizationScope;
			values: Record<string, string>;
		}) => {
			const credential = {
				authType: request.authType,
				organizationId: input.organizationId,
				service: input.plugin.service,
				values: request.values,
			};
			return request.scope === "shared"
				? await connectCurrentOrganizationSharedConnectorCredential(credential)
				: await connectCurrentMemberConnectorCredential(credential);
		},
		onError: (error, _request, context) => {
			queryClient.setQueryData(
				serviceConnectionsQueryKey,
				context?.previousConnections
			);
			setLocalError({
				message: resolveConnectorConnectionErrorMessage(
					error,
					input.plugin.name
				),
			});
		},
		onMutate: async (request) => {
			setLocalError(null);
			await queryClient.cancelQueries({ queryKey: serviceConnectionsQueryKey });
			const previousConnections =
				queryClient.getQueryData<ConnectorConnectionListResponse>(
					serviceConnectionsQueryKey
				);
			if (previousConnections) {
				queryClient.setQueryData<ConnectorConnectionListResponse>(
					serviceConnectionsQueryKey,
					upsertOptimisticConnection({
						appName: input.plugin.name,
						current: previousConnections,
						scope: request.scope,
						service: input.plugin.service,
					})
				);
			}
			return { previousConnections };
		},
		onSettled: async () => {
			setCredentialResetKey((current) => current + 1);
			await invalidateOrganizationPluginConnections({
				organizationId: input.organizationId,
				queryClient,
				service: input.plugin.service,
			});
		},
		onSuccess: (response, request) => {
			queryClient.setQueryData<ConnectorConnectionListResponse>(
				serviceConnectionsQueryKey,
				(current) =>
					current
						? replaceConnection({
								connection: response.connection,
								current,
								scope: request.scope,
								userId: response.connection.userId,
							})
						: current
			);
			toast.success(
				request.scope === "shared"
					? `${input.plugin.name} ${sharedScopeName} access connected.`
					: `${input.plugin.name} connected.`
			);
		},
	});
	const disconnectMutation = useMutation<
		ConnectorDisconnectResponse,
		unknown,
		DisconnectRequest,
		{ previousConnections: ConnectorConnectionListResponse | undefined }
	>({
		mutationFn: async (request: DisconnectRequest) =>
			request.scope === "shared"
				? await disconnectSharedOrganizationConnectorConnection({
						organizationId: input.organizationId,
						service: input.plugin.service,
					})
				: await disconnectOrganizationConnectorConnection({
						organizationId: input.organizationId,
						service: input.plugin.service,
						userId: request.userId ?? "",
					}),
		onError: (error, _request, context) => {
			queryClient.setQueryData(
				serviceConnectionsQueryKey,
				context?.previousConnections
			);
			setLocalError({
				message: resolveConnectorConnectionErrorMessage(
					error,
					input.plugin.name
				),
			});
		},
		onMutate: async (request) => {
			setLocalError(null);
			await queryClient.cancelQueries({ queryKey: serviceConnectionsQueryKey });
			const previousConnections =
				queryClient.getQueryData<ConnectorConnectionListResponse>(
					serviceConnectionsQueryKey
				);
			if (previousConnections) {
				queryClient.setQueryData<ConnectorConnectionListResponse>(
					serviceConnectionsQueryKey,
					removeConnection({
						current: previousConnections,
						scope: request.scope,
						userId: request.userId,
					})
				);
			}
			return { previousConnections };
		},
		onSettled: async () => {
			await invalidateOrganizationPluginConnections({
				organizationId: input.organizationId,
				queryClient,
				service: input.plugin.service,
			});
		},
		onSuccess: (_response, request) => {
			toast.success(
				request.scope === "shared"
					? `${input.plugin.name} ${sharedScopeName} access disconnected.`
					: `${input.plugin.name} disconnected.`
			);
		},
	});
	const authorizationPendingScope =
		waitingScope ??
		(authorizationMutation.isPending
			? (authorizationMutation.variables ?? null)
			: null);
	const credentialPendingScope = credentialMutation.isPending
		? (credentialMutation.variables?.scope ?? null)
		: null;
	const connectPending = resolveConnectPending({
		authorizationScope: authorizationPendingScope,
		credentialScope: credentialPendingScope,
	});
	const operationPending =
		connectPending !== null || disconnectMutation.isPending;
	const disconnectPendingRequest = disconnectMutation.isPending
		? (disconnectMutation.variables ?? null)
		: null;
	const connectionSnapshotIsCurrent =
		usePluginConnectionSnapshotCurrent(connectionsQuery);
	const statusAvailable = Boolean(connectionsQuery.data);
	const statusChecking =
		!connectionsQuery.isPending &&
		(connectionsQuery.isFetching || connectionsQuery.isPaused);
	const connectionErrorVisible =
		connectionsQuery.isError && waitingScope === null;

	return (
		<PluginConnectionCardContent
			actionsDisabled={operationPending || !connectionSnapshotIsCurrent}
			canManage={input.canManage}
			connectPending={connectPending}
			credentialResetKey={credentialResetKey}
			currentUserConnection={currentUserConnection}
			currentUserId={connectionsQuery.data?.currentUserId}
			disconnectPendingRequest={disconnectPendingRequest}
			errorMessage={
				localError?.message ??
				(connectionErrorVisible
					? resolveConnectorConnectionErrorMessage(
							connectionsQuery.error,
							input.plugin.name
						)
					: null)
			}
			isPersonalWorkspace={input.isPersonalWorkspace === true}
			loading={connectionsQuery.isPending}
			mode={input.mode}
			onConnect={(scope, auth, values) =>
				connect({
					auth,
					onCredential: (credentialAuth, credentialValues) =>
						credentialMutation.mutate({
							authType: credentialAuth.authType,
							scope,
							values: credentialValues,
						}),
					onOAuth: () =>
						startAuthorization({
							appName: input.plugin.name,
							mutation: authorizationMutation.mutate,
							onBlocked: (message) => setLocalError({ message }),
							popupRef: authorizationPopupRef,
							scope,
						}),
					values,
				})
			}
			onDisconnect={(request) => disconnectMutation.mutate(request)}
			onRetry={() => {
				setLocalError(null);
				connectionsQuery.refetch();
			}}
			otherMemberConnections={otherMemberConnections}
			plugin={input.plugin}
			sharedConnection={sharedConnection}
			showConnectionRetry={canRetryConnectionStatus({
				connectionError: connectionsQuery.error,
				connectionErrorVisible,
				localError,
			})}
			statusAvailable={statusAvailable}
			statusChecking={statusChecking}
		/>
	);
}

function PluginConnectionCardContent(input: {
	actionsDisabled: boolean;
	plugin: Extract<PluginDefinition, { availability: "available" }>;
	canManage: boolean;
	connectPending: ConnectPending | null;
	credentialResetKey: number;
	currentUserId?: string;
	currentUserConnection?: ConnectorConnection;
	errorMessage: string | null;
	isPersonalWorkspace: boolean;
	loading: boolean;
	mode: "all" | "member";
	disconnectPendingRequest: DisconnectRequest | null;
	onConnect: (
		scope: AuthorizationScope,
		auth: PluginConnectionAuth,
		values: Record<string, string>
	) => void;
	onDisconnect: (request: {
		scope: AuthorizationScope;
		userId?: string;
	}) => void;
	onRetry: () => void;
	otherMemberConnections: ConnectorConnection[];
	sharedConnection?: ConnectorConnection;
	showConnectionRetry: boolean;
	statusAvailable: boolean;
	statusChecking: boolean;
}) {
	const disconnectingCurrentUser =
		input.disconnectPendingRequest?.scope === "member" &&
		input.disconnectPendingRequest.userId === input.currentUserId;
	const disconnectingShared =
		input.disconnectPendingRequest?.scope === "shared";
	return (
		<section
			aria-busy={
				input.loading ||
				input.statusChecking ||
				input.disconnectPendingRequest !== null
			}
			aria-label={`${input.plugin.name} connection status`}
			className={cn(
				"divide-y divide-border/70",
				input.loading && "pointer-events-none opacity-60"
			)}
		>
			<ConnectionSection
				actionsDisabled={input.actionsDisabled}
				appName={input.plugin.name}
				canManage
				connection={input.currentUserConnection}
				connectionConfig={input.plugin.connection}
				connectPendingKind={
					input.connectPending?.scope === "member"
						? input.connectPending.authKind
						: null
				}
				description="Used only for your requests."
				disconnectPending={disconnectingCurrentUser}
				key={`member-${input.credentialResetKey}`}
				loading={input.loading}
				onConnect={(auth, values) => input.onConnect("member", auth, values)}
				onDisconnect={() =>
					input.currentUserConnection
						? input.onDisconnect({
								scope: "member",
								userId: input.currentUserConnection.userId,
							})
						: undefined
				}
				scope="member"
				statusAvailable={input.statusAvailable}
				statusChecking={input.statusChecking}
				title="Your access"
			/>
			{input.mode === "all" && input.canManage && !input.isPersonalWorkspace ? (
				<MemberConnectionsSection
					actionsDisabled={input.actionsDisabled}
					appName={input.plugin.name}
					connections={input.otherMemberConnections}
					disconnectPendingUserId={
						input.disconnectPendingRequest?.scope === "member"
							? input.disconnectPendingRequest.userId
							: undefined
					}
					loading={input.loading}
					onDisconnect={(userId) =>
						input.onDisconnect({ scope: "member", userId })
					}
					statusAvailable={input.statusAvailable}
					statusChecking={input.statusChecking}
				/>
			) : null}
			{input.mode === "member" ? null : (
				<ConnectionSection
					actionsDisabled={input.actionsDisabled}
					appName={input.plugin.name}
					canManage={input.canManage}
					connectedScopeName={
						input.isPersonalWorkspace ? "Workspace" : "Organization"
					}
					connection={input.sharedConnection}
					connectionConfig={input.plugin.connection}
					connectPendingKind={
						input.connectPending?.scope === "shared"
							? input.connectPending.authKind
							: null
					}
					description={
						input.isPersonalWorkspace
							? "Available to your Center Agent and Routines."
							: "Available to every Organization member and Routine."
					}
					disconnectPending={disconnectingShared}
					key={`shared-${input.credentialResetKey}`}
					loading={input.loading}
					onConnect={(auth, values) => input.onConnect("shared", auth, values)}
					onDisconnect={() => input.onDisconnect({ scope: "shared" })}
					scope="shared"
					statusAvailable={input.statusAvailable}
					statusChecking={input.statusChecking}
					title={
						input.isPersonalWorkspace
							? "Workspace access"
							: "Organization access"
					}
				/>
			)}
			{input.errorMessage ? (
				<div
					className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-5"
					role="alert"
				>
					<p className="text-destructive text-xs">{input.errorMessage}</p>
					{input.showConnectionRetry ? (
						<Button
							onClick={input.onRetry}
							size="xs"
							type="button"
							variant="outline"
						>
							Retry
						</Button>
					) : null}
				</div>
			) : null}
		</section>
	);
}

type ConnectionSectionInput = {
	actionsDisabled: boolean;
	appName: string;
	canManage: boolean;
	connectPendingKind: PluginConnectionAuth["kind"] | null;
	connection?: ConnectorConnection;
	connectionConfig: PluginConnection;
	description: string;
	disconnectPending: boolean;
	loading: boolean;
	onConnect: (
		auth: PluginConnectionAuth,
		values: Record<string, string>
	) => void;
	onDisconnect: () => void;
	statusAvailable: boolean;
	statusChecking: boolean;
	title: string;
} & (
	| { scope: "member" }
	| { connectedScopeName: "Organization" | "Workspace"; scope: "shared" }
);

function ConnectionSection(input: ConnectionSectionInput) {
	return (
		<section aria-label={input.title} className="px-4 py-4 sm:px-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="font-medium text-foreground text-sm">{input.title}</h3>
					<p className="mt-1 max-w-2xl text-muted-foreground text-xs leading-5">
						{input.description}
					</p>
				</div>
			</div>

			{input.loading ? (
				<PluginAccessLoadingSkeleton />
			) : (
				<ConnectionControl {...input} />
			)}
		</section>
	);
}

function ConnectionControl(input: ConnectionSectionInput) {
	if (!input.statusAvailable) {
		return null;
	}
	if (input.disconnectPending && !input.connection) {
		return <PendingDisconnectAction appName={input.appName} />;
	}
	if (input.connection) {
		const presentation = resolveConnectionSummaryPresentation({
			connection: input.connection,
			section: input,
		});
		return (
			<ConnectionSummary
				appName={input.appName}
				canManage={input.canManage}
				connection={input.connection}
				disabled={input.actionsDisabled}
				disconnectPending={input.disconnectPending}
				label={presentation.label}
				onDisconnect={input.onDisconnect}
				statusChecking={input.statusChecking}
				subtitle={presentation.subtitle}
			/>
		);
	}
	return <DisconnectedConnectionControl {...input} />;
}

function DisconnectedConnectionControl(input: ConnectionSectionInput) {
	const [values, setValues] = useState<Record<string, string>>({});
	const [usingCredentialFallback, setUsingCredentialFallback] = useState(false);
	const primaryAuth = input.connectionConfig.auth;
	const auth =
		primaryAuth.kind === "oauth" && usingCredentialFallback
			? (primaryAuth.credentialFallback ?? primaryAuth)
			: primaryAuth;
	const connectPending = input.connectPendingKind === auth.kind;
	const statusChecking = input.statusChecking && !connectPending;
	const connectActionLabel = resolveConnectActionLabel({
		appName: input.appName,
		connectPending,
		oauth: auth.kind === "oauth",
		statusChecking,
	});
	if (auth.kind === "oauth") {
		return (
			<div className="mt-4 flex flex-col items-start gap-2">
				<Button
					aria-label={
						statusChecking
							? "Checking connection status"
							: `Connect ${input.appName}`
					}
					disabled={input.actionsDisabled || !input.canManage}
					onClick={() => input.onConnect(auth, {})}
					size="sm"
					type="button"
				>
					{statusChecking ? (
						<CircleNotchIcon aria-hidden="true" className="animate-spin" />
					) : (
						<ArrowSquareOutIcon aria-hidden="true" />
					)}
					{connectActionLabel}
				</Button>
				{auth.credentialFallback ? (
					<Button
						className="h-auto px-0 py-0 text-xs"
						disabled={input.actionsDisabled || !input.canManage}
						onClick={() => setUsingCredentialFallback(true)}
						type="button"
						variant="link"
					>
						{auth.credentialFallback.switchLabel}
					</Button>
				) : null}
			</div>
		);
	}
	return (
		<form
			className="mt-4 max-w-xl space-y-3"
			onSubmit={(event: FormEvent<HTMLFormElement>) => {
				event.preventDefault();
				input.onConnect(auth, values);
			}}
		>
			{auth.fields.map((field) => (
				<div className="space-y-1.5" key={field.key}>
					<Label htmlFor={`${input.scope}-${field.key}`}>{field.label}</Label>
					<Input
						autoComplete="off"
						disabled={input.actionsDisabled || !input.canManage}
						id={`${input.scope}-${field.key}`}
						onChange={(event) =>
							setValues((current) => ({
								...current,
								[field.key]: event.target.value,
							}))
						}
						placeholder={field.placeholder}
						required
						type={field.secret ? "password" : "text"}
						value={values[field.key] ?? ""}
					/>
					<p className="text-muted-foreground text-xs leading-5">
						{field.description}
					</p>
				</div>
			))}
			<div className="flex flex-wrap items-center gap-3">
				<Button
					aria-label={
						statusChecking
							? "Checking connection status"
							: `Connect ${input.appName}`
					}
					disabled={input.actionsDisabled || !input.canManage}
					size="sm"
					type="submit"
				>
					{statusChecking ? (
						<CircleNotchIcon aria-hidden="true" className="animate-spin" />
					) : null}
					{connectActionLabel}
				</Button>
				{primaryAuth.kind === "oauth" ? (
					<Button
						className="h-auto px-0 py-0 text-xs"
						disabled={input.actionsDisabled || !input.canManage}
						onClick={() => {
							setValues({});
							setUsingCredentialFallback(false);
						}}
						type="button"
						variant="link"
					>
						Connect through {input.appName} instead
					</Button>
				) : null}
			</div>
		</form>
	);
}

function MemberConnectionsSection(input: {
	actionsDisabled: boolean;
	appName: string;
	connections: ConnectorConnection[];
	disconnectPendingUserId?: string;
	loading: boolean;
	onDisconnect: (userId: string) => void;
	statusAvailable: boolean;
	statusChecking: boolean;
}) {
	return (
		<section aria-label="Member connections" className="px-4 py-4 sm:px-5">
			<h3 className="font-medium text-foreground text-sm">
				Member connections
			</h3>
			<p className="mt-1 max-w-2xl text-muted-foreground text-xs leading-5">
				Connections owned by other Organization members.
			</p>
			{input.loading ? <PluginAccessLoadingSkeleton /> : null}
			{input.statusAvailable &&
			!input.loading &&
			input.connections.length > 0 ? (
				<div className="space-y-2">
					{input.connections.map((connection) => (
						<ConnectionSummary
							appName={input.appName}
							canManage={connection.canDisconnect}
							connection={connection}
							disabled={input.actionsDisabled}
							disconnectPending={
								input.disconnectPendingUserId === connection.userId
							}
							key={connection.connectionName}
							onDisconnect={() => input.onDisconnect(connection.userId)}
							statusChecking={input.statusChecking}
							subtitle={`Personal connection owned by ${connection.ownerDisplayName}.`}
						/>
					))}
				</div>
			) : null}
			{input.statusAvailable &&
			!input.loading &&
			input.connections.length === 0 ? (
				<p className="mt-4 text-muted-foreground text-xs">
					No other member connections.
				</p>
			) : null}
		</section>
	);
}

function PendingDisconnectAction(input: { appName: string }) {
	return (
		<Button
			aria-label={`Disconnecting ${input.appName}`}
			className="mt-4"
			disabled
			size="sm"
			type="button"
			variant="outline"
		>
			<CircleNotchIcon aria-hidden="true" className="animate-spin" />
			Disconnecting…
		</Button>
	);
}

function ConnectionSummary(input: {
	appName: string;
	canManage: boolean;
	connection: ConnectorConnection;
	disabled: boolean;
	disconnectPending: boolean;
	label?: string;
	onDisconnect: () => void;
	statusChecking: boolean;
	subtitle: string;
}) {
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const disconnectActionLabel = resolveDisconnectActionLabel({
		appName: input.appName,
		disconnectPending: input.disconnectPending,
		statusChecking: input.statusChecking,
	});

	return (
		<>
			<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-border/70 bg-background/40 px-3 py-3">
				<div>
					<div className="flex flex-wrap items-center gap-2">
						<p className="font-medium text-foreground text-sm">
							{input.label ?? input.connection.ownerDisplayName}
						</p>
						<Badge
							className={resolveStatusToneProminentBadgeClassName("ready")}
							variant="secondary"
						>
							<CheckIcon
								aria-hidden="true"
								data-icon="inline-start"
								weight="bold"
							/>
							Connected
						</Badge>
					</div>
					<p className="mt-0.5 text-muted-foreground text-xs">
						{input.subtitle}
					</p>
				</div>
				{input.canManage ? (
					<Button
						aria-label={
							input.statusChecking
								? "Checking connection status"
								: `Disconnect ${input.appName}`
						}
						disabled={input.disabled}
						onClick={() => setConfirmingDisconnect(true)}
						size="sm"
						type="button"
						variant="outline"
					>
						{input.statusChecking ? (
							<CircleNotchIcon aria-hidden="true" className="animate-spin" />
						) : (
							<LinkBreakIcon aria-hidden="true" />
						)}
						{input.statusChecking ? "Checking…" : "Disconnect"}
					</Button>
				) : null}
			</div>
			<Dialog
				onOpenChange={(open) => {
					if (!input.disconnectPending) {
						setConfirmingDisconnect(open);
					}
				}}
				open={confirmingDisconnect}
			>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Disconnect {input.appName}?</DialogTitle>
						<DialogDescription>
							This removes this connection from this OpenMeld workspace. It does
							not delete anything in {input.appName}.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={input.disconnectPending}
							onClick={() => setConfirmingDisconnect(false)}
							size="sm"
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							aria-label={
								input.statusChecking
									? "Checking connection status"
									: `Disconnect ${input.appName}`
							}
							disabled={input.disabled}
							onClick={input.onDisconnect}
							size="sm"
							type="button"
							variant="destructive"
						>
							{input.statusChecking ? (
								<CircleNotchIcon aria-hidden="true" className="animate-spin" />
							) : (
								<LinkBreakIcon aria-hidden="true" />
							)}
							{disconnectActionLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function resolveConnectionSummaryPresentation(input: {
	connection: ConnectorConnection;
	section: ConnectionSectionInput;
}): { label?: string; subtitle: string } {
	if (input.section.scope === "member") {
		return {
			subtitle: "Your account. Only you can use this connection.",
		};
	}
	const availability =
		input.section.connectedScopeName === "Organization"
			? "Available to every member and Routine."
			: "Available to your Center Agent and Routines.";
	return {
		label: `${input.section.connectedScopeName} connection`,
		subtitle: `Authorized by ${input.connection.ownerDisplayName}. ${availability}`,
	};
}

function resolveConnectActionLabel(input: {
	appName: string;
	connectPending: boolean;
	oauth: boolean;
	statusChecking: boolean;
}): string {
	if (input.statusChecking) {
		return "Checking…";
	}
	if (input.connectPending) {
		return input.oauth ? "Waiting for authorization…" : "Connecting…";
	}
	return `Connect ${input.appName}`;
}

function resolveDisconnectActionLabel(input: {
	appName: string;
	disconnectPending: boolean;
	statusChecking: boolean;
}): string {
	if (input.statusChecking) {
		return "Checking…";
	}
	if (input.disconnectPending) {
		return "Disconnecting…";
	}
	return `Disconnect ${input.appName}`;
}

function connect(input: {
	auth: PluginConnectionAuth;
	onCredential: (
		auth: PluginCredentialAuth,
		values: Record<string, string>
	) => void;
	onOAuth: () => void;
	values: Record<string, string>;
}) {
	if (input.auth.kind === "oauth") {
		input.onOAuth();
		return;
	}
	input.onCredential(input.auth, input.values);
}

function upsertOptimisticConnection(input: {
	appName: string;
	current: ConnectorConnectionListResponse;
	scope: AuthorizationScope;
	service: ConnectorConnection["service"];
}): ConnectorConnectionListResponse {
	const nowMs = Date.now();
	const connection: ConnectorConnection = {
		canDisconnect: true,
		connectionName: `optimistic_${input.service}_${input.scope}`,
		createdAtMs: nowMs,
		disconnectedAtMs: null,
		organizationId: input.current.organizationId,
		ownerDisplayName:
			input.scope === "shared" ? `${input.appName} team access` : "You",
		scope: input.scope,
		service: input.service,
		status: "active",
		updatedAtMs: nowMs,
		userId: input.current.currentUserId,
	};
	return replaceConnection({
		connection,
		current: input.current,
		scope: input.scope,
		userId: input.current.currentUserId,
	});
}

function replaceConnection(input: {
	connection: ConnectorConnection;
	current: ConnectorConnectionListResponse;
	scope: AuthorizationScope;
	userId: string;
}): ConnectorConnectionListResponse {
	return {
		...input.current,
		connections: [
			...input.current.connections.filter(
				(connection) =>
					!matchesConnection({
						connection,
						scope: input.scope,
						userId: input.userId,
					})
			),
			input.connection,
		],
	};
}

function removeConnection(input: {
	current: ConnectorConnectionListResponse;
	scope: AuthorizationScope;
	userId?: string;
}): ConnectorConnectionListResponse {
	return {
		...input.current,
		connections: input.current.connections.filter(
			(connection) =>
				!matchesConnection({
					connection,
					scope: input.scope,
					userId: input.userId ?? input.current.currentUserId,
				})
		),
	};
}

function matchesConnection(input: {
	connection: ConnectorConnection;
	scope: AuthorizationScope;
	userId: string;
}): boolean {
	return (
		input.connection.scope === input.scope &&
		(input.scope === "shared" || input.connection.userId === input.userId)
	);
}

function startAuthorization(input: {
	appName: string;
	mutation: (scope: AuthorizationScope) => void;
	onBlocked: (message: string) => void;
	popupRef: { current: Window | null };
	scope: AuthorizationScope;
}) {
	const popup = window.open(
		"about:blank",
		`openmeld-${input.scope}-plugin-authorization`,
		"popup,width=720,height=760"
	);
	if (!popup) {
		input.onBlocked(
			`Your browser blocked the ${input.appName} window. Allow pop-ups for OpenMeld and try again.`
		);
		return;
	}
	popup.opener = null;
	input.popupRef.current = popup;
	input.mutation(input.scope);
}
