import type {
	SpaceAccessMode,
	SpaceLinkJoinPolicy,
} from "@openmeld/schemas/types";

export type SpaceLinkReading = "anyone" | "password" | "restricted";
export type SpaceLinkJoining = "anyone" | "invite_only" | "password";

export type SpaceSharingDraft = {
	accessMode: SpaceAccessMode;
	linkJoinPolicy: SpaceLinkJoinPolicy;
};

export function createSpaceSharingDraft(input: {
	accessMode: SpaceAccessMode;
	linkJoinPolicy?: SpaceLinkJoinPolicy;
}): SpaceSharingDraft {
	return {
		accessMode: input.accessMode,
		linkJoinPolicy: input.linkJoinPolicy ?? "access_mode",
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
			return { accessMode: "members_only", linkJoinPolicy: "invite_only" };
		case "password":
			return { ...draft, accessMode: "protected" };
		case "anyone":
			return {
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
		left.linkJoinPolicy === right.linkJoinPolicy
	);
}
