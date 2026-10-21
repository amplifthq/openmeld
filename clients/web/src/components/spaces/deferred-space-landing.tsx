import { type ComponentProps, useDeferredValue } from "react";
import { SpaceLanding } from "./space-landing";
import { SpaceLandingLoadingShell } from "./space-state-surfaces";
import { useSpacePanelWidth } from "./use-space-panel-width";

type SpaceLandingProps = ComponentProps<typeof SpaceLanding>;

const NO_CONVERSATION_KEY = "";

function hasCreationHandoff(input: SpaceLandingProps): boolean {
	return Boolean(
		input.initialPendingMessage ||
			input.onComposerReady ||
			input.onInitialPendingMessageConsumed
	);
}

/**
 * Switches the routed Space conversation as a deferred, interruptible render.
 *
 * Each Space and Profile pair still owns a separately keyed SpaceLanding, so
 * per-Space state (drafts, open Thread, selection, pending uploads, reading
 * position, live subscriptions) can never leak into another Space.
 *
 * A switch (or a fresh mount) first commits only the shell: the URL, the sidebar selection, and
 * a lightweight conversation frame. The next Space then mounts in a deferred
 * render that React time-slices, instead of one long blocking frame. The
 * leaving Space unmounts in that first commit on purpose: kept visible, its
 * live updates (agent streams render every 100ms) would keep interrupting and
 * restarting the deferred render until React expires it.
 */
export function DeferredSpaceLanding(input: SpaceLandingProps) {
	const conversationKey = `${input.spaceId}:${input.profileId}`;
	// A fresh mount (Space to Direct Message, or entering from another page) is
	// deferred too. Only a creation handoff mounts its conversation directly so
	// the drafted first message never blinks out between the two surfaces.
	const deferredConversationKey = useDeferredValue(
		conversationKey,
		hasCreationHandoff(input) ? conversationKey : NO_CONVERSATION_KEY
	);
	if (deferredConversationKey !== conversationKey) {
		return (
			<SpaceConversationSwitchFrame
				spaceId={input.spaceId}
				threadOpen={Boolean(input.initialFocusThreadRootSignalId)}
			/>
		);
	}
	return <SpaceLanding key={conversationKey} {...input} />;
}

function SpaceConversationSwitchFrame(input: {
	spaceId: string;
	threadOpen: boolean;
}) {
	const membersPanel = useSpacePanelWidth({
		panel: "members",
		spaceId: input.spaceId,
	});
	return (
		<SpaceLandingLoadingShell
			membersPanelWidth={membersPanel.width}
			spaceId={input.spaceId}
			threadOpen={input.threadOpen}
		/>
	);
}
