import { type ComponentProps, useDeferredValue } from "react";
import { SpaceLanding } from "./space-landing";
import { SpaceLandingLoadingShell } from "./space-state-surfaces";
import { useSpacePanelWidth } from "./use-space-panel-width";

type SpaceLandingProps = ComponentProps<typeof SpaceLanding>;

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
 * Each Space and Profile pair owns a separately keyed conversation, so
 * per-Space state (drafts, open Thread, selection, pending uploads, reading
 * position, live subscriptions) can never leak into another Space.
 *
 * Every switch, fresh route mount, or quick return to a Space first commits
 * only the shell: the URL, the sidebar selection, and a lightweight
 * conversation frame. The conversation then mounts in a deferred render that
 * React time-slices, instead of one long blocking frame. The leaving Space
 * unmounts in that first commit on purpose: kept visible, its live updates
 * (agent streams render every 100ms) would keep interrupting and restarting
 * the deferred render until React expires it.
 */
export function DeferredSpaceLanding(input: SpaceLandingProps) {
	return (
		<DeferredSpaceConversation
			key={`${input.spaceId}:${input.profileId}`}
			{...input}
		/>
	);
}

function DeferredSpaceConversation(input: SpaceLandingProps) {
	// Starts false on every mount, so the conversation always arrives in the
	// deferred render. Only a creation handoff mounts its conversation directly
	// so the drafted first message never blinks out between the two surfaces.
	const conversationReady = useDeferredValue(true, hasCreationHandoff(input));
	if (!conversationReady) {
		return (
			<SpaceConversationSwitchFrame
				spaceId={input.spaceId}
				threadOpen={Boolean(input.initialFocusThreadRootSignalId)}
			/>
		);
	}
	return <SpaceLanding {...input} />;
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
