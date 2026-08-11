"use client";

import { buildConnectorAppRequestProviderKey } from "@openmeld/schemas";
import type {
	ConnectorAppCatalogProvider,
	ConnectorAppRequest,
	ConnectorAppRequestListResponse,
	ConnectorConnectionListResponse,
	CreateConnectorAppRequestBody,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Card } from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Textarea } from "@openmeld/ui/components/textarea";
import { resolveStatusToneProminentBadgeClassName } from "@openmeld/ui/lib/status-tone";
import {
	ArrowRightIcon,
	CheckIcon,
	MagnifyingGlassIcon,
	PlugIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useMemo, useState } from "react";
import {
	APPS,
	findAppDefinition,
} from "#/components/organizations/app-catalog";
import { CenterAgentAppConnectionCard } from "#/components/organizations/center-agent-app-connection-card";
import { CenterAgentGitHubConnectionCard } from "#/components/organizations/center-agent-github-connection-card";
import { createCurrentOrganizationConnectorAppRequest } from "#/lib/organizations/connector-connections";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import {
	organizationAppConnectionCatalogQueryOptions,
	organizationAppConnectionQueryKeys,
	organizationAppProviderCatalogQueryOptions,
	organizationAppRequestsQueryOptions,
} from "#/query/organizations/app-connections";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";

const RESULT_LIMIT = 24;

export function AppsOnboardingStep(input: { onContinue: () => void }) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const queryClient = useQueryClient();
	const [search, setSearch] = useState("");
	const [selectedProvider, setSelectedProvider] =
		useState<ConnectorAppCatalogProvider | null>(null);
	const [freeformName, setFreeformName] = useState<string | null>(null);
	const [useCase, setUseCase] = useState("");
	const deferredSearch = useDeferredValue(search.trim().toLowerCase());
	const catalogQuery = useQuery(
		organizationAppProviderCatalogQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const connectionsQuery = useQuery(
		organizationAppConnectionCatalogQueryOptions({
			organizationId: currentOrganization.id,
			queryClient,
		})
	);
	const requestsQuery = useQuery(
		organizationAppRequestsQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: currentOrganization.isPersonal !== true,
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	const canManageSharedApps =
		currentOrganization.isPersonal === true ||
		canManageOrganizationArea(roleQuery.data, {
			connector: ["manage"],
		});
	const providers = catalogQuery.data?.providers ?? fallbackProviders();
	const matchingProviders = useMemo(
		() =>
			resolveVisibleProviders({
				providers,
				search: deferredSearch,
			}),
		[deferredSearch, providers]
	);
	const requestedProviders = new Set(
		(requestsQuery.data?.requests ?? []).map(requestIdentity)
	);
	const connectedServices = resolveConnectedServices(connectionsQuery.data);
	const connectionStatusIsPending = connectionsQuery.isPending;
	const connectionStatusIsKnown = connectionsQuery.data !== undefined;

	const requestMutation = useMutation<
		{ request: ConnectorAppRequest },
		Error,
		CreateConnectorAppRequestBody,
		{ previous: ConnectorAppRequestListResponse | undefined }
	>({
		mutationFn: async (request) =>
			await createCurrentOrganizationConnectorAppRequest({
				...request,
				organizationId: currentOrganization.id,
			}),
		mutationKey: ["onboarding", "apps", "request", currentOrganization.id],
		onError: (_error, _request, context) => {
			queryClient.setQueryData(
				organizationAppConnectionQueryKeys.requests(currentOrganization.id),
				context?.previous
			);
		},
		onMutate: async (request) => {
			const queryKey = organizationAppConnectionQueryKeys.requests(
				currentOrganization.id
			);
			await queryClient.cancelQueries({ queryKey });
			const previous =
				queryClient.getQueryData<ConnectorAppRequestListResponse>(queryKey);
			const optimistic = buildOptimisticRequest({
				currentUserId,
				organizationId: currentOrganization.id,
				request,
			});
			queryClient.setQueryData<ConnectorAppRequestListResponse>(queryKey, {
				currentUserId,
				organizationId: currentOrganization.id,
				requests: upsertRequest(previous?.requests ?? [], optimistic),
			});
			return { previous };
		},
		onSettled: async () => {
			await queryClient.invalidateQueries({
				queryKey: organizationAppConnectionQueryKeys.requests(
					currentOrganization.id
				),
			});
		},
		onSuccess: (response) => {
			const queryKey = organizationAppConnectionQueryKeys.requests(
				currentOrganization.id
			);
			queryClient.setQueryData<ConnectorAppRequestListResponse>(
				queryKey,
				(current) =>
					current
						? {
								...current,
								requests: upsertRequest(current.requests, response.request),
							}
						: {
								currentUserId,
								organizationId: currentOrganization.id,
								requests: [response.request],
							}
			);
		},
	});
	const selectedApp = selectedProvider
		? findAppDefinition(selectedProvider.service)
		: null;
	const selectedIsRequested =
		selectedProvider !== null &&
		requestedProviders.has(`catalog:${selectedProvider.service}`);
	const freeformIsRequested =
		freeformName !== null &&
		requestedProviders.has(freeformRequestIdentity(freeformName));
	const searchedFreeformIsRequested =
		search.trim().length > 0 &&
		requestedProviders.has(freeformRequestIdentity(search));

	const selectProvider = (provider: ConnectorAppCatalogProvider) => {
		setSelectedProvider(provider);
		setFreeformName(null);
		setUseCase("");
	};
	const selectFreeform = () => {
		const name = search.trim();
		if (!name) {
			return;
		}
		setSelectedProvider(null);
		setFreeformName(name);
		setUseCase("");
	};
	const submitRequest = (request: CreateConnectorAppRequestBody) => {
		requestMutation.mutate(request);
	};

	return (
		<div className="flex flex-1 flex-col">
			<div className="relative">
				<MagnifyingGlassIcon
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					autoFocus
					className="h-11 rounded-md pl-10"
					onChange={(event) => {
						setSearch(event.target.value);
						setSelectedProvider(null);
						setFreeformName(null);
					}}
					placeholder="Search GitHub, Notion, Salesforce…"
					type="search"
					value={search}
				/>
			</div>

			<div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
				<div className="flex items-center justify-between py-2">
					<p className="text-muted-foreground text-xs">
						{deferredSearch
							? `${matchingProviders.length.toLocaleString()} Apps found`
							: "Recommended for teams"}
					</p>
					{catalogQuery.isError ? (
						<button
							className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline"
							onClick={() => catalogQuery.refetch()}
							type="button"
						>
							Retry full catalog
						</button>
					) : null}
				</div>

				<ConnectionStatusError
					error={connectionsQuery.isError}
					onRetry={() => connectionsQuery.refetch()}
				/>

				<ProviderGrid
					connectedServices={connectedServices}
					connectionStatusIsKnown={connectionStatusIsKnown}
					connectionStatusIsPending={connectionStatusIsPending}
					onSelect={selectProvider}
					providers={matchingProviders}
					requestedProviders={requestedProviders}
					selectedService={selectedProvider?.service ?? null}
				/>

				{deferredSearch && matchingProviders.length === 0 ? (
					<FreeformRequestRow
						name={search.trim()}
						onClick={selectFreeform}
						requested={searchedFreeformIsRequested}
					/>
				) : null}

				{selectedProvider && selectedApp?.availability === "available" ? (
					<AvailableAppConnectionPanel
						app={selectedApp}
						canManageSharedApps={canManageSharedApps}
						connected={connectedServices.has(selectedProvider.service)}
						isPersonalWorkspace={currentOrganization.isPersonal === true}
						organizationId={currentOrganization.id}
						provider={selectedProvider}
					/>
				) : null}

				{selectedProvider && selectedApp?.availability !== "available" ? (
					<AppRequestPanel
						error={requestMutation.error}
						isPending={requestMutation.isPending}
						isRequested={selectedIsRequested}
						name={selectedProvider.displayName}
						onRequest={() =>
							submitRequest({
								providerId: selectedProvider.service,
								providerName: selectedProvider.displayName,
								requestedCapabilities: [],
								source: "openconnector_catalog",
								useCase: useCase.trim() || null,
							})
						}
						onUseCaseChange={setUseCase}
						useCase={useCase}
					/>
				) : null}

				{freeformName ? (
					<AppRequestPanel
						error={requestMutation.error}
						isPending={requestMutation.isPending}
						isRequested={freeformIsRequested}
						name={freeformName}
						onRequest={() =>
							submitRequest({
								providerName: freeformName,
								requestedCapabilities: [],
								source: "freeform",
								useCase: useCase.trim() || null,
							})
						}
						onUseCaseChange={setUseCase}
						useCase={useCase}
					/>
				) : null}
			</div>

			<div className="flex items-center justify-between gap-4 border-border/70 border-t pt-5">
				<p className="text-muted-foreground text-xs">
					Everything here can be changed later.
				</p>
				<Button onClick={input.onContinue} type="button">
					Continue
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
		</div>
	);
}

function AvailableAppConnectionPanel(input: {
	app: Extract<
		ReturnType<typeof findAppDefinition>,
		{ availability: "available" }
	>;
	canManageSharedApps: boolean;
	connected: boolean;
	isPersonalWorkspace: boolean;
	organizationId: string;
	provider: ConnectorAppCatalogProvider;
}) {
	const mode = input.canManageSharedApps ? "all" : "member";
	return (
		<Card className="mt-4 gap-0 rounded-md bg-card/30 p-4">
			<div className="mb-3">
				<p className="font-medium text-sm">
					{input.connected
						? `${input.provider.displayName} access`
						: `Connect ${input.provider.displayName}`}
				</p>
				<p className="mt-1 text-muted-foreground text-xs">
					{input.canManageSharedApps
						? "Connect it for the organization or just for yourself."
						: "Connect your own account. Organization connections stay visible but read-only."}
				</p>
			</div>
			{input.provider.service === "github" ? (
				<CenterAgentGitHubConnectionCard
					canManage={input.canManageSharedApps}
					isPersonalWorkspace={input.isPersonalWorkspace}
					mode={mode}
					organizationId={input.organizationId}
					presentation="onboarding"
				/>
			) : (
				<CenterAgentAppConnectionCard
					app={input.app}
					canManage={input.canManageSharedApps}
					isPersonalWorkspace={input.isPersonalWorkspace}
					mode={mode}
					organizationId={input.organizationId}
				/>
			)}
		</Card>
	);
}

function ProviderGrid(input: {
	connectedServices: ReadonlySet<string>;
	connectionStatusIsKnown: boolean;
	connectionStatusIsPending: boolean;
	onSelect: (provider: ConnectorAppCatalogProvider) => void;
	providers: ConnectorAppCatalogProvider[];
	requestedProviders: ReadonlySet<string>;
	selectedService: string | null;
}) {
	return (
		<div className="grid gap-2 sm:grid-cols-2">
			{input.providers.slice(0, RESULT_LIMIT).map((provider) => {
				const app = findAppDefinition(provider.service);
				const available = app?.availability === "available";
				return (
					<ProviderRow
						available={available}
						connected={resolveProviderConnected({
							available,
							connectedServices: input.connectedServices,
							service: provider.service,
						})}
						connectionStatusIsKnown={input.connectionStatusIsKnown}
						connectionStatusIsPending={input.connectionStatusIsPending}
						key={provider.service}
						onClick={() => input.onSelect(provider)}
						provider={provider}
						requested={input.requestedProviders.has(
							`catalog:${provider.service}`
						)}
						selected={input.selectedService === provider.service}
					/>
				);
			})}
		</div>
	);
}

function FreeformRequestRow(input: {
	name: string;
	onClick: () => void;
	requested: boolean;
}) {
	return (
		<Card className="mt-2 gap-0 overflow-visible rounded-md border border-border border-dashed bg-transparent py-0 ring-0">
			<button
				className="flex w-full items-center gap-3 rounded-md p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={input.onClick}
				type="button"
			>
				<span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">
					<PlugIcon aria-hidden="true" className="size-4" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block font-medium text-sm">
						{input.requested ? "Requested" : "Request"} “{input.name}”
					</span>
					<span className="mt-0.5 block text-muted-foreground text-xs">
						{input.requested
							? "Saved for this organization."
							: "We’ll record exactly who needs it and why."}
					</span>
				</span>
				{input.requested ? (
					<CheckIcon aria-hidden="true" className="size-4 text-emerald-500" />
				) : (
					<ArrowRightIcon
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				)}
			</button>
		</Card>
	);
}

function ProviderRow(input: {
	available: boolean;
	connected: boolean;
	connectionStatusIsKnown: boolean;
	connectionStatusIsPending: boolean;
	onClick: () => void;
	provider: ConnectorAppCatalogProvider;
	requested: boolean;
	selected: boolean;
}) {
	const app = findAppDefinition(input.provider.service);
	const logoUrl = app?.logoPath ?? input.provider.iconUrl;
	let statusClassName = "text-muted-foreground";
	let statusLabel = "Request";
	if (input.connected) {
		statusLabel = "Connected";
	} else if (input.requested) {
		statusClassName = "text-emerald-500";
		statusLabel = "Requested";
	} else if (input.available) {
		statusClassName = "text-foreground/70";
		statusLabel = "Connect";
	}
	return (
		<Card
			className={`gap-0 overflow-visible rounded-md py-0 ${
				input.selected
					? "bg-muted/45 ring-foreground/30"
					: "bg-card/25 hover:bg-card/60 hover:ring-foreground/20"
			}`}
		>
			<button
				aria-pressed={input.selected}
				className="flex min-h-16 w-full items-center gap-3 rounded-md p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={input.onClick}
				type="button"
			>
				<span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-border/70 bg-white p-1.5 text-black text-sm">
					{logoUrl ? (
						<img
							alt=""
							className="size-full object-contain"
							height={24}
							src={logoUrl}
							width={24}
						/>
					) : (
						input.provider.displayName.slice(0, 1).toUpperCase()
					)}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate font-medium text-sm">
						{input.provider.displayName}
					</span>
					<span className="mt-0.5 block truncate text-muted-foreground text-xs">
						{input.provider.categories[0]?.displayName ?? "App"}
					</span>
				</span>
				<ProviderStatus
					available={input.available}
					className={statusClassName}
					connected={input.connected}
					connectionStatusIsKnown={input.connectionStatusIsKnown}
					connectionStatusIsPending={input.connectionStatusIsPending}
					label={statusLabel}
				/>
			</button>
		</Card>
	);
}

function ConnectionStatusError(input: { error: boolean; onRetry: () => void }) {
	if (!input.error) {
		return null;
	}
	return (
		<div
			className="mb-2 flex flex-wrap items-center justify-between gap-2 border border-destructive/40 bg-destructive/5 px-3 py-2"
			role="alert"
		>
			<p className="text-destructive text-xs">
				OpenMeld could not load App connection status.
			</p>
			<Button onClick={input.onRetry} size="xs" type="button" variant="outline">
				Retry
			</Button>
		</div>
	);
}

function ProviderStatus(input: {
	available: boolean;
	className: string;
	connected: boolean;
	connectionStatusIsKnown: boolean;
	connectionStatusIsPending: boolean;
	label: string;
}) {
	if (input.connected) {
		return (
			<Badge className={resolveStatusToneProminentBadgeClassName("ready")}>
				<CheckIcon aria-hidden="true" data-icon="inline-start" weight="bold" />
				Connected
			</Badge>
		);
	}
	if (input.available && input.connectionStatusIsPending) {
		return (
			<Skeleton
				aria-hidden="true"
				className="h-5 w-16 shrink-0"
				data-testid="onboarding-app-connection-status-skeleton"
			/>
		);
	}
	if (input.available && !input.connectionStatusIsKnown) {
		return <span className="w-16 shrink-0" />;
	}
	return (
		<span
			className={`shrink-0 text-[10px] uppercase tracking-wide ${input.className}`}
		>
			{input.label}
		</span>
	);
}

function resolveConnectedServices(
	response: ConnectorConnectionListResponse | undefined
): Set<string> {
	if (!response) {
		return new Set();
	}
	return new Set(
		response.connections
			.filter((connection) => connection.status === "active")
			.map((connection) => connection.service)
	);
}

function resolveProviderConnected(input: {
	available: boolean;
	connectedServices: ReadonlySet<string>;
	service: string;
}): boolean {
	return input.available && input.connectedServices.has(input.service);
}

function AppRequestPanel(input: {
	error: Error | null;
	isPending: boolean;
	isRequested: boolean;
	name: string;
	onRequest: () => void;
	onUseCaseChange: (value: string) => void;
	useCase: string;
}) {
	let requestButtonLabel = "Request App";
	if (input.isPending) {
		requestButtonLabel = "Requesting…";
	} else if (input.isRequested) {
		requestButtonLabel = "Requested";
	}
	return (
		<Card className="mt-4 gap-0 rounded-md bg-card/30 p-4">
			<div className="flex items-start justify-between gap-4">
				<div>
					<p className="font-medium text-sm">Request {input.name}</p>
					<p className="mt-1 text-muted-foreground text-xs leading-5">
						Tell us what your team needs. This is optional.
					</p>
				</div>
				{input.isRequested ? (
					<span className="inline-flex items-center gap-1 text-emerald-500 text-xs">
						<CheckIcon aria-hidden="true" className="size-3.5" />
						Requested
					</span>
				) : null}
			</div>
			<Textarea
				className="mt-3 min-h-20 resize-none"
				disabled={input.isPending || input.isRequested}
				maxLength={2000}
				onChange={(event) => input.onUseCaseChange(event.target.value)}
				placeholder={`Example: Let Center Agent use ${input.name} to follow customer requests.`}
				value={input.useCase}
			/>
			{input.error ? (
				<p className="mt-2 text-destructive text-xs" role="alert">
					{input.error.message}
				</p>
			) : null}
			<div className="mt-3 flex justify-end">
				<Button
					disabled={input.isPending || input.isRequested}
					onClick={input.onRequest}
					size="sm"
					type="button"
				>
					{requestButtonLabel}
				</Button>
			</div>
		</Card>
	);
}

function resolveVisibleProviders(input: {
	providers: ConnectorAppCatalogProvider[];
	search: string;
}): ConnectorAppCatalogProvider[] {
	if (!input.search) {
		const recommendedServices = new Set<string>(
			APPS.slice(0, 8).map((app) => app.service)
		);
		return input.providers.filter((provider) =>
			recommendedServices.has(provider.service)
		);
	}
	return input.providers.filter((provider) =>
		[
			provider.displayName,
			provider.service,
			...provider.categories.map((category) => category.displayName),
		]
			.join(" ")
			.toLocaleLowerCase()
			.includes(input.search)
	);
}

function fallbackProviders(): ConnectorAppCatalogProvider[] {
	return APPS.map((app) => ({
		authTypes: [],
		categories: [{ displayName: app.category, id: app.category }],
		displayName: app.name,
		homepageUrl: app.homepage,
		iconUrl: null,
		service: app.service,
	}));
}

function buildOptimisticRequest(input: {
	currentUserId: string;
	organizationId: string;
	request: CreateConnectorAppRequestBody;
}): ConnectorAppRequest {
	const nowMs = Date.now();
	return {
		availableAtMs: null,
		createdAtMs: nowMs,
		id: `optimistic:${requestIdentity(input.request)}`,
		notifiedAtMs: null,
		organizationId: input.organizationId,
		providerId: input.request.providerId ?? null,
		providerName: input.request.providerName,
		requestedCapabilities: input.request.requestedCapabilities ?? [],
		requesterMemberId: null,
		requesterUserId: input.currentUserId,
		source: input.request.source,
		status: "requested",
		updatedAtMs: nowMs,
		useCase: input.request.useCase ?? null,
	};
}

function upsertRequest(
	requests: ConnectorAppRequest[],
	request: ConnectorAppRequest
): ConnectorAppRequest[] {
	const identity = requestIdentity(request);
	return [
		request,
		...requests.filter((candidate) => requestIdentity(candidate) !== identity),
	];
}

function requestIdentity(
	request:
		| ConnectorAppRequest
		| Pick<
				CreateConnectorAppRequestBody,
				"providerId" | "providerName" | "source"
		  >
): string {
	return buildConnectorAppRequestProviderKey(request);
}

function freeformRequestIdentity(providerName: string): string {
	return buildConnectorAppRequestProviderKey({
		providerId: null,
		providerName,
		source: "freeform",
	});
}
