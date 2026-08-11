import {
	type StructuredApiClientFailure,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	GetCenterAgentDirectMessageSpaceProjectionResponse,
	OpenCenterAgentDirectMessageSpaceResponse,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import {
	centerAgentDirectMessageOpenQueryOptions,
	centerAgentDirectMessageSpaceProjectionQueryOptions,
} from "#/query/organizations/center-agent";
import { organizationScopeQueryOptions } from "#/query/organizations/organization-scope";

export type CenterAgentDirectMessageRouteData =
	| {
			directMessage: OpenCenterAgentDirectMessageSpaceResponse;
			status: "ready";
	  }
	| {
			error: StructuredApiClientFailure;
			status: "error";
	  }
	| {
			status: "connect_required";
	  };

export async function loadCenterAgentRouteData(input: {
	organizationSlug: string;
	queryClient: QueryClient;
	routeFamily: string;
	shouldOpenDirectMessage: boolean;
}): Promise<CenterAgentDirectMessageRouteData | null> {
	if (!input.shouldOpenDirectMessage) {
		return null;
	}

	const scopeOptions = organizationScopeQueryOptions({
		organizationSlug: input.organizationSlug,
		routeFamily: input.routeFamily,
	});
	const scope = await input.queryClient.ensureQueryData(scopeOptions);

	if (scope.access !== "authorized") {
		return null;
	}

	return await loadCenterAgentDirectMessageRouteData({
		organizationId: scope.currentOrganization.id,
		queryClient: input.queryClient,
	});
}

export async function loadCenterAgentDirectMessageRouteData(input: {
	organizationId: string;
	queryClient: QueryClient;
}): Promise<CenterAgentDirectMessageRouteData> {
	try {
		const cachedRouteData = readCachedCenterAgentDirectMessageRouteData(input);
		if (cachedRouteData) {
			// Stable DM identity can render immediately. The current Space status
			// query still confirms access, while this safe projection refreshes in
			// the background without blocking the route or compact launcher.
			input.queryClient.prefetchQuery(
				centerAgentDirectMessageSpaceProjectionQueryOptions({
					enabled: true,
					organizationId: input.organizationId,
				})
			);
			return cachedRouteData;
		}
		const projectionResponse = await input.queryClient.fetchQuery(
			centerAgentDirectMessageSpaceProjectionQueryOptions({
				enabled: true,
				organizationId: input.organizationId,
			})
		);
		const projectionRouteData = resolveCenterAgentProjectionRouteData({
			organizationId: input.organizationId,
			projectionResponse,
		});
		if (projectionRouteData) {
			return projectionRouteData;
		}
		const directMessage = await input.queryClient.fetchQuery(
			centerAgentDirectMessageOpenQueryOptions({
				organizationId: input.organizationId,
			})
		);
		return resolveCenterAgentOpenRouteData({
			directMessage,
			organizationId: input.organizationId,
		});
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		return { error: failure, status: "error" };
	}
}

export function readCachedCenterAgentDirectMessageRouteData(input: {
	organizationId: string;
	queryClient: QueryClient;
}): CenterAgentDirectMessageRouteData | null {
	const projectionOptions = centerAgentDirectMessageSpaceProjectionQueryOptions(
		{
			enabled: true,
			organizationId: input.organizationId,
		}
	);
	const projectionResponse =
		input.queryClient.getQueryData<GetCenterAgentDirectMessageSpaceProjectionResponse>(
			projectionOptions.queryKey
		);
	if (projectionResponse) {
		const projectionRouteData = resolveCenterAgentProjectionRouteData({
			organizationId: input.organizationId,
			projectionResponse,
		});
		if (projectionRouteData) {
			return projectionRouteData;
		}
	}

	const openOptions = centerAgentDirectMessageOpenQueryOptions({
		organizationId: input.organizationId,
	});
	const directMessage =
		input.queryClient.getQueryData<OpenCenterAgentDirectMessageSpaceResponse>(
			openOptions.queryKey
		);
	return directMessage
		? resolveCenterAgentOpenRouteData({
				directMessage,
				organizationId: input.organizationId,
			})
		: null;
}

function resolveCenterAgentProjectionRouteData(input: {
	organizationId: string;
	projectionResponse: GetCenterAgentDirectMessageSpaceProjectionResponse;
}): CenterAgentDirectMessageRouteData | null {
	if (input.projectionResponse.organizationId !== input.organizationId) {
		return buildCenterAgentDirectMessageIdentityMismatch();
	}
	const projection = input.projectionResponse.projection;
	if (!projection) {
		return null;
	}
	if (projection.organizationId !== input.organizationId) {
		return buildCenterAgentDirectMessageIdentityMismatch();
	}
	return {
		directMessage: {
			centerAgentProfileId: projection.centerAgentProfileId,
			created: false,
			memberProfileId: projection.memberProfileId,
			organizationId: projection.organizationId,
			spaceId: projection.spaceId,
		},
		status: "ready",
	};
}

function resolveCenterAgentOpenRouteData(input: {
	directMessage: OpenCenterAgentDirectMessageSpaceResponse;
	organizationId: string;
}): CenterAgentDirectMessageRouteData {
	return input.directMessage.organizationId === input.organizationId
		? { directMessage: input.directMessage, status: "ready" }
		: buildCenterAgentDirectMessageIdentityMismatch();
}

function buildCenterAgentDirectMessageIdentityMismatch(): Extract<
	CenterAgentDirectMessageRouteData,
	{ status: "error" }
> {
	return {
		error: {
			code: "gateway.invalid_response",
			message:
				"The Center Agent conversation resolved for a different organization.",
			requestId: null,
			status: null,
			upstreamCode: null,
		},
		status: "error",
	};
}
