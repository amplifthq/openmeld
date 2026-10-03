import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { SpaceComposerFilesController } from "#/components/spaces/use-space-composer-attachments";
import {
	type CenterAgentPendingMessageScope,
	clearCenterAgentPendingMessage,
	createPendingCenterAgentMessage,
	type PendingCenterAgentMessage,
	readCenterAgentPendingMessage,
	writeCenterAgentPendingMessage,
} from "#/lib/organizations/center-agent-pending-message";

/** Before Space admission, cancellation withdraws the local queued send. */
export function usePendingCenterAgentSend(
	scope: CenterAgentPendingMessageScope
) {
	const queryClient = useQueryClient();
	const active = useRef<{ cancelled: boolean } | null>(null);
	const filesRef = useRef<SpaceComposerFilesController | null>(null);
	const [preparing, setPreparing] = useState<PendingCenterAgentMessage | null>(
		null
	);
	const [stopped, setStopped] = useState<PendingCenterAgentMessage | null>(
		null
	);
	const [error, setError] = useState<string | null>(null);
	useEffect(
		() => () => {
			if (active.current) {
				active.current.cancelled = true;
			}
		},
		[]
	);

	const send = async (
		text: string,
		files: SpaceComposerFilesController,
		draftUpdatedAtMs: number
	) => {
		if (
			active.current ||
			readCenterAgentPendingMessage(queryClient, scope) ||
			!(text.trim() || files.files.length)
		) {
			return;
		}
		const attempt = { cancelled: false };
		active.current = attempt;
		filesRef.current = files;
		const message = createPendingCenterAgentMessage(text.trim());
		message.createdAtMs = Math.max(message.createdAtMs, draftUpdatedAtMs);
		setPreparing(message);
		setStopped(null);
		setError(null);
		let claimed: ReturnType<typeof files.claimSubmissionDrafts> = [];
		try {
			await files.waitForDiscovery();
			if (attempt.cancelled) {
				return;
			}
			claimed = files.claimSubmissionDrafts();
			writeCenterAgentPendingMessage(queryClient, scope, {
				...message,
				fileDrafts: claimed,
				files: claimed.map((draft) => draft.file),
			});
		} catch (cause) {
			files.finishSubmission(
				files.getSubmissionFiles({ ids: claimed.map((draft) => draft.id) })
			);
			if (!attempt.cancelled) {
				setError(
					cause instanceof Error
						? cause.message
						: "Couldn't prepare your attachments. Try again."
				);
			}
		} finally {
			if (active.current === attempt) {
				active.current = null;
				setPreparing(null);
			}
		}
	};

	const stop = () => {
		const message =
			preparing ?? readCenterAgentPendingMessage(queryClient, scope);
		if (!message) {
			return;
		}
		if (active.current) {
			active.current.cancelled = true;
		}
		active.current = null;
		clearCenterAgentPendingMessage(queryClient, scope);
		const files = filesRef.current;
		if (files && message.fileDrafts?.length) {
			files.finishSubmission(
				files.getSubmissionFiles({
					ids: message.fileDrafts.map((draft) => draft.id),
				})
			);
		}
		setPreparing(null);
		setStopped(message);
	};
	return { error, preparing, send, stop, stopped };
}
