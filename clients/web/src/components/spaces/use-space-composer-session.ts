import { useCallback, useRef, useState } from "react";
import type { SpaceComposerEditorChange } from "./space-composer-editor";
import { useSpaceComposerFiles } from "./use-space-composer-attachments";
import {
	type UseSpaceMentionAuthoringInput,
	useSpaceMentionAuthoring,
} from "./use-space-mention-authoring";

export function useSpaceComposerSession(input: {
	authoring: UseSpaceMentionAuthoringInput;
	files: {
		organizationSlug: string;
		profileId: string;
		spaceId: string;
	};
}) {
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [blockedWakeProfileId, setBlockedWakeProfileId] = useState<
		string | null
	>(null);
	const [isSending, setIsSending] = useState(false);
	const sendInFlightRef = useRef(false);
	const authoring = useSpaceMentionAuthoring(input.authoring);
	const files = useSpaceComposerFiles(input.files);

	const clearFeedback = useCallback(() => {
		setErrorMessage(null);
		setBlockedWakeProfileId(null);
	}, []);
	const onEditorChange = useCallback(
		(change: SpaceComposerEditorChange) => {
			authoring.onComposerEditorChange(change);
			clearFeedback();
		},
		[authoring.onComposerEditorChange, clearFeedback]
	);
	const beginSend = useCallback(() => {
		if (sendInFlightRef.current) {
			return false;
		}
		clearFeedback();
		sendInFlightRef.current = true;
		setIsSending(true);
		return true;
	}, [clearFeedback]);
	const finishSend = useCallback(() => {
		sendInFlightRef.current = false;
		setIsSending(false);
	}, []);

	return {
		authoring,
		files,
		feedback: {
			blockedWakeProfileId,
			clear: clearFeedback,
			errorMessage,
			setBlockedWakeProfileId,
			setErrorMessage,
		},
		onEditorChange,
		send: {
			begin: beginSend,
			finish: finishSend,
			inFlightRef: sendInFlightRef,
			isSending,
			setIsSending,
		},
	};
}
