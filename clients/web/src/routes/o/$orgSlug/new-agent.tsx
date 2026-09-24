import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { z } from "zod/v4";
import { AgentCreationProgress } from "#/components/agents/agent-creation-progress";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { NewAgentCreationForm } from "#/components/profiles/new-agent-creation-form";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentCreationRequestsPath,
	buildOrganizationAgentsPath,
	buildOrganizationDirectMessagePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import {
	clearAgentCreationIntent,
	readAgentCreationIntent,
} from "#/lib/profiles/agent-creation-intent";
import {
	continuePendingAgentProfileCreationLocalSetup,
	readPendingAgentProfileCreationLocalSetup,
	rememberPendingAgentProfileCreationLocalSetup,
} from "#/lib/profiles/agent-profile-creation-local-setup";
import {
	type OptimisticAgentProfileCreation,
	readAgentProfileCreationRequest,
} from "#/lib/profiles/agent-profile-creation-requests";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";
import { openCurrentDirectMessageSpace } from "#/lib/spaces/direct-message";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	agentProfileCreationRequestQueryKeys,
	agentProfileCreationRequestQueryOptions,
	upsertAcceptedAgentProfileCreationRequest,
} from "#/query/profiles/agent-profile-creation-requests";
import { startQueryKeys } from "#/query/query-keys";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";

export const Route = createFileRoute("/o/$orgSlug/new-agent")({
	staticData: appShellStaticData.newAgent,
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("agents"),
	}),
	validateSearch: z.object({ requestId: z.string().optional() }),
	component: NewAgentRoute,
});

function NewAgentRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { requestId } = Route.useSearch();
	const context = useAppOrganization();
	const navigate = useNavigate();
	const journey = useNewAgentCreationJourney({
		context,
		navigate,
		urlRequestId: requestId,
	});
	let primaryContent: ReactNode = null;
	if (journey.hasCreation) {
		primaryContent = (
			<AgentCreationProgress
				creation={journey.currentRequest ?? journey.optimistic}
				error={journey.openingError}
				isOpening={journey.opening}
				needsSetupReview={journey.needsSetupReview}
				onRetryOpen={journey.retryOpen}
				onRetryRead={journey.retryRead}
				onReview={journey.reviewSetup}
				readFailed={journey.requestReadFailed}
			/>
		);
	} else if (journey.recoveringIntent) {
		primaryContent = (
			<AgentCreationProgress
				creation={{
					profileName: journey.unacknowledgedIntentName,
					status: "creating",
				}}
				isOpening={false}
				onRetryOpen={() => undefined}
				onRetryRead={journey.retryIntentRead}
				onReview={journey.reviewSetup}
				readFailed={false}
			/>
		);
	} else if (journey.intentReadFailed) {
		primaryContent = (
			<div className="mx-auto grid w-full max-w-xl gap-3 px-6 py-12">
				<h1 className="font-semibold text-xl">
					Check your previous Agent request
				</h1>
				<p className="text-muted-foreground text-sm">
					The request may have reached OpenMeld. Check its status before
					submitting again.
				</p>
				<Button onClick={journey.retryIntentRead}>Check request</Button>
			</div>
		);
	}
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={sidebarStates.outer}
			scroll={false}
		>
			{primaryContent}
			{journey.keepFormMounted && (
				<div className={journey.hasCreation ? "hidden" : "contents"}>
					<NewAgentCreationForm
						accountName={context.account.name ?? null}
						currentUserId={context.currentUserId}
						intentStorageScope={context.storageScope}
						isPersonalOrganization={
							context.currentOrganization.isPersonal === true
						}
						onAccepted={journey.showRequest}
						onCancel={() =>
							navigate({
								to: buildOrganizationAgentsPath(
									context.currentOrganization.slug
								),
							}).catch(console.error)
						}
						onFailed={journey.clearOptimistic}
						onStarted={journey.startCreation}
						organizationId={context.currentOrganization.id}
						orgSlug={context.currentOrganization.slug}
					/>
				</div>
			)}
		</AppFullWidthLayout>
	);
}

type OrganizationContext = ReturnType<typeof useAppOrganization>;
type Navigate = ReturnType<typeof useNavigate>;

function useNewAgentCreationJourney(input: {
	context: OrganizationContext;
	navigate: Navigate;
	urlRequestId: string | undefined;
}) {
	const { currentOrganization, currentUserId, storageScope } = input.context;
	const queryClient = useQueryClient();
	const [optimistic, setOptimistic] =
		useState<OptimisticAgentProfileCreation | null>(null);
	const [submittedHere, setSubmittedHere] = useState(false);
	const [accepted, setAccepted] = useState<AgentProfileCreationRequest | null>(
		null
	);
	const [blockingLocalSetupIssue, setBlockingLocalSetupIssue] = useState<
		string | null
	>(null);
	const [unacknowledgedIntent] = useState(() =>
		readAgentCreationIntent(storageScope, currentOrganization.id)
	);
	const mountedRef = useRef(false);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);
	const recoveredRequestRef = useRef<string | null>(null);
	const activeRequestId = input.urlRequestId ?? accepted?.id ?? "";
	const hasCreation = Boolean(activeRequestId || optimistic);
	const requestQuery = useQuery(
		agentProfileCreationRequestQueryOptions({
			enabled: Boolean(activeRequestId),
			organizationId: currentOrganization.id,
			requestId: activeRequestId,
		})
	);
	const intentQuery = useQuery({
		enabled: Boolean(unacknowledgedIntent && !hasCreation),
		queryFn: async () =>
			await readAgentProfileCreationRequest({
				idempotencyKey: unacknowledgedIntent?.idempotencyKey,
				organizationId: currentOrganization.id,
			}),
		queryKey: agentProfileCreationRequestQueryKeys.byIntent(
			currentOrganization.id,
			unacknowledgedIntent?.idempotencyKey ?? ""
		),
		retry: 1,
		staleTime: 0,
	});
	const showRequest = useCallback(
		(
			request: AgentProfileCreationRequest,
			customWorkingFolderIssue?: string | null
		) => {
			if (request.organizationId !== currentOrganization.id) {
				console.error(
					"Agent creation response belongs to another organization."
				);
				return;
			}
			queryClient.setQueryData(
				agentProfileCreationRequestQueryKeys.request(
					currentOrganization.id,
					request.id
				),
				request
			);
			if (
				!(
					mountedRef.current &&
					isCurrentCreationRoute(currentOrganization.slug, request.id)
				)
			) {
				// The accepted request remains recoverable without interrupting a
				// later navigation choice.
				return;
			}
			const pendingLocalSetup = readPendingAgentProfileCreationLocalSetup({
				organizationId: currentOrganization.id,
				requestId: request.id,
				storageScope,
			});
			setBlockingLocalSetupIssue(
				customWorkingFolderIssue && !pendingLocalSetup
					? customWorkingFolderIssue
					: null
			);
			const submittedIntent = readAgentCreationIntent(
				storageScope,
				currentOrganization.id
			);
			if (submittedIntent) {
				clearAgentCreationIntent({
					idempotencyKey: submittedIntent.idempotencyKey,
					organizationId: currentOrganization.id,
					scope: storageScope,
				});
			}
			setAccepted(request);
			setOptimistic(null);
			input
				.navigate({
					to: buildOrganizationAgentCreationPath(currentOrganization.slug),
					search: { requestId: request.id },
					replace: true,
				})
				.catch((error: unknown) => {
					console.error(
						"Could not preserve Agent setup progress in the URL.",
						error
					);
				});
		},
		[
			currentOrganization.id,
			currentOrganization.slug,
			input.navigate,
			queryClient,
			storageScope,
		]
	);
	useEffect(() => {
		if (
			intentQuery.data &&
			recoveredRequestRef.current !== intentQuery.data.id
		) {
			recoveredRequestRef.current = intentQuery.data.id;
			let localSetupIssue: string | null = null;
			if (unacknowledgedIntent?.customWorkspacePath) {
				const remembered = rememberPendingAgentProfileCreationLocalSetup({
					agentProfileId: intentQuery.data.createdAgentProfileId,
					organizationId: currentOrganization.id,
					requestId: intentQuery.data.id,
					storageScope,
					workspacePath: unacknowledgedIntent.customWorkspacePath,
				});
				if (!remembered) {
					localSetupIssue =
						"OpenMeld couldn't keep your custom working folder for retry. Open creation history to review setup.";
				}
			}
			showRequest(intentQuery.data, localSetupIssue);
		}
	}, [
		currentOrganization.id,
		intentQuery.data,
		showRequest,
		storageScope,
		unacknowledgedIntent,
	]);
	const currentRequest = requestQuery.data ?? accepted;
	useReconcileCreatedAgent({
		currentRequest,
		organizationId: currentOrganization.id,
		queryClient,
		storageScope,
	});
	const destination = useOpenCreatedAgent({
		blockingLocalSetupIssue,
		currentRequest,
		currentUserId,
		navigate: input.navigate,
		organizationId: currentOrganization.id,
		orgSlug: currentOrganization.slug,
		queryClient,
		storageScope,
	});
	const reviewSetup = () => {
		input
			.navigate({
				to: buildOrganizationAgentCreationRequestsPath({
					orgSlug: currentOrganization.slug,
					requestId: currentRequest?.id,
				}),
			})
			.catch(console.error);
	};
	return {
		...destination,
		needsSetupReview:
			destination.needsSetupReview || Boolean(blockingLocalSetupIssue),
		openingError: blockingLocalSetupIssue ?? destination.openingError,
		clearOptimistic: () => setOptimistic(null),
		currentRequest,
		hasCreation,
		intentReadFailed: Boolean(
			unacknowledgedIntent && intentQuery.isError && !hasCreation
		),
		keepFormMounted:
			(submittedHere || !input.urlRequestId) &&
			(!unacknowledgedIntent || intentQuery.data === null || submittedHere),
		optimistic,
		recoveringIntent: Boolean(
			unacknowledgedIntent && intentQuery.isPending && !hasCreation
		),
		requestReadFailed:
			requestQuery.isError || (requestQuery.data === null && !accepted),
		retryIntentRead: () => intentQuery.refetch().catch(console.error),
		retryRead: () => requestQuery.refetch().catch(console.error),
		reviewSetup,
		startCreation: (creation: OptimisticAgentProfileCreation) => {
			setSubmittedHere(true);
			setOptimistic(creation);
		},
		showRequest,
		unacknowledgedIntentName: unacknowledgedIntent?.profileName ?? "Agent",
	};
}

function useReconcileCreatedAgent(input: {
	currentRequest: AgentProfileCreationRequest | null;
	organizationId: string;
	queryClient: ReturnType<typeof useQueryClient>;
	storageScope: string;
}) {
	const reconciledRef = useRef("");
	useEffect(() => {
		const request = input.currentRequest;
		if (!request) {
			return;
		}
		const version = `${request.id}:${request.status}:${request.createdAgentProfileId}`;
		if (reconciledRef.current === version) {
			return;
		}
		reconciledRef.current = version;
		upsertAcceptedAgentProfileCreationRequest({
			organizationId: input.organizationId,
			queryClient: input.queryClient,
			request,
		});
		if (!request.createdAgentProfileId) {
			return;
		}
		for (const queryKey of [
			startQueryKeys.profilesForStorageScope(input.storageScope),
			organizationQueryKeys.profileDirectory(input.organizationId),
			organizationQueryKeys.agentRuntimeOverview(input.organizationId),
		]) {
			input.queryClient
				.invalidateQueries({ queryKey, refetchType: "none" })
				.catch(console.error);
		}
	}, [
		input.currentRequest,
		input.organizationId,
		input.queryClient,
		input.storageScope,
	]);
}

function useOpenCreatedAgent(input: {
	blockingLocalSetupIssue: string | null;
	currentRequest: AgentProfileCreationRequest | null;
	currentUserId: string;
	navigate: Navigate;
	organizationId: string;
	orgSlug: string;
	queryClient: ReturnType<typeof useQueryClient>;
	storageScope: string;
}) {
	const [opening, setOpening] = useState(false);
	const [openingError, setOpeningError] = useState<string | null>(null);
	const [needsSetupReview, setNeedsSetupReview] = useState(false);
	const openingRequestRef = useRef<string | null>(null);
	const openDestination = useCallback(
		async (request: AgentProfileCreationRequest) => {
			if (
				input.blockingLocalSetupIssue ||
				request.status !== "completed" ||
				!request.createdAgentProfileId ||
				request.requesterUserId !== input.currentUserId ||
				request.targetOwnerUserId !== input.currentUserId ||
				openingRequestRef.current === request.id
			) {
				return;
			}
			openingRequestRef.current = request.id;
			setOpening(true);
			setOpeningError(null);
			setNeedsSetupReview(false);
			try {
				const localSetupIssue = await finishPendingLocalSetup({
					organizationId: input.organizationId,
					request,
					storageScope: input.storageScope,
				});
				if (localSetupIssue) {
					setNeedsSetupReview(true);
					throw new Error(localSetupIssue);
				}
				if (!isCurrentCreationRoute(input.orgSlug, request.id)) {
					return;
				}
				if (request.requestedSpaceId) {
					await input.navigate({
						to: buildOrganizationSpacePath({
							orgSlug: input.orgSlug,
							spaceId: request.requestedSpaceId,
						}),
					});
					return;
				}
				const dm = await openCurrentDirectMessageSpace({
					organizationId: input.organizationId,
					targetProfileId: request.createdAgentProfileId,
				});
				await input.queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
					refetchType: "none",
				});
				if (!isCurrentCreationRoute(input.orgSlug, request.id)) {
					return;
				}
				await input.navigate({
					to: buildOrganizationDirectMessagePath({
						orgSlug: input.orgSlug,
						search: { profileId: dm.memberProfileId },
						spaceId: dm.spaceId,
					}),
				});
			} catch (error) {
				openingRequestRef.current = null;
				setOpeningError(
					error instanceof Error
						? error.message
						: "Couldn’t open the Agent conversation. Try again."
				);
			} finally {
				setOpening(false);
			}
		},
		[
			input.blockingLocalSetupIssue,
			input.currentUserId,
			input.navigate,
			input.organizationId,
			input.orgSlug,
			input.queryClient,
			input.storageScope,
		]
	);
	useEffect(() => {
		if (input.currentRequest?.status === "completed") {
			openDestination(input.currentRequest).catch(console.error);
		}
	}, [input.currentRequest, openDestination]);
	return {
		opening,
		openingError,
		needsSetupReview,
		retryOpen: () => {
			if (input.currentRequest) {
				openDestination(input.currentRequest).catch(console.error);
			}
		},
	};
}

async function finishPendingLocalSetup(input: {
	organizationId: string;
	request: AgentProfileCreationRequest;
	storageScope: string;
}): Promise<string | null> {
	const pendingSetup = readPendingAgentProfileCreationLocalSetup({
		organizationId: input.organizationId,
		requestId: input.request.id,
		storageScope: input.storageScope,
	});
	if (!pendingSetup) {
		return null;
	}
	const result = await continuePendingAgentProfileCreationLocalSetup({
		organizationId: input.organizationId,
		pendingSetup,
		request: input.request,
		selectedHumanProfileId: input.request.actorProfileId,
		storageScope: input.storageScope,
	});
	return result.pending
		? (result.failureMessage ?? "Local setup is still incomplete.")
		: null;
}

function isCurrentCreationRoute(orgSlug: string, requestId: string): boolean {
	if (
		window.location.pathname !== buildOrganizationAgentCreationPath(orgSlug)
	) {
		return false;
	}
	const visibleRequestId = new URLSearchParams(window.location.search).get(
		"requestId"
	);
	return visibleRequestId === null || visibleRequestId === requestId;
}
