"use client";

import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
	type CenterAgentDirectMessageRouteData,
	loadCenterAgentDirectMessageRouteData,
	readCachedCenterAgentDirectMessageRouteData,
} from "#/lib/organizations/center-agent-route-loader";
import { CenterAgentPage } from "./center-agent-page";

export function CenterAgentCompactConversation(input: {
	organizationId: string;
}) {
	const queryClient = useQueryClient();
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [routeDataState, setRouteDataState] = useState<{
		organizationId: string;
		value: CenterAgentDirectMessageRouteData;
	} | null>(() => {
		const value = readCachedCenterAgentDirectMessageRouteData({
			organizationId: input.organizationId,
			queryClient,
		});
		return value ? { organizationId: input.organizationId, value } : null;
	});
	const [failedOrganizationId, setFailedOrganizationId] = useState<
		string | null
	>(null);
	const cachedRouteData = readCachedCenterAgentDirectMessageRouteData({
		organizationId: input.organizationId,
		queryClient,
	});
	const routeData =
		routeDataState?.organizationId === input.organizationId
			? routeDataState.value
			: cachedRouteData;
	const loadFailed = failedOrganizationId === input.organizationId;

	useEffect(() => {
		let cancelled = false;
		setFailedOrganizationId(null);
		loadCenterAgentDirectMessageRouteData({
			organizationId: input.organizationId,
			queryClient,
		})
			.then((nextRouteData) => {
				if (!cancelled) {
					setRouteDataState({
						organizationId: input.organizationId,
						value: nextRouteData,
					});
				}
			})
			.catch((error: unknown) => {
				console.error("Failed to load the compact Center Agent conversation.", {
					error,
					loadAttempt,
				});
				if (!cancelled) {
					setFailedOrganizationId(input.organizationId);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [input.organizationId, loadAttempt, queryClient]);

	if (loadFailed && !routeData) {
		return (
			<section className="m-auto space-y-3 p-6 text-sm" role="alert">
				<p>Couldn’t load the Center Agent conversation.</p>
				<Button
					onClick={() => setLoadAttempt((current) => current + 1)}
					size="sm"
					type="button"
					variant="outline"
				>
					Try again
				</Button>
			</section>
		);
	}

	if (!routeData) {
		return (
			<div aria-busy="true" className="flex flex-1 flex-col gap-3 p-4">
				<span className="sr-only">Loading Center Agent conversation</span>
				<Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
				<Skeleton className="min-h-40 flex-1 motion-reduce:animate-none" />
				<Skeleton className="h-24 motion-reduce:animate-none" />
			</div>
		);
	}

	return (
		<CenterAgentPage
			directMessageRouteData={routeData}
			presentation="compact"
		/>
	);
}
