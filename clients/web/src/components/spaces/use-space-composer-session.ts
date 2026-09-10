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
		organizationSlug?: string;
		profileId: string;
		spaceId: string;
		draftScope?: string;
	};
}) {
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [blockedWakeProfileId, setBlockedWakeProfileId] = useState<
		string | null
	>(null);
	const [isSending, setIsSending] = useState(false);
	const sendInFlightRef = useRef(false);
	const requestTailRef = useRef(Promise.resolve());
	const reserveRequest = useCallback(() => {
		const ready = requestTailRef.current;
		let complete: () => void = () => undefined;
		requestTailRef.current = new Promise<void>((resolve) => {
			complete = resolve;
		});
		return { ready, complete };
	}, []);
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
		recordPendingSubmission: (includeFiles = true) => {
			authoring.recordPendingSubmission();
			return includeFiles ? files.beginSubmission() : [];
		},
		send: {
			begin: beginSend,
			reserveRequest,
			finish: finishSend,
			inFlightRef: sendInFlightRef,
			isSending,
			setIsSending,
		},
	};
}
