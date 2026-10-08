import { createFirstWorkApi } from "@openmeld/api-client";
import type {
	FirstWorkAction,
	FirstWorkRecord,
	WalkthroughStep,
} from "@openmeld/schemas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
	createContext,
	type PropsWithChildren,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { resolveAppSpacesProfile } from "#/lib/spaces/app-spaces-profile";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";

type WalkthroughContextValue = {
	noticeAnchor: HTMLElement | null;
	setNoticeAnchor: (anchor: HTMLElement | null) => void;
	pauseNotice: boolean;
	dismissPauseNotice: () => void;
	available: boolean;
	hasStartedTutorial: boolean;
	loading: boolean;
	pending: boolean;
	error: Error | null;
	retry: () => Promise<void>;
	record: FirstWorkRecord | null;
	start: (replay?: boolean) => Promise<void>;
	resume: () => Promise<void>;
	progress: (step: WalkthroughStep, paused?: boolean) => Promise<void>;
	create: (
		space: Extract<FirstWorkAction, { action: "create" }>["space"]
	) => Promise<string>;
};
const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);
export function isActiveWalkthroughStep(
	record: FirstWorkRecord | null | undefined,
	step: WalkthroughStep
) {
	return Boolean(record && !record.paused && record.step === step);
}
export const useWalkthrough = () => useContext(WalkthroughContext);

export function WalkthroughProvider({ children }: PropsWithChildren) {
	const context = useAppOrganization();
	return (
		<ScopedWalkthroughProvider
			key={`${context.currentUserId}:${context.currentOrganization.id}`}
		>
			{children}
		</ScopedWalkthroughProvider>
	);
}
function ScopedWalkthroughProvider({ children }: PropsWithChildren) {
	const [noticeAnchor, setNoticeAnchor] = useState<HTMLElement | null>(null);
	const [pauseNotice, setPauseNotice] = useState(false);
	const pauseNoticeShown = useRef(false);
	useEffect(() => {
		if (!pauseNotice) {
			return;
		}
		const timer = window.setTimeout(() => setPauseNotice(false), 6000);
		return () => window.clearTimeout(timer);
	}, [pauseNotice]);
	const context = useAppOrganization();
	const { currentOrganization: organization } = context;
	const navigate = useNavigate();
	const client = useQueryClient();
	const profiles = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope: context.storageScope,
		})
	);
	const profile = resolveAppSpacesProfile({
		profiles: profiles.data ?? [],
		selectedHumanProfileId: null,
	});
	const api = useMemo(
		() =>
			createFirstWorkApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: organization.id,
					openMeldProfileId: profile?.openMeldProfileId,
				})
			),
		[organization.id, profile?.openMeldProfileId]
	);
	const queryKey = [
		"walkthrough",
		context.currentUserId,
		organization.id,
		profile?.openMeldProfileId,
	];
	const query = useQuery({
		queryKey,
		queryFn: ({ signal }) => api.read(signal),
		enabled: Boolean(profile),
		retry: false,
	});
	const progressErrorToastId = `tutorial-progress-${organization.id}`;
	const update = useMutation({
		mutationFn: api.update,
		onSuccess: (data) => {
			client.setQueryData(queryKey, data);
			toast.dismiss(progressErrorToastId);
		},
		onError: (_error, action) =>
			toast.error("Couldn't save tutorial progress", {
				id: progressErrorToastId,
				description: "Try again to save your place in the tutorial.",
				closeButton: true,
				action:
					action.action === "progress"
						? {
								label: "Try again",
								onClick: () => update.mutate(action),
							}
						: undefined,
			}),
	});
	const record = query.data?.record ?? null;
	const open = async (next: FirstWorkRecord) => {
		await navigate({
			replace: true,
			to:
				next.step === "create-space"
					? `/o/${organization.slug}/new-space`
					: buildOrganizationSpacePath({
							orgSlug: organization.slug,
							spaceId: next.spaceId,
						}),
			search: { profileId: next.profileId },
		});
	};
	const progress = async (step: WalkthroughStep, paused = false) => {
		if (!record || update.isPending) {
			return;
		}
		await update.mutateAsync({
			action: "progress",
			runId: record.runId,
			revision: record.revision,
			step,
			paused,
		});
		if (paused && !pauseNoticeShown.current) {
			pauseNoticeShown.current = true;
			setPauseNotice(true);
		}
	};
	const value: WalkthroughContextValue = {
		noticeAnchor,
		setNoticeAnchor,
		pauseNotice,
		dismissPauseNotice: () => setPauseNotice(false),
		available: query.isSuccess,
		hasStartedTutorial: query.data?.hasStartedTutorial === true,
		loading: profiles.isPending || (Boolean(profile) && query.isPending),
		pending: update.isPending,
		error: query.error ?? update.error,
		retry: async () => {
			await query.refetch();
		},
		record,
		progress,
		start: async (replay = false) => {
			if (record && !replay) {
				const result = await update.mutateAsync({
					action: "progress",
					runId: record.runId,
					revision: record.revision,
					step: record.step,
					paused: false,
				});
				if (result.record) {
					await open(result.record);
				}
				return;
			}
			const result = await update.mutateAsync({
				action: "start",
				runId: crypto.randomUUID(),
				previousRunId: record?.runId ?? null,
			});
			if (result.record) {
				await open(result.record);
			}
		},
		resume: async () => {
			if (!record) {
				return;
			}
			const result = await update.mutateAsync({
				action: "progress",
				runId: record.runId,
				revision: record.revision,
				step: record.step,
				paused: false,
			});
			if (result.record) {
				await open(result.record);
			}
		},
		create: async (space) => {
			if (!record) {
				throw new Error("Open the tutorial from Help to continue.");
			}
			const result = await update.mutateAsync({
				action: "create",
				runId: record.runId,
				space,
			});
			if (!result.record || result.record.runId !== record.runId) {
				throw new Error(
					"The tutorial changed in another tab. Open Help and select Continue tutorial."
				);
			}
			return result.record.spaceId;
		},
	};
	return (
		<WalkthroughContext.Provider value={value}>
			{children}
		</WalkthroughContext.Provider>
	);
}
