import type { SpaceTask } from "@openmeld/schemas/types";
import { CheckSquareIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import { spaceTaskQueryKeys } from "#/query/spaces/space-tasks";

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

export function SpaceMessageTaskReference(input: {
	signalId?: string;
	text: string;
	preserveBody?: boolean;
	children: ReactNode;
}) {
	const references = useContext(TaskReferences);
	const task = input.signalId
		? references?.bySource.get(input.signalId)
		: undefined;
	if (!task) {
		return input.children;
	}
	return (
		<>
			<button
				className="mb-2 flex max-w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				onClick={references?.onOpen}
				type="button"
			>
				<CheckSquareIcon aria-hidden="true" className="size-4 shrink-0" />
				<span className="truncate">{task.title}</span>
				<span className="text-muted-foreground text-xs">Task</span>
			</button>
			{!input.preserveBody && input.text.trim() === task.title
				? null
				: input.children}
		</>
	);
}
