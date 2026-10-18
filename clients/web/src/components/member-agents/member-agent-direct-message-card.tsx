import type { ModelCatalog } from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import {
	CheckCircleIcon,
	CircleNotchIcon,
	PlugsIcon,
	WarningCircleIcon,
} from "@phosphor-icons/react";
import { resolveAgentProfileModel } from "#/lib/profiles/agent-profile-model-display";
import type { DirectMessageMemberAgent } from "./member-agent-chat-history";
import { HarnessLogo } from "./member-agent-directory-section";

export const MEMBER_AGENT_PERMISSION_MODE_LINE =
	"Permission mode is Ask first, good for personal use; I can switch it later if colleagues use this Agent.";

export type MemberAgentDirectMessageCardModel =
	| {
			kind: "welcome";
			title: string;
			details: readonly { label: string; value: string }[];
			note: string;
	  }
	| {
			kind: "checking" | "offline" | "repair";
			title: string;
			description: string;
	  };

/**
 * One presentation card per problem for a MemberAgent Direct Message,
 * updated in place; never a published message. Driven by the Profile's four
 * Wakeability states.
 *
 * TODO(1c): when Core exposes the public availability reason enum
 * (`not_signed_in`, `no_subscription`, `org_disabled`, `version_too_old`,
 * `computer_offline`, `usage_exhausted`), map it here to per-reason repair
 * copy instead of the generic summary.
 */
export function resolveMemberAgentDirectMessageCard(input: {
	entry: SpaceMemberDirectoryEntry;
	memberAgentName: string;
	modelCatalog: ModelCatalog | null;
}): MemberAgentDirectMessageCardModel {
	const { entry } = input;
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
				note: MEMBER_AGENT_PERMISSION_MODE_LINE,
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
					<p className="mt-3 text-muted-foreground text-xs">
						{input.model.note}
					</p>
				</>
			) : (
				<p className="mt-2 text-muted-foreground">{input.model.description}</p>
			)}
		</section>
	);
}
