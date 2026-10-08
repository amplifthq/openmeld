import type { SpaceTask } from "@openmeld/schemas/types";
import { GitBranchIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import { spaceTaskQueryKeys } from "#/query/spaces/space-tasks";
import { SpaceMessageResourceCard } from "./space-message-resource-card";
import { formatSpaceTaskPhase } from "./space-task-presentation";

const TaskReferences = createContext<{
	bySource: ReadonlyMap<string, SpaceTask>;
	onOpen: () => void;
} | null>(null);

export function SpaceTaskReferencesProvider(input: {
	spaceId?: string;
	profileId: string;
	organizationSlug?: string;
	disabled: boolean;
	onOpen: () => void;
	children: ReactNode;
}) {
	const api = useMemo(
		() =>
			input.organizationSlug
				? createOrganizationScopedWebSpaceApi({
						organizationSlug: input.organizationSlug,
						openMeldProfileId: input.profileId,
					})
				: createUnscopedWebSpaceApi({ openMeldProfileId: input.profileId }),
		[input.organizationSlug, input.profileId]
	);
	const tasks = useQuery({
		queryKey: spaceTaskQueryKeys.list(input.spaceId ?? ""),
		queryFn: () => api.listTasks({ spaceId: input.spaceId ?? "" }),
		enabled: Boolean(input.spaceId) && !input.disabled,
		staleTime: 30_000,
	});
	const bySource = useMemo(
		() =>
			new Map(
				(tasks.data?.tasks ?? []).flatMap((task) =>
					task.sourceSignalId ? [[task.sourceSignalId, task] as const] : []
				)
			),
		[tasks.data]
	);
	const value = useMemo(
		() => ({ bySource, onOpen: input.onOpen }),
		[bySource, input.onOpen]
	);
	return (
		<TaskReferences.Provider value={value}>
			{input.children}
		</TaskReferences.Provider>
	);
}

export function useSpaceMessageTask(signalId?: string) {
	const references = useContext(TaskReferences);
	return signalId ? references?.bySource.get(signalId) : undefined;
}

export function taskMessageBodyText(
	task: SpaceTask | undefined,
	text: string,
	mentionCount: number,
	renderedText: string,
	hasSeparateCard: boolean
) {
	return hasSeparateCard &&
		task &&
		mentionCount === 0 &&
		text.trim() === task.title
		? ""
		: renderedText;
}

export function SpaceMessageTaskReference(input: { signalId?: string }) {
	const references = useContext(TaskReferences);
	const task = input.signalId
		? references?.bySource.get(input.signalId)
		: undefined;
	if (!task) {
		return null;
	}
	return (
		<SpaceMessageResourceCard
			className="h-auto w-80 max-w-full whitespace-normal py-3 group-data-[align=end]/bubble:self-end"
			label={`Open task: ${task.title}`}
			onOpen={references?.onOpen}
		>
			<GitBranchIcon
				aria-hidden="true"
				className="mt-0.5 size-4 shrink-0 self-start text-muted-foreground"
			/>
			<span className="min-w-0">
				<span className="line-clamp-2 break-words font-medium text-sm leading-5">
					{task.title}
				</span>
				<span className="mt-1 block text-muted-foreground text-xs">
					Task · {formatSpaceTaskPhase(task.phase)}
				</span>
			</span>
		</SpaceMessageResourceCard>
	);
}
