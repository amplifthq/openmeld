import type {
	SpaceAccessMode,
	SpaceLinkJoinPolicy,
} from "@openmeld/schemas/types";

export type SpaceLinkReading = "anyone" | "password" | "restricted";
export type SpaceLinkJoining = "anyone" | "invite_only" | "password";

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
	if (draft.linkJoinPolicy === "invite_only") {
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
