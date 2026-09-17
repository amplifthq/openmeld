import type {
	SpaceAccessMode,
	SpaceLinkJoinPolicy,
} from "@openmeld/schemas/types";

export type SpaceLinkReading = "anyone" | "password" | "restricted";
export type SpaceLinkJoining = "anyone" | "invite_only" | "password";

export type SpaceJoiningPresentation = {
	description: string;
	label: string;
};

export type SpaceSharingDraft = {
	accessMode: SpaceAccessMode;
	allowGuests: boolean;
	linkJoinPolicy: SpaceLinkJoinPolicy;
	visibility: "public" | "private";
};

export function createSpaceSharingDraft(input: {
	accessMode: SpaceAccessMode;
	allowGuests?: boolean;
	linkJoinPolicy?: SpaceLinkJoinPolicy;
	visibility?: "public" | "private";
}): SpaceSharingDraft {
	return {
		accessMode: input.accessMode,
		allowGuests: input.allowGuests ?? false,
		linkJoinPolicy: input.linkJoinPolicy ?? "access_mode",
		visibility: input.visibility ?? "private",
	};
}

export function resolveSpaceLinkReading(
	draft: SpaceSharingDraft
): SpaceLinkReading {
	switch (draft.accessMode) {
		case "members_only":
			return "restricted";
		case "protected":
			return "password";
		default:
			return "anyone";
	}
}

export function resolveSpaceLinkJoining(
	draft: SpaceSharingDraft
): SpaceLinkJoining {
	if (
		draft.accessMode === "members_only" ||
		draft.linkJoinPolicy === "invite_only"
	) {
		return "invite_only";
	}
	if (
		draft.accessMode === "protected" ||
		draft.accessMode === "public_view_join_password"
	) {
		return "password";
	}
	return "anyone";
}

export function describeSpaceJoining(input: {
	draft: SpaceSharingDraft;
	organizationName?: string;
}): SpaceJoiningPresentation {
	const { draft } = input;
	const joining = resolveSpaceLinkJoining(draft);
	const organizationName = input.organizationName ?? "your organization";
	const organizationCanJoin = draft.visibility === "public";

	if (joining === "invite_only") {
		return {
			description: draft.allowGuests
				? "Send an invitation to let someone join."
				: "External participation is off. A guest invitation will ask you to enable it first.",
			label: organizationCanJoin
				? `Invited people or anyone at ${organizationName}`
				: "Only invited people",
		};
	}

	if (joining === "anyone") {
		return draft.allowGuests
			? {
					description: `People outside ${organizationName} join only this Space. Sign-in required.`,
					label: "Anyone, including external guests",
				}
			: {
					description:
						"External participation is currently off. Guest invitations can request enabling it.",
					label: `People at ${organizationName}`,
				};
	}

	if (organizationCanJoin) {
		return draft.allowGuests
			? {
					description: `People outside ${organizationName} need the password and sign in to join only this Space.`,
					label: `People at ${organizationName}; guests need a password`,
				}
			: {
					description:
						"External participation is currently off. People in the organization can join without the password.",
					label: `People at ${organizationName}`,
				};
	}

	return draft.allowGuests
		? {
				description:
					"People must sign in and enter the password. Guests join only this Space.",
				label: "Anyone with the password, including guests",
			}
		: {
				description:
					"People must sign in and enter the password. External participation is currently off.",
				label: `People at ${organizationName} with the password`,
			};
}

export function setSpaceLinkReading(
	draft: SpaceSharingDraft,
	reading: SpaceLinkReading
): SpaceSharingDraft {
	switch (reading) {
		case "restricted":
			return {
				...draft,
				accessMode: "members_only",
				linkJoinPolicy: "invite_only",
			};
		case "password":
			return { ...draft, accessMode: "protected" };
		case "anyone":
			return {
				...draft,
				accessMode:
					resolveSpaceLinkJoining(draft) === "password"
						? "public_view_join_password"
						: "public",
				linkJoinPolicy:
					draft.accessMode === "members_only"
						? "invite_only"
						: draft.linkJoinPolicy,
			};
		default:
			return draft;
	}
}

export function setSpaceLinkJoining(
	draft: SpaceSharingDraft,
	joining: SpaceLinkJoining
): SpaceSharingDraft {
	const reading = resolveSpaceLinkReading(draft);
	if (reading === "restricted") {
		return draft;
	}
	if (joining === "invite_only") {
		return {
			...draft,
			accessMode: reading === "password" ? "protected" : "public",
			linkJoinPolicy: "invite_only",
		};
	}
	let accessMode: SpaceAccessMode = "public";
	if (joining === "password") {
		accessMode =
			reading === "password" ? "protected" : "public_view_join_password";
	}
	return {
		...draft,
		accessMode,
		linkJoinPolicy: "access_mode",
	};
}

export function spaceSharingDraftsMatch(
	left: SpaceSharingDraft,
	right: SpaceSharingDraft
): boolean {
	return (
		left.accessMode === right.accessMode &&
		left.allowGuests === right.allowGuests &&
		left.linkJoinPolicy === right.linkJoinPolicy &&
		left.visibility === right.visibility
	);
}
