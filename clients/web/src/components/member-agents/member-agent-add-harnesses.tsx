import {
	type DetectedHarnessKind,
	formatHarnessDisplayName,
	MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON,
	type SyncMemberAgentsResponse,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	skipToken,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { addMemberAgentHarness } from "#/lib/member-agents/sync-member-agents";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import { HarnessLogo } from "./member-agent-directory-section";
import { invalidateMemberAgentReads } from "./use-member-agents";

type MemberAgentSyncQueryData = {
	changed: boolean;
	response: SyncMemberAgentsResponse | null;
};

/**
 * Installed Harnesses that are turned off in Local agents, each with an Add
 * action. Adding turns the Harness on and creates its Agent
 * (design-plans/member-agent-program.md §4.1). It reads the page's Agent
 * sync, so it renders nothing until that sync answered.
 */
export function MemberAgentAddableHarnesses() {
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	const queryClient = useQueryClient();
	const syncKey = memberAgentQueryKeys.sync(organizationId);
	// The page's sync (useMemberAgentSync) owns the request; this only reads it.
	const sync = useQuery<MemberAgentSyncQueryData>({
		queryKey: syncKey,
		queryFn: skipToken,
	});
	const add = useMutation({
		mutationFn: (harnessKind: DetectedHarnessKind) =>
			addMemberAgentHarness({ harnessKind, organizationId }),
		retry: false,
		onSuccess: (response, harnessKind) => {
			queryClient.setQueryData<MemberAgentSyncQueryData>(syncKey, {
				changed: true,
				response,
			});
			invalidateMemberAgentReads(queryClient, organizationId);
			const result = response.results.find(
				(candidate) => candidate.harnessKind === harnessKind
			);
			const name = formatHarnessDisplayName(harnessKind);
			if (
				result?.memberAgentId &&
				result.binding === "succeeded" &&
				result.directMessage === "succeeded"
			) {
				toast.success(`${name} is ready. Its chat is in your Agents.`);
				return;
			}
			if (result?.memberAgentId) {
				// Created, but its Binding or chat is still pending; the page's
				// sync finishes it.
				toast.success(`${name} was added. OpenMeld is finishing its setup.`);
				return;
			}
			toast.error(
				result?.reasonCodes[0] === MEMBER_AGENT_SYNC_HARNESS_NOT_DETECTED_REASON
					? `OpenMeld couldn't find ${name} on a connected computer.`
					: `OpenMeld couldn't turn ${name} on. Make sure OpenMeld Service is running on that computer, then try again.`
			);
		},
		onError: (_error, harnessKind) => {
			toast.error(
				`OpenMeld couldn't add ${formatHarnessDisplayName(harnessKind)}. Try again.`
			);
		},
	});
	return (
		<MemberAgentAddableHarnessList
			harnessKinds={sync.data?.response?.addableHarnessKinds ?? []}
			onAdd={(harnessKind) => add.mutate(harnessKind)}
			pendingHarnessKind={add.isPending ? (add.variables ?? null) : null}
		/>
	);
}

export function MemberAgentAddableHarnessList(input: {
	harnessKinds: readonly DetectedHarnessKind[];
	onAdd: (harnessKind: DetectedHarnessKind) => void;
	pendingHarnessKind: DetectedHarnessKind | null;
}) {
	if (input.harnessKinds.length === 0) {
		return null;
	}
	return (
		<section aria-label="Add an Agent" className="space-y-3">
			<div>
				<h3 className="font-medium text-sm">Found on your computers</h3>
				<p className="text-muted-foreground text-xs">
					These are installed but turned off. Adding one turns it on and opens
					its chat.
				</p>
			</div>
			<ul className="divide-y rounded-lg border">
				{input.harnessKinds.map((harnessKind) => {
					const name = formatHarnessDisplayName(harnessKind);
					const pending = input.pendingHarnessKind === harnessKind;
					return (
						<li className="flex items-center gap-3 px-3 py-2" key={harnessKind}>
							<HarnessLogo harnessKind={harnessKind} size={28} />
							<span className="min-w-0 flex-1 truncate font-medium text-sm">
								{name}
							</span>
							<Button
								aria-label={`Add ${name}`}
								disabled={input.pendingHarnessKind !== null}
								onClick={() => input.onAdd(harnessKind)}
								size="sm"
								variant="secondary"
							>
								{pending ? "Adding…" : "Add"}
							</Button>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
