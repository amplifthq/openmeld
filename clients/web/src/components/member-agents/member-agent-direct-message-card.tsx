import {
	getAgentControllerPermissionModeDisplayMetadata,
	isAskFirstAgentControllerPermissionMode,
} from "@openmeld/agent-runtime";
import type { PublicWakeabilityReason } from "@openmeld/schemas";
import type {
	ModelCatalog,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import {
	CheckCircleIcon,
	CircleNotchIcon,
	PlugsIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { isMemberAgentsEnabled } from "#/lib/member-agents/member-agents-feature";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { resolveAgentProfileModel } from "#/lib/profiles/agent-profile-model-display";
import { organizationAgentRuntimeOverviewQueryOptions } from "#/query/organizations/organization-directory";
import {
	type DirectMessageMemberAgent,
	resolveDirectMessageMemberAgent,
} from "./member-agent-chat-history";
import { HarnessLogo } from "./member-agent-directory-section";
import { useMemberAgentIndex } from "./use-member-agents";

export const MEMBER_AGENT_PERMISSION_MODE_LINE =
	"Permission mode is Ask first, good for personal use; I can switch it later if colleagues use this Agent.";

export type MemberAgentDirectMessageCardModel =
	| {
			kind: "welcome";
			title: string;
			details: readonly { label: string; value: string }[];
			note: string | null;
	  }
	| {
			kind: "checking" | "offline" | "repair";
			title: string;
			description: string;
	  };

/**
 * One presentation card per problem for a MemberAgent Direct Message,
 * updated in place; never a published message. Driven by the Profile's four
 * Wakeability states and, when Core has exact evidence, its public
 * Wakeability reason.
 */
export function resolveMemberAgentDirectMessageCard(input: {
	entry: SpaceMemberDirectoryEntry;
	memberAgentName: string;
	modelCatalog: ModelCatalog | null;
	reason?: PublicWakeabilityReason | null;
}): MemberAgentDirectMessageCardModel {
	const { entry } = input;
	if (input.reason && entry.availabilityCategory !== "available") {
		return resolveReasonCard(input.reason, input.memberAgentName);
	}
	switch (entry.availabilityCategory) {
		case "available": {
			const model = resolveAgentProfileModel({
				agentControllerRef: entry.agentControllerRef,
				modelCatalog: input.modelCatalog,
				modelSelection: entry.modelSelection,
			});
			const details = [
				{
					label: "Computer",
					value: entry.runtimeDeviceDisplayName ?? "Your computer",
				},
				{
					label: "Default model",
					value:
						model.catalogModel?.displayName ??
						model.modelId ??
						"The harness default",
				},
				...(entry.workingDirectory
					? [{ label: "Default folder", value: entry.workingDirectory }]
					: []),
			];
			return {
				kind: "welcome",
				title: `${input.memberAgentName} is ready`,
				details,
				note: resolvePermissionModeNote(entry),
			};
		}
		case "offline":
			return {
				kind: "offline",
				title: `${input.memberAgentName} is offline`,
				description:
					entry.availabilitySummary ??
					"Its computer isn’t connected. Messages wait until it’s back.",
			};
		case "unavailable":
			return {
				kind: "repair",
				title: `${input.memberAgentName} needs attention`,
				description:
					entry.availabilitySummary ??
					"This Agent can’t start work right now. Open its settings to fix it.",
			};
		default:
			return {
				kind: "checking",
				title: `Checking ${input.memberAgentName}`,
				description: "OpenMeld is checking whether this Agent can start work.",
			};
	}
}

/**
 * The welcome card's permission line. The program's sentence applies only to
 * the harness's Ask-first default; any other mode is named as it is, and an
 * unknown mode says nothing rather than promise approval prompts.
 */
function resolvePermissionModeNote(
	entry: SpaceMemberDirectoryEntry
): string | null {
	const mode = entry.agentControllerPermissionMode;
	if (!mode) {
		return null;
	}
	if (isAskFirstAgentControllerPermissionMode(mode)) {
		return MEMBER_AGENT_PERMISSION_MODE_LINE;
	}
	const { label } = getAgentControllerPermissionModeDisplayMetadata(mode, {
		agentControllerRef: entry.agentControllerRef,
	});
	return `Permission mode is ${label}.`;
}

function resolveReasonCard(
	reason: PublicWakeabilityReason,
	memberAgentName: string
): MemberAgentDirectMessageCardModel {
	switch (reason.code) {
		case "computer_offline":
			return {
				kind: "offline",
				title: `${memberAgentName} is offline`,
				description:
					"Its computer isn’t connected. Messages wait until it’s back.",
			};
		case "not_signed_in":
			return {
				kind: "repair",
				title: `${memberAgentName} needs you to sign in`,
				description:
					"The harness isn’t signed in on its computer. Sign in there, then send your message again.",
			};
		case "no_subscription":
			return {
				kind: "repair",
				title: `${memberAgentName} has no active plan`,
				description:
					"The harness account on its computer has no active subscription. Renew it, then try again.",
			};
		case "org_disabled":
			return {
				kind: "repair",
				title: `${memberAgentName} is turned off here`,
				description:
					"This harness is turned off for its account’s organization. Ask that account’s admin to turn it on.",
			};
		case "version_too_old":
			return {
				kind: "repair",
				title: `${memberAgentName} needs an update`,
				description: `The installed harness can’t run ${reason.modelId}. Update it on its computer, or choose another model.`,
			};
		case "usage_exhausted":
			return {
				kind: "repair",
				title: `${memberAgentName} reached its usage limit`,
				description: reason.resetAt
					? `It can work again after ${new Date(reason.resetAt).toLocaleString(
							"en-US",
							{ dateStyle: "medium", timeStyle: "short" }
						)}.`
					: "It can work again when the limit resets.",
			};
		default:
			return {
				kind: "repair",
				title: `${memberAgentName} needs attention`,
				description: "This Agent can’t start work right now.",
			};
	}
}

const CARD_ICON = {
	checking: CircleNotchIcon,
	offline: PlugsIcon,
	repair: WarningCircleIcon,
	welcome: CheckCircleIcon,
} as const;

export function MemberAgentDirectMessageCard(input: {
	current: DirectMessageMemberAgent;
	model: MemberAgentDirectMessageCardModel;
}) {
	const Icon = CARD_ICON[input.model.kind];
	return (
		<section
			aria-label={input.model.title}
			className="mx-auto my-4 w-full max-w-2xl rounded-xl border bg-card px-5 py-4 text-sm"
			data-member-agent-card={input.model.kind}
		>
			<div className="flex items-center gap-3">
				<HarnessLogo
					harnessKind={input.current.memberAgent.harnessKind}
					size={32}
				/>
				<h2 className="flex min-w-0 flex-1 items-center gap-2 font-medium">
					<span className="truncate">{input.model.title}</span>
					<Icon
						aria-hidden="true"
						className={
							input.model.kind === "repair"
								? "size-4 shrink-0 text-destructive"
								: "size-4 shrink-0 text-muted-foreground"
						}
					/>
				</h2>
			</div>
			{input.model.kind === "welcome" ? (
				<>
					<dl className="mt-3 grid gap-x-4 gap-y-1.5 sm:grid-cols-[auto_1fr]">
						{input.model.details.map((detail) => (
							<div className="contents" key={detail.label}>
								<dt className="text-muted-foreground">{detail.label}</dt>
								<dd className="min-w-0 truncate">{detail.value}</dd>
							</div>
						))}
					</dl>
					{input.model.note ? (
						<p className="mt-3 text-muted-foreground text-xs">
							{input.model.note}
						</p>
					) : null}
				</>
			) : (
				<p className="mt-2 text-muted-foreground">{input.model.description}</p>
			)}
		</section>
	);
}

export type MemberAgentDirectMessageCardState = {
	current: DirectMessageMemberAgent;
	model: MemberAgentDirectMessageCardModel;
};

/**
 * The card for the signed-in member's current MemberAgent Direct Message, or
 * null. Callers render nothing (and keep their own empty-state guidance)
 * when this is null.
 */
type MemberAgentDirectMessageCardInput = {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	readOnly?: boolean;
	hasMessages: boolean;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
};

/**
 * The card for the signed-in member's current MemberAgent Direct Message, or
 * null. Chosen once from MEMBER_AGENTS_ENABLED: with the flag off it reads
 * nothing.
 */
export const useMemberAgentDirectMessageCard: (
	input: MemberAgentDirectMessageCardInput
) => MemberAgentDirectMessageCardState | null = isMemberAgentsEnabled()
	? useEnabledMemberAgentDirectMessageCard
	: () => null;

function useEnabledMemberAgentDirectMessageCard(input: {
	isDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	/** Observers (for example an Agent owner watching) get no card. */
	readOnly?: boolean;
	hasMessages: boolean;
	membersSnapshot: SpaceMembersSnapshot | null;
	modelCatalog: ModelCatalog | null;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
}): MemberAgentDirectMessageCardState | null {
	const memberAgents = useMemberAgentIndex();
	const organizationId =
		useOptionalAppOrganization()?.currentOrganization.id ?? "";
	// The public Wakeability reason rides on the owner's runtime overview.
	const runtime = useQuery(
		organizationAgentRuntimeOverviewQueryOptions({
			enabled: memberAgents.ready && input.isDirectMessage,
			organizationId,
		})
	);
	if (!memberAgents.ready || input.readOnly === true) {
		return null;
	}
	const current = resolveDirectMessageMemberAgent({
		index: memberAgents.index,
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		isDirectMessage: input.isDirectMessage,
		snapshot: input.membersSnapshot,
	});
	const entry = current
		? input.profileEntriesById.get(current.agentProfileId)
		: undefined;
	if (!(current && entry)) {
		return null;
	}
	const model = resolveMemberAgentDirectMessageCard({
		entry,
		memberAgentName: current.memberAgent.displayName,
		modelCatalog: input.modelCatalog,
		reason:
			runtime.data?.agentProfiles.find(
				(item) => item.profileId === current.agentProfileId
			)?.readiness.publicWakeabilityReason ?? null,
	});
	// The welcome card belongs to an empty Session; repair cards stay.
	return model.kind === "welcome" && input.hasMessages
		? null
		: { current, model };
}
