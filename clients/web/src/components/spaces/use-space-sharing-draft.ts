import { useEffect, useMemo, useRef, useState } from "react";
import {
	createSpaceSharingDraft,
	type SpaceSharingDraft,
	spaceSharingDraftsMatch,
} from "./space-sharing-model";

export type SpaceSharingDraftController = {
	baseline: SpaceSharingDraft;
	draft: SpaceSharingDraft;
	isDirty: boolean;
	password: string;
	acceptSaved: (draft: SpaceSharingDraft) => void;
	reset: () => void;
	setDraft: (draft: SpaceSharingDraft) => void;
	setPassword: (password: string) => void;
};

export function useSpaceSharingDraft(input: {
	accessMode: SpaceSharingDraft["accessMode"];
	allowGuests?: boolean;
	linkJoinPolicy?: SpaceSharingDraft["linkJoinPolicy"];
	spaceId: string;
	visibility?: SpaceSharingDraft["visibility"];
}): SpaceSharingDraftController {
	const { accessMode, allowGuests, linkJoinPolicy, spaceId, visibility } =
		input;
	const source = useMemo(
		() =>
			createSpaceSharingDraft({
				accessMode,
				allowGuests,
				linkJoinPolicy,
				visibility,
			}),
		[accessMode, allowGuests, linkJoinPolicy, visibility]
	);
	const [baseline, setBaseline] = useState(source);
	const [draft, setDraft] = useState(source);
	const [password, setPassword] = useState("");
	const scopeRef = useRef(spaceId);
	const isDirty =
		!spaceSharingDraftsMatch(draft, baseline) || password.trim() !== "";

	useEffect(() => {
		if (scopeRef.current !== spaceId) {
			scopeRef.current = spaceId;
			setBaseline(source);
			setDraft(source);
			setPassword("");
			return;
		}
		setBaseline(source);
		if (!isDirty) {
			setDraft(source);
		}
	}, [isDirty, source, spaceId]);

	return {
		baseline,
		draft,
		isDirty,
		password,
		acceptSaved: (savedDraft) => {
			setBaseline(savedDraft);
			setDraft(savedDraft);
			setPassword("");
		},
		reset: () => {
			setDraft(baseline);
			setPassword("");
		},
		setDraft,
		setPassword,
	};
}
