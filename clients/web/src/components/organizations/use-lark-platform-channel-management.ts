"use client";

import type {
	LarkPlatformProvider,
	LarkPlatformRegistrationResponse,
	MessageChannelConnectionListResponse,
	MessageChannelConnectionProjection,
} from "@openmeld/schemas/types";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
	closeAuthorizationBrowser,
	openAuthorizationBrowser,
	prepareAuthorizationBrowser,
} from "#/desktop/authorization-browser";
import {
	beginCurrentOrganizationLarkPlatformRegistration,
	disconnectCurrentOrganizationLarkPlatform,
	resolveMessageChannelErrorMessage,
} from "#/lib/organizations/message-channels";
import {
	larkPlatformRegistrationQueryOptions,
	messageChannelQueryKeys,
} from "#/query/organizations/message-channels";

async function invalidateMessageChannelReads(
	queryClient: QueryClient,
	organizationId: string
): Promise<void> {
	await Promise.all([
		queryClient.invalidateQueries({
			queryKey: messageChannelQueryKeys.list(organizationId),
		}),
		queryClient.invalidateQueries({
			queryKey: messageChannelQueryKeys.activeRegistrations(organizationId),
		}),
	]);
}

export function useLarkPlatformChannelManagement(input: {
	connections: readonly MessageChannelConnectionProjection[];
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const authorizationOrganizationRef = useRef<string | null>(
		input.organizationId
	);
	const [activeRegistration, setActiveRegistration] =
		useState<LarkPlatformRegistrationResponse | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [selectedProvider, setSelectedProvider] =
		useState<LarkPlatformProvider | null>(null);
	const registrationQuery = useQuery(
		larkPlatformRegistrationQueryOptions({
			attemptId: activeRegistration?.attempt.id ?? null,
			enabled: dialogOpen,
			organizationId: input.organizationId,
			provider: activeRegistration?.attempt.provider ?? null,
		})
	);
	const beginMutation = useMutation({
		mutationFn: async (request: {
			mode: "repair" | "restart" | "resume" | "reauthorize";
			organizationId: string;
			provider: LarkPlatformProvider;
		}) => {
			const { organizationId, ...registrationRequest } = request;
			return await beginCurrentOrganizationLarkPlatformRegistration({
				...registrationRequest,
				organizationId,
			});
		},
		onError: (_error, request) => {
			if (authorizationOrganizationRef.current !== request.organizationId) {
				return;
			}
			if (request.mode === "resume") {
				setActiveRegistration(null);
			}
			setSelectedProvider(request.provider);
			setDialogOpen(true);
			invalidateMessageChannelReads(queryClient, input.organizationId).catch(
				(error: unknown) => {
					console.error(
						"Failed to refresh Message Channels after registration was rejected",
						error
					);
				}
			);
		},
		onSuccess: (registration, request) => {
			if (authorizationOrganizationRef.current !== request.organizationId) {
				return;
			}
			setSelectedProvider(request.provider);
			if (activeRegistration) {
				queryClient.removeQueries({
					queryKey: messageChannelQueryKeys.registration(
						input.organizationId,
						activeRegistration.attempt.provider,
						activeRegistration.attempt.id
					),
				});
			}
			setActiveRegistration(registration);
			queryClient.setQueryData(
				messageChannelQueryKeys.registration(
					input.organizationId,
					request.provider,
					registration.attempt.id
				),
				registration
			);
			setDialogOpen(true);
			queryClient
				.invalidateQueries({
					queryKey: messageChannelQueryKeys.activeRegistrations(
						input.organizationId
					),
				})
				.catch((error: unknown) => {
					console.error(
						"Failed to refresh Message Channels after registration started",
						error
					);
				});
		},
	});
	const disconnectMutation = useMutation<
		MessageChannelConnectionListResponse,
		unknown,
		LarkPlatformProvider,
		{ previousConnections: MessageChannelConnectionListResponse | undefined }
	>({
		mutationFn: async (provider: LarkPlatformProvider) =>
			await disconnectCurrentOrganizationLarkPlatform({
				organizationId: input.organizationId,
				provider,
			}),
		onError: (_error, _provider, context) => {
			queryClient.setQueryData(
				messageChannelQueryKeys.list(input.organizationId),
				context?.previousConnections
			);
		},
		onMutate: async (provider) => {
			const queryKey = messageChannelQueryKeys.list(input.organizationId);
			await queryClient.cancelQueries({ queryKey });
			const previousConnections =
				queryClient.getQueryData<MessageChannelConnectionListResponse>(
					queryKey
				);
			if (previousConnections) {
				queryClient.setQueryData<MessageChannelConnectionListResponse>(
					queryKey,
					{
						...previousConnections,
						connections: previousConnections.connections.filter(
							(connection) => connection.provider !== provider
						),
					}
				);
			}
			return { previousConnections };
		},
		onSuccess: async (response, provider) => {
			queryClient.setQueryData(
				messageChannelQueryKeys.list(input.organizationId),
				response
			);
			await invalidateMessageChannelReads(queryClient, input.organizationId);
			setDialogOpen(false);
			setActiveRegistration(null);
			setSelectedProvider(null);
			toast.success(
				`${provider === "feishu" ? "Feishu" : "Lark"} disconnected.`
			);
		},
	});
	const registration = registrationQuery.data ?? activeRegistration;
	const registrationStatus = registration?.attempt.status ?? null;
	useEffect(() => {
		authorizationOrganizationRef.current = input.organizationId;
		return () => {
			authorizationOrganizationRef.current = null;
		};
	}, [input.organizationId]);
	useEffect(() => {
		if (registrationStatus !== "connected") {
			return;
		}
		invalidateMessageChannelReads(queryClient, input.organizationId).catch(
			(error: unknown) => {
				console.error(
					"Failed to refresh Message Channels after registration",
					error
				);
			}
		);
	}, [input.organizationId, queryClient, registrationStatus]);

	const connection =
		input.connections.find(
			(candidate) => candidate.provider === selectedProvider
		) ?? null;
	const error =
		beginMutation.error ?? registrationQuery.error ?? disconnectMutation.error;

	const manage = (provider: LarkPlatformProvider) => {
		beginMutation.reset();
		disconnectMutation.reset();
		const providerConnection = input.connections.find(
			(candidate) => candidate.provider === provider
		);
		if (shouldOpenConnectionManagement(providerConnection)) {
			setSelectedProvider(provider);
			setActiveRegistration(null);
			setDialogOpen(true);
			return;
		}
		beginMutation.mutate({
			mode: "resume",
			organizationId: input.organizationId,
			provider,
		});
	};
	const openExistingConnection = (provider: LarkPlatformProvider) => {
		const providerConnection = input.connections.find(
			(candidate) =>
				candidate.provider === provider && candidate.status !== "disconnected"
		);
		if (!providerConnection) {
			return;
		}
		beginMutation.reset();
		disconnectMutation.reset();
		setSelectedProvider(provider);
		setActiveRegistration(null);
		setDialogOpen(true);
	};
	const setOpen = (open: boolean) => {
		setDialogOpen(open);
		if (open) {
			return;
		}
		beginMutation.reset();
		disconnectMutation.reset();
		if (activeRegistration) {
			queryClient.removeQueries({
				queryKey: messageChannelQueryKeys.registration(
					input.organizationId,
					activeRegistration.attempt.provider,
					activeRegistration.attempt.id
				),
			});
		}
		setActiveRegistration(null);
		setSelectedProvider(null);
	};

	return {
		cancelSetup: (provider: LarkPlatformProvider) =>
			disconnectMutation.mutate(provider),
		reauthorize: async () => {
			if (!selectedProvider || beginMutation.isPending) {
				return;
			}
			const authorizationWindow = prepareAuthorizationBrowser(
				"openmeld-lark-authorization"
			);
			const authorizationOrganizationId = input.organizationId;
			if (!authorizationWindow) {
				toast.error(
					"Your browser blocked authorization. Allow pop-ups and try again."
				);
				return;
			}
			try {
				const response = await beginMutation.mutateAsync({
					mode: "reauthorize",
					organizationId: authorizationOrganizationId,
					provider: selectedProvider,
				});
				const url = response.attempt.registrationUrl;
				if (!url) {
					throw new Error("Authorization link is unavailable.");
				}
				if (
					authorizationOrganizationRef.current !== authorizationOrganizationId
				) {
					closeAuthorizationBrowser(authorizationWindow);
					return;
				}
				await openAuthorizationBrowser(authorizationWindow, url);
			} catch (error) {
				closeAuthorizationBrowser(authorizationWindow);
				toast.error(
					resolveMessageChannelErrorMessage(
						error,
						"Could not open authorization. Please try again."
					)
				);
			}
		},
		beginPendingProvider:
			(beginMutation.isPending ? beginMutation.variables?.provider : null) ??
			(disconnectMutation.isPending ? disconnectMutation.variables : null),
		connection,
		disconnect: () => {
			if (selectedProvider) {
				disconnectMutation.mutate(selectedProvider);
			}
		},
		disconnectPending: disconnectMutation.isPending,
		errorMessage: error
			? resolveMessageChannelErrorMessage(
					error,
					"OpenMeld could not complete this channel operation."
				)
			: null,
		manage,
		open: dialogOpen,
		openExistingConnection,
		pollPending:
			registrationQuery.isFetching ||
			(beginMutation.isPending &&
				beginMutation.variables?.mode === "reauthorize"),
		provider: selectedProvider,
		repair: () => {
			if (selectedProvider) {
				beginMutation.mutate({
					mode: "repair",
					organizationId: input.organizationId,
					provider: selectedProvider,
				});
			}
		},
		repairPending:
			beginMutation.isPending &&
			(beginMutation.variables?.mode === "repair" ||
				beginMutation.variables?.mode === "reauthorize"),
		registration,
		retryPoll: async () => {
			await registrationQuery.refetch();
		},
		startOver: () => {
			if (selectedProvider) {
				beginMutation.mutate({
					mode: "restart",
					organizationId: input.organizationId,
					provider: selectedProvider,
				});
			}
		},
		startOverPending:
			beginMutation.isPending && beginMutation.variables?.mode === "restart",
		setOpen,
	};
}

function shouldOpenConnectionManagement(
	connection: MessageChannelConnectionProjection | undefined
): boolean {
	return (
		connection !== undefined &&
		connection.status !== "pending_registration" &&
		connection.status !== "credentials_received" &&
		connection.status !== "configuring" &&
		connection.status !== "disconnected"
	);
}
