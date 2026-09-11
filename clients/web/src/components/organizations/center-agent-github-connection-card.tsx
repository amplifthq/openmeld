"use client";

import type {
	ConnectorConnection,
	ConnectorConnectionListResponse,
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
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowSquareOutIcon,
	CheckIcon,
	CircleNotchIcon,
	KeyIcon,
	LinkBreakIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	disconnectOrganizationGitHubConnection,
	disconnectSharedOrganizationGitHubConnection,
	resolveConnectorConnectionErrorMessage,
	startCurrentMemberGitHubAuthorization,
	startCurrentOrganizationSharedGitHubAuthorization,
} from "#/lib/organizations/connector-connections";
import {
	invalidateOrganizationPluginConnections,
	organizationPluginConnectionQueryKeys,
	organizationPluginServiceConnectionsQueryOptions,
} from "#/query/organizations/plugin-connections";
import {
	PluginAccessLoadingSkeleton,
	usePluginConnectionSnapshotCurrent,
} from "./plugin-connection-status-ui";

const AUTHORIZATION_POLL_INTERVAL_MS = 1200;
const MEMBER_AUTHORIZATION_TIMEOUT_MS = 120_000;
const ONBOARDING_GITHUB_UNAVAILABLE_MESSAGE =
	"GitHub is unavailable right now. Finish setup and connect it later in Plugins.";

type AuthorizationScope = "member" | "shared";
type GitHubDisconnectRequest = {
	scope: AuthorizationScope;
	userId?: string;
};
type WaitingAuthorization = {
	expiresAtMs: number | null;
	scope: AuthorizationScope;
};
type GitHubConnectionCardMode = "all" | "member" | "shared";
type GitHubConnectionCardPresentation = "management" | "onboarding";

export function CenterAgentGitHubConnectionCard(input: {
	canManage: boolean;
	isPersonalWorkspace?: boolean;
	mode?: GitHubConnectionCardMode;
	onAuthorizationStateChange?: (busy: boolean) => void;
	organizationId: string;
	presentation?: GitHubConnectionCardPresentation;
}) {
	const mode = input.mode ?? "all";
	const presentation = input.presentation ?? "management";
	const sharedScopeName =
		input.isPersonalWorkspace === true ? "Workspace" : "Organization";
	const queryClient = useQueryClient();
	const [waitingAuthorization, setWaitingAuthorization] =
		useState<WaitingAuthorization | null>(null);
	const waitingScope = waitingAuthorization?.scope ?? null;
	const [localError, setLocalError] = useState<string | null>(null);
	const authorizationPopupRef = useRef<Window | null>(null);
	const connectionsQuery = useQuery(
		organizationPluginServiceConnectionsQueryOptions({
			organizationId: input.organizationId,
			queryClient,
			refetchInterval: waitingScope
				? AUTHORIZATION_POLL_INTERVAL_MS
				: undefined,
			service: "github",
		})
	);
	const serviceConnectionsQueryKey =
		organizationPluginConnectionQueryKeys.service(
			input.organizationId,
			"github"
		);
	const activeConnections =
		connectionsQuery.data?.connections.filter(
			(connection) => connection.status === "active"
		) ?? [];
	const currentUserId = connectionsQuery.data?.currentUserId;
	const currentUserConnection = activeConnections.find(
		(connection) =>
			connection.scope === "member" && connection.userId === currentUserId
	);
	const otherMemberConnections =
		input.canManage && mode === "all"
			? activeConnections.filter(
					(connection) =>
						connection.scope === "member" && connection.userId !== currentUserId
				)
			: [];
	const sharedConnection = activeConnections.find(
		(connection) => connection.scope === "shared"
	);
	const authorizationCompleted =
		(waitingScope === "member" && Boolean(currentUserConnection)) ||
		(waitingScope === "shared" && Boolean(sharedConnection));

	useEffect(() => {
		if (!authorizationCompleted) {
			return;
		}
		const completion = window.setTimeout(() => {
			const popup = authorizationPopupRef.current;
			authorizationPopupRef.current = null;
			setWaitingAuthorization(null);
			setLocalError(null);
			input.onAuthorizationStateChange?.(false);
			popup?.close();
			toast.success(
				waitingScope === "shared"
					? `${sharedScopeName} GitHub access connected.`
					: "Your GitHub account is connected."
			);
		}, 0);
		return () => window.clearTimeout(completion);
	}, [
		authorizationCompleted,
		input.onAuthorizationStateChange,
		sharedScopeName,
		waitingScope,
	]);

	useEffect(() => {
		if (!waitingAuthorization || waitingAuthorization.expiresAtMs === null) {
			return;
		}
		const timeout = window.setTimeout(
			() => {
				const popup = authorizationPopupRef.current;
				authorizationPopupRef.current = null;
				setWaitingAuthorization(null);
				setLocalError(
					"GitHub setup timed out. Start again when you are ready."
				);
				input.onAuthorizationStateChange?.(false);
				popup?.close();
			},
			Math.max(0, waitingAuthorization.expiresAtMs - Date.now())
		);
		return () => window.clearTimeout(timeout);
	}, [input.onAuthorizationStateChange, waitingAuthorization]);

	useEffect(
		() => () => {
			authorizationPopupRef.current?.close();
			authorizationPopupRef.current = null;
			input.onAuthorizationStateChange?.(false);
		},
		[input.onAuthorizationStateChange]
	);

	const authorizationMutation = useMutation({
		mutationFn: async (scope: AuthorizationScope) => {
			if (scope === "shared") {
				return {
					authorization:
						await startCurrentOrganizationSharedGitHubAuthorization({
							organizationId: input.organizationId,
						}),
					scope,
				} as const;
			}
			return {
				authorization: await startCurrentMemberGitHubAuthorization({
					organizationId: input.organizationId,
				}),
				scope,
			} as const;
		},
		onError: (error) => {
			authorizationPopupRef.current?.close();
			authorizationPopupRef.current = null;
			setWaitingAuthorization(null);
			setLocalError(resolveConnectorConnectionErrorMessage(error, "GitHub"));
			input.onAuthorizationStateChange?.(false);
		},
		onMutate: () => {
			setLocalError(null);
		},
		onSuccess: (result) => {
			const popup = authorizationPopupRef.current;
			if (!popup || popup.closed) {
				setLocalError(
					"The GitHub window closed before setup started. Try again."
				);
				input.onAuthorizationStateChange?.(false);
				return;
			}
			popup.location.href = result.authorization.authorizationUrl;
			setWaitingAuthorization({
				expiresAtMs:
					result.scope === "shared"
						? (result.authorization.expiresAtMs ?? null)
						: Date.now() + MEMBER_AUTHORIZATION_TIMEOUT_MS,
				scope: result.scope,
			});
			popup.focus();
		},
	});
	const authorizationBusy =
		authorizationMutation.isPending || Boolean(waitingScope);
	const connectionSnapshotIsCurrent =
		usePluginConnectionSnapshotCurrent(connectionsQuery);
	const connectionActionsDisabled = !connectionSnapshotIsCurrent;
	const authorizationDisabled = authorizationBusy || connectionActionsDisabled;

	const handleConnect = (scope: AuthorizationScope) => {
		setLocalError(null);
		const popup = window.open(
			"about:blank",
			scope === "shared"
				? "openmeld-github-app-installation"
				: "openmeld-github-authorization",
			"popup,width=720,height=760"
		);
		if (!popup) {
			setLocalError(
				"Your browser blocked the GitHub window. Allow pop-ups for OpenMeld and try again."
			);
			return;
		}
		popup.opener = null;
		authorizationPopupRef.current = popup;
		input.onAuthorizationStateChange?.(true);
		authorizationMutation.mutate(scope);
	};
	const cancelAuthorization = () => {
		authorizationPopupRef.current?.close();
		authorizationPopupRef.current = null;
		setWaitingAuthorization(null);
		setLocalError(null);
		input.onAuthorizationStateChange?.(false);
	};
	const disconnectMutation = useMutation<
		unknown,
		unknown,
		GitHubDisconnectRequest,
		{ previousConnections: ConnectorConnectionListResponse | undefined }
	>({
		mutationFn: async (request: GitHubDisconnectRequest) => {
			if (request.scope === "shared") {
				return await disconnectSharedOrganizationGitHubConnection({
					organizationId: input.organizationId,
				});
			}
			if (!request.userId) {
				throw new Error("The GitHub connection owner is missing.");
			}
			return await disconnectOrganizationGitHubConnection({
				organizationId: input.organizationId,
				userId: request.userId,
			});
		},
		onError: (error, _request, context) => {
			queryClient.setQueryData(
				serviceConnectionsQueryKey,
				context?.previousConnections
			);
			setLocalError(resolveConnectorConnectionErrorMessage(error, "GitHub"));
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
					removeGitHubConnection({
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
				service: "github",
			});
		},
		onSuccess: (_response, request) => {
			toast.success(
				request.scope === "shared"
					? `${sharedScopeName} GitHub access disconnected.`
					: "GitHub disconnected."
			);
		},
	});
	const errorState = resolveGitHubConnectionCardError({
		connectionError: connectionsQuery.error,
		localError,
		presentation,
	});
	const statusAvailable = Boolean(connectionsQuery.data);
	const statusChecking =
		!connectionsQuery.isPending &&
		(connectionsQuery.isFetching || connectionsQuery.isPaused);
	const disconnectPendingRequest = disconnectMutation.isPending
		? (disconnectMutation.variables ?? null)
		: null;

	return (
		<GitHubConnectionCardContent
			authorizationDisabled={
				authorizationDisabled || disconnectPendingRequest !== null
			}
			canManage={input.canManage}
			currentUserConnection={currentUserConnection}
			currentUserId={connectionsQuery.data?.currentUserId}
			disconnectDisabled={
				disconnectMutation.isPending || connectionActionsDisabled
			}
			disconnectPendingRequest={disconnectPendingRequest}
			errorState={errorState}
			isConnectionError={connectionsQuery.isError}
			isPersonalWorkspace={input.isPersonalWorkspace === true}
			loading={connectionsQuery.isPending}
			mode={mode}
			onCancelAuthorization={cancelAuthorization}
			onConnect={handleConnect}
			onDisconnect={(request) => disconnectMutation.mutate(request)}
			onRetry={() => connectionsQuery.refetch()}
			otherMemberConnections={otherMemberConnections}
			presentation={presentation}
			sharedConnection={sharedConnection}
			statusAvailable={statusAvailable}
			statusChecking={statusChecking}
			waitingScope={waitingScope}
		/>
	);
}

type GitHubConnectionCardErrorState = {
	isOnboardingUnavailable: boolean;
	message: string;
} | null;

function GitHubConnectionCardContent(input: {
	authorizationDisabled: boolean;
	canManage: boolean;
	currentUserId?: string;
	currentUserConnection?: ConnectorConnection;
	disconnectDisabled: boolean;
	disconnectPendingRequest: GitHubDisconnectRequest | null;
	errorState: GitHubConnectionCardErrorState;
	isConnectionError: boolean;
	isPersonalWorkspace: boolean;
	loading: boolean;
	mode: GitHubConnectionCardMode;
	onCancelAuthorization: () => void;
	onConnect: (scope: AuthorizationScope) => void;
	onDisconnect: (request: GitHubDisconnectRequest) => void;
	onRetry: () => void;
	otherMemberConnections: ConnectorConnection[];
	presentation: GitHubConnectionCardPresentation;
	sharedConnection?: ConnectorConnection;
	statusAvailable: boolean;
	statusChecking: boolean;
	waitingScope: AuthorizationScope | null;
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
			aria-label="GitHub connection status"
			className={cn(
				"divide-y divide-border/70",
				input.loading && "pointer-events-none opacity-60"
			)}
		>
			{input.mode === "shared" ? null : (
				<YourGitHubSection
					authorizationDisabled={input.authorizationDisabled}
					connection={input.currentUserConnection}
					disconnectDisabled={input.disconnectDisabled}
					disconnectPending={disconnectingCurrentUser}
					loading={input.loading}
					onCancelAuthorization={input.onCancelAuthorization}
					onConnect={() => input.onConnect("member")}
					onDisconnect={(userId) =>
						input.onDisconnect({ scope: "member", userId })
					}
					presentation={input.presentation}
					scopeName={input.isPersonalWorkspace ? "workspace" : "Organization"}
					statusAvailable={input.statusAvailable}
					statusChecking={input.statusChecking}
					waiting={input.waitingScope === "member"}
				/>
			)}

			{input.presentation === "management" &&
			input.canManage &&
			!input.isPersonalWorkspace &&
			input.mode === "all" ? (
				<MemberGitHubConnectionsSection
					connections={input.otherMemberConnections}
					disconnectDisabled={input.disconnectDisabled}
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

			{input.mode === "shared" || input.mode === "all" ? (
				<SharedGitHubSection
					authorizationDisabled={input.authorizationDisabled}
					canManage={input.canManage}
					connection={input.sharedConnection}
					disconnectDisabled={input.disconnectDisabled}
					disconnectPending={disconnectingShared}
					loading={input.loading}
					onCancelAuthorization={input.onCancelAuthorization}
					onConnect={() => input.onConnect("shared")}
					onDisconnect={() => input.onDisconnect({ scope: "shared" })}
					presentation={input.presentation}
					scopeName={input.isPersonalWorkspace ? "Workspace" : "Organization"}
					statusAvailable={input.statusAvailable}
					statusChecking={input.statusChecking}
					waiting={input.waitingScope === "shared"}
				/>
			) : null}

			<GitHubConnectionError
				errorState={input.errorState}
				isConnectionError={input.isConnectionError}
				onRetry={input.onRetry}
			/>
		</section>
	);
}

function GitHubConnectionError(input: {
	errorState: GitHubConnectionCardErrorState;
	isConnectionError: boolean;
	onRetry: () => void;
}) {
	if (!input.errorState) {
		return null;
	}
	return (
		<div
			className={
				input.errorState.isOnboardingUnavailable
					? "px-5 py-3 text-muted-foreground text-xs leading-5"
					: "flex flex-wrap items-center justify-between gap-2 px-5 py-3"
			}
			role={input.errorState.isOnboardingUnavailable ? "status" : "alert"}
		>
			<p
				className={
					input.errorState.isOnboardingUnavailable
						? undefined
						: "text-destructive text-sm"
				}
			>
				{input.errorState.message}
			</p>
			{input.isConnectionError && !input.errorState.isOnboardingUnavailable ? (
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
	);
}

function resolveGitHubConnectionCardError(input: {
	connectionError: unknown;
	localError: string | null;
	presentation: GitHubConnectionCardPresentation;
}): GitHubConnectionCardErrorState {
	if (input.localError) {
		return {
			isOnboardingUnavailable: false,
			message: input.localError,
		};
	}
	if (!input.connectionError) {
		return null;
	}
	if (input.presentation === "onboarding") {
		return {
			isOnboardingUnavailable: true,
			message: ONBOARDING_GITHUB_UNAVAILABLE_MESSAGE,
		};
	}
	return {
		isOnboardingUnavailable: false,
		message: resolveConnectorConnectionErrorMessage(
			input.connectionError,
			"GitHub"
		),
	};
}

function YourGitHubSection(input: {
	authorizationDisabled: boolean;
	connection?: ConnectorConnection;
	disconnectDisabled: boolean;
	disconnectPending: boolean;
	loading: boolean;
	onCancelAuthorization: () => void;
	onConnect: () => void;
	onDisconnect: (userId: string) => void;
	presentation: GitHubConnectionCardPresentation;
	scopeName: "Organization" | "workspace";
	statusAvailable: boolean;
	statusChecking: boolean;
	waiting: boolean;
}) {
	const connection = input.connection;
	const isOnboarding = input.presentation === "onboarding";
	const canShowAuthorizationAction = input.statusAvailable || isOnboarding;
	return (
		<GitHubConnectionSection
			action={
				connection ||
				input.disconnectPending ||
				input.loading ||
				!canShowAuthorizationAction ? null : (
					<GitHubAuthorizationAction
						checking={input.statusChecking}
						connectLabel={isOnboarding ? "Connect my GitHub" : "Connect GitHub"}
						disabled={input.authorizationDisabled}
						onCancel={input.onCancelAuthorization}
						onConnect={input.onConnect}
						waiting={input.waiting}
						waitingLabel="Waiting for GitHub..."
					/>
				)
			}
			description={
				isOnboarding
					? "Connect your GitHub identity for tasks that should run as you."
					: "The Center Agent uses your GitHub only when your task explicitly needs your identity or personal repositories."
			}
			title="Your GitHub"
		>
			{input.loading ? <PluginAccessLoadingSkeleton /> : null}
			{input.disconnectPending && !connection ? (
				<GitHubPendingDisconnect />
			) : null}
			{input.statusAvailable && !input.loading && connection ? (
				<>
					<GitHubConnectionRow
						connection={connection}
						disabled={input.disconnectDisabled}
						disconnectPending={input.disconnectPending}
						onDisconnect={() => input.onDisconnect(connection.userId)}
						statusChecking={input.statusChecking}
						subtitle="Your GitHub identity. Only you can use this connection."
					/>
					<GitHubOrganizationAccessNotice />
				</>
			) : null}
			{input.statusAvailable &&
			!input.disconnectPending &&
			!input.loading &&
			!connection ? (
				<p className="text-muted-foreground text-xs">
					You have not connected GitHub in this {input.scopeName}.
				</p>
			) : null}
		</GitHubConnectionSection>
	);
}

function MemberGitHubConnectionsSection(input: {
	connections: ConnectorConnection[];
	disconnectDisabled: boolean;
	disconnectPendingUserId?: string;
	loading: boolean;
	onDisconnect: (userId: string) => void;
	statusAvailable: boolean;
	statusChecking: boolean;
}) {
	return (
		<GitHubConnectionSection
			action={null}
			description="Connections owned by other Organization members."
			title="Member connections"
		>
			{input.loading ? <PluginAccessLoadingSkeleton /> : null}
			{input.statusAvailable &&
			!input.loading &&
			input.connections.length > 0 ? (
				<div className="space-y-2">
					{input.connections.map((connection) => (
						<GitHubConnectionRow
							connection={connection}
							disabled={input.disconnectDisabled}
							disconnectPending={
								input.disconnectPendingUserId === connection.userId
							}
							key={connection.connectionName}
							onDisconnect={() => input.onDisconnect(connection.userId)}
							statusChecking={input.statusChecking}
							subtitle={`Personal GitHub connection owned by ${connection.ownerDisplayName}.`}
						/>
					))}
				</div>
			) : null}
			{input.statusAvailable &&
			!input.loading &&
			input.connections.length === 0 ? (
				<p className="text-muted-foreground text-xs">
					No other member connections.
				</p>
			) : null}
		</GitHubConnectionSection>
	);
}

function SharedGitHubSection(input: {
	authorizationDisabled: boolean;
	canManage: boolean;
	connection?: ConnectorConnection;
	disconnectDisabled: boolean;
	disconnectPending: boolean;
	loading: boolean;
	onCancelAuthorization: () => void;
	onConnect: () => void;
	onDisconnect: () => void;
	presentation: GitHubConnectionCardPresentation;
	scopeName: "Organization" | "Workspace";
	statusAvailable: boolean;
	statusChecking: boolean;
	waiting: boolean;
}) {
	const connection = input.connection;
	const isOnboarding = input.presentation === "onboarding";
	const canShowAuthorizationAction = input.statusAvailable || isOnboarding;
	let description =
		"Install the OpenMeld GitHub Plugin and choose the repositories the Center Agent can use. Organization work and Routines run as the OpenMeld bot.";
	if (isOnboarding) {
		description =
			"Install the OpenMeld GitHub Plugin and choose the repositories the Center Agent can use.";
	} else if (input.scopeName === "Workspace") {
		description =
			"Install the OpenMeld GitHub Plugin and choose the repositories the Center Agent can use. Workspace Routines run as the OpenMeld bot.";
	}
	return (
		<GitHubConnectionSection
			action={
				connection ||
				input.disconnectPending ||
				!input.canManage ||
				input.loading ||
				!canShowAuthorizationAction ? null : (
					<GitHubAuthorizationAction
						checking={input.statusChecking}
						connectLabel="Install GitHub Plugin"
						disabled={input.authorizationDisabled}
						onCancel={input.onCancelAuthorization}
						onConnect={input.onConnect}
						waiting={input.waiting}
						waitingLabel="Waiting for GitHub..."
					/>
				)
			}
			description={description}
			title={`${input.scopeName} GitHub Plugin`}
		>
			{input.loading ? <PluginAccessLoadingSkeleton /> : null}
			{input.disconnectPending && !connection ? (
				<GitHubPendingDisconnect />
			) : null}
			{input.statusAvailable && !input.loading && connection ? (
				<>
					<GitHubConnectionRow
						allowDisconnect={input.canManage}
						connection={connection}
						disabled={input.disconnectDisabled}
						disconnectPending={input.disconnectPending}
						label="OpenMeld GitHub Plugin"
						onDisconnect={input.onDisconnect}
						statusChecking={input.statusChecking}
						subtitle={`Installed by ${connection.ownerDisplayName}. ${
							input.scopeName === "Organization"
								? "Organization work runs as the OpenMeld bot."
								: "Workspace work runs as the OpenMeld bot."
						}`}
					/>
					<GitHubOrganizationAccessNotice />
				</>
			) : null}
			{input.statusAvailable &&
			!input.disconnectPending &&
			!input.loading &&
			!connection ? (
				<p className="text-muted-foreground text-xs">
					No {input.scopeName} access is connected yet.
				</p>
			) : null}
		</GitHubConnectionSection>
	);
}

function GitHubPendingDisconnect() {
	return (
		<Button
			aria-label="Disconnecting GitHub"
			disabled
			size="sm"
			type="button"
			variant="outline"
		>
			<CircleNotchIcon
				aria-hidden="true"
				className="animate-spin"
				data-icon="inline-start"
			/>
			Disconnecting…
		</Button>
	);
}

function GitHubAuthorizationAction(input: {
	checking: boolean;
	connectLabel: string;
	disabled: boolean;
	onCancel: () => void;
	onConnect: () => void;
	waiting: boolean;
	waitingLabel: string;
}) {
	if (input.waiting) {
		return (
			<div className="flex shrink-0 items-center gap-2">
				<Button disabled size="sm" type="button" variant="outline">
					{input.waitingLabel}
				</Button>
				<Button
					onClick={input.onCancel}
					size="sm"
					type="button"
					variant="ghost"
				>
					Cancel
				</Button>
			</div>
		);
	}
	return (
		<Button
			aria-label={
				input.checking ? "Checking connection status" : input.connectLabel
			}
			disabled={input.disabled}
			onClick={input.onConnect}
			size="sm"
			type="button"
			variant="outline"
		>
			{input.checking ? (
				<CircleNotchIcon
					aria-hidden="true"
					className="animate-spin"
					data-icon="inline-start"
				/>
			) : (
				<KeyIcon aria-hidden="true" data-icon="inline-start" />
			)}
			{input.checking ? "Checking…" : input.connectLabel}
		</Button>
	);
}

function GitHubConnectionSection(input: {
	action: ReactNode;
	children: ReactNode;
	description: string;
	title: string;
}) {
	return (
		<section aria-label={input.title} className="px-5 py-4">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0">
					<h3 className="font-medium text-foreground text-sm">{input.title}</h3>
					<p className="mt-1 max-w-2xl text-muted-foreground text-xs leading-5">
						{input.description}
					</p>
				</div>
				{input.action}
			</div>
			<div className="mt-3">{input.children}</div>
		</section>
	);
}

function GitHubConnectionRow(input: {
	allowDisconnect?: boolean;
	connection: ConnectorConnection;
	disabled: boolean;
	disconnectPending: boolean;
	label?: string;
	onDisconnect: () => void;
	statusChecking: boolean;
	subtitle: string;
}) {
	const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
	const disconnectActionLabel = resolveGitHubDisconnectActionLabel({
		disconnectPending: input.disconnectPending,
		statusChecking: input.statusChecking,
	});

	return (
		<>
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<span className="text-foreground">
					{input.label ?? input.connection.ownerDisplayName}
				</span>
				<Badge className={resolveStatusToneProminentBadgeClassName("ready")}>
					<CheckIcon
						aria-hidden="true"
						data-icon="inline-start"
						weight="bold"
					/>
					Connected
				</Badge>
				{input.connection.canDisconnect && input.allowDisconnect !== false ? (
					<Button
						aria-label={
							input.statusChecking
								? "Checking connection status"
								: "Disconnect GitHub"
						}
						disabled={input.disabled}
						onClick={() => setConfirmingDisconnect(true)}
						size="xs"
						type="button"
						variant="ghost"
					>
						{input.statusChecking ? (
							<CircleNotchIcon
								aria-hidden="true"
								className="animate-spin"
								data-icon="inline-start"
							/>
						) : (
							<LinkBreakIcon aria-hidden="true" data-icon="inline-start" />
						)}
						{input.statusChecking ? "Checking…" : "Disconnect"}
					</Button>
				) : null}
			</div>
			<p className="mt-1 text-muted-foreground text-xs">{input.subtitle}</p>
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
						<DialogTitle>Disconnect GitHub?</DialogTitle>
						<DialogDescription>
							This removes the connection from this OpenMeld workspace. It does
							not sign you out of GitHub or uninstall the OpenMeld GitHub
							Plugin.
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
									: "Disconnect GitHub"
							}
							disabled={input.disabled}
							onClick={input.onDisconnect}
							size="sm"
							type="button"
							variant="destructive"
						>
							{input.statusChecking ? (
								<CircleNotchIcon
									aria-hidden="true"
									className="animate-spin"
									data-icon="inline-start"
								/>
							) : (
								<LinkBreakIcon aria-hidden="true" data-icon="inline-start" />
							)}
							{disconnectActionLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function resolveGitHubDisconnectActionLabel(input: {
	disconnectPending: boolean;
	statusChecking: boolean;
}): string {
	if (input.statusChecking) {
		return "Checking…";
	}
	if (input.disconnectPending) {
		return "Disconnecting…";
	}
	return "Disconnect GitHub";
}

function GitHubOrganizationAccessNotice() {
	return (
		<div className="mt-3 max-w-2xl text-muted-foreground text-xs leading-5">
			<p>
				OpenMeld can use only repositories included in an OpenMeld GitHub Plugin
				installation and allowed for this GitHub identity.
			</p>
			<a
				className="mt-1 inline-flex items-center gap-1 font-medium text-foreground hover:underline"
				href="https://github.com/settings/installations"
				rel="noreferrer"
				target="_blank"
			>
				Review GitHub Plugin installations
				<ArrowSquareOutIcon aria-hidden="true" className="size-3" />
			</a>
		</div>
	);
}

function removeGitHubConnection(input: {
	current: ConnectorConnectionListResponse;
	scope: AuthorizationScope;
	userId?: string;
}): ConnectorConnectionListResponse {
	return {
		...input.current,
		connections: input.current.connections.filter((connection) => {
			if (connection.scope !== input.scope) {
				return true;
			}
			if (input.scope === "shared") {
				return false;
			}
			return connection.userId !== input.userId;
		}),
	};
}
