import type {
	LocalProjectControlConnection,
	LocalProjectControlDiscoverProjectsResponse,
} from "@openmeld/schemas/types";
import { queryOptions } from "@tanstack/react-query";
import { discoverCurrentComputerProjects } from "#/lib/organizations/local-project-control";

const PROJECT_DISCOVERY_STALE_TIME_MS = 30_000;
const PROJECT_DISCOVERY_GC_TIME_MS = 5 * 60_000;

export type ProjectDiscoveryProjectRef = {
	id: string;
	updatedAtMs: number;
};

type ProjectDiscoveryTarget = {
	deviceId: string;
	runtimeLane: string;
};

const nextGenerationByScope = new Map<string, number>();

export const projectDiscoveryQueryKeys = {
	all: ["project-discovery"] as const,
	target: (input: {
		deviceId: string;
		organizationId: string;
		runtimeLane: string;
		storageScope: string;
	}) =>
		[
			...projectDiscoveryQueryKeys.all,
			input.organizationId,
			input.storageScope,
			input.deviceId,
			input.runtimeLane,
		] as const,
	catalog: (input: {
		organizationId: string;
		projects: readonly ProjectDiscoveryProjectRef[];
		storageScope: string;
		target: ProjectDiscoveryTarget;
	}) =>
		[
			...projectDiscoveryQueryKeys.target({
				deviceId: input.target.deviceId,
				organizationId: input.organizationId,
				runtimeLane: input.target.runtimeLane,
				storageScope: input.storageScope,
			}),
			...buildProjectCatalog(input.projects),
		] as const,
};

export function projectDiscoveryQueryOptions(input: {
	enabled: boolean;
	organizationId: string;
	projects: readonly ProjectDiscoveryProjectRef[];
	storageScope: string;
	target: ProjectDiscoveryTarget;
}) {
	const projectIds = buildProjectCatalog(input.projects).map(
		([projectId]) => projectId
	);
	const scope = buildGenerationScope({
		organizationId: input.organizationId,
		storageScope: input.storageScope,
		target: input.target,
	});
	return queryOptions<LocalProjectControlDiscoverProjectsResponse, unknown>({
		enabled: input.enabled && projectIds.length > 0,
		gcTime: PROJECT_DISCOVERY_GC_TIME_MS,
		queryFn: async () =>
			await discoverCurrentComputerProjects({
				clientGeneration: claimProjectDiscoveryGeneration(scope),
				expectedOrganizationId: input.organizationId,
				projectIds,
			}),
		queryKey: projectDiscoveryQueryKeys.catalog(input),
		refetchOnWindowFocus: false,
		retry: false,
		staleTime: PROJECT_DISCOVERY_STALE_TIME_MS,
	});
}

export function claimProjectDiscoveryMutationGeneration(input: {
	organizationId: string;
	storageScope: string;
	target: ProjectDiscoveryTarget;
}): number {
	return claimProjectDiscoveryGeneration(buildGenerationScope(input));
}

export function applyProjectDiscoveryConnectionSnapshot(
	response: LocalProjectControlDiscoverProjectsResponse | undefined,
	projectId: string,
	connections: readonly LocalProjectControlConnection[]
): LocalProjectControlDiscoverProjectsResponse | undefined {
	if (!response) {
		return response;
	}
	return {
		...response,
		projects: response.projects.map((project) => {
			if (project.projectId !== projectId) {
				return project;
			}
			const connectedPaths = new Set(
				connections.map((connection) => connection.path)
			);
			const candidates = project.candidates.filter(
				(candidate) => !connectedPaths.has(candidate.canonicalPath)
			);
			if (connections.length === 0) {
				let status: "found" | "not_found" | "verification_unavailable" =
					"not_found";
				if (candidates.length > 0) {
					status = "found";
				} else if (project.status === "verification_unavailable") {
					status = "verification_unavailable";
				}
				return {
					...project,
					candidates,
					connections: [],
					status,
				};
			}
			const defaultConnection = connections.find(
				(connection) => connection.isDefault
			);
			return {
				...project,
				candidates,
				connections: [...connections],
				status:
					defaultConnection?.status === "available"
						? ("connected" as const)
						: ("connected_folder_missing" as const),
			};
		}),
	};
}

function buildProjectCatalog(
	projects: readonly ProjectDiscoveryProjectRef[]
): ReadonlyArray<readonly [string, number]> {
	return projects
		.map((project) => [project.id, project.updatedAtMs] as const)
		.sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
}

function buildGenerationScope(input: {
	organizationId: string;
	storageScope: string;
	target: ProjectDiscoveryTarget;
}): string {
	return [
		input.organizationId,
		input.storageScope,
		input.target.deviceId,
		input.target.runtimeLane,
	].join("\u0000");
}

function claimProjectDiscoveryGeneration(scope: string): number {
	const generation = (nextGenerationByScope.get(scope) ?? 0) + 1;
	nextGenerationByScope.set(scope, generation);
	return generation;
}
