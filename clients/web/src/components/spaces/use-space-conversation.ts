import type {
	SpaceAgentStreamDeltaFrame,
	SpaceAgentStreamPartFrame,
	SpaceAgentStreamPresence,
	SpaceAgentStreamSnapshot,
	SpaceAgentStreamTerminalFrame,
} from "@openmeld/schemas/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
	applySpaceConversationStreamFrame,
	clearSpaceConversationTransientStreams,
	listVisibleSpaceConversationStreams,
	reconcileSpaceConversationStreamSnapshots,
	type SpaceConversationStreamState,
} from "#/lib/spaces/conversation-stream";
import {
	setSpaceConversationStreams,
	spaceWakeProgressPresentationQueryOptions,
} from "#/query/spaces/active-wake-progress";

const AGENT_STREAM_RENDER_INTERVAL_MS = 100;

type AgentStreamFrame =
	| SpaceAgentStreamDeltaFrame
	| SpaceAgentStreamPartFrame
	| SpaceAgentStreamTerminalFrame;

export function useSpaceConversation(input: {
	initialAgentStreamPresences?: readonly SpaceAgentStreamPresence[];
	initialAgentStreams: readonly SpaceAgentStreamSnapshot[];
	spaceId: string;
	openMeldProfileId: string;
}) {
	const queryClient = useQueryClient();
	const { data: presentation } = useQuery(
		spaceWakeProgressPresentationQueryOptions(input)
	);
	const streamState = presentation.streams;
	const setStreamState = useCallback(
		(
			update: (
				current: SpaceConversationStreamState
			) => SpaceConversationStreamState
		) =>
			setSpaceConversationStreams({
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.openMeldProfileId,
				update,
			}),
		[queryClient, input.spaceId, input.openMeldProfileId]
	);
	const initialAgentStreamPresencesRef = useRef(
		input.initialAgentStreamPresences ?? []
	);
	const initialAgentStreamsRef = useRef(input.initialAgentStreams);
	const identityRef = useRef({
		spaceId: input.spaceId,
		openMeldProfileId: input.openMeldProfileId,
	});
	const observedRevisionRef = useRef(0);
	const pendingDeltaFramesRef = useRef(
		new Map<string, SpaceAgentStreamDeltaFrame>()
	);
	const renderTimerRef = useRef<number | null>(null);
	const renderAnimationFrameRef = useRef<number | null>(null);
	const lastRenderAtMsRef = useRef(0);

	const cancelScheduledRender = useCallback(() => {
		if (renderTimerRef.current !== null) {
			window.clearTimeout(renderTimerRef.current);
			renderTimerRef.current = null;
		}
		if (renderAnimationFrameRef.current !== null) {
			window.cancelAnimationFrame(renderAnimationFrameRef.current);
			renderAnimationFrameRef.current = null;
		}
	}, []);

	const flushPendingDeltaFrames = useCallback(() => {
		renderAnimationFrameRef.current = window.requestAnimationFrame(() => {
			renderAnimationFrameRef.current = null;
			const frames = [...pendingDeltaFramesRef.current.values()].sort(
				(left, right) => left.sequence - right.sequence
			);
			pendingDeltaFramesRef.current.clear();
			if (frames.length === 0) {
				return;
			}
			lastRenderAtMsRef.current = Date.now();
			const observedFrames = frames.map((frame) => {
				observedRevisionRef.current += 1;
				return {
					frame,
					observedRevision: observedRevisionRef.current,
				};
			});
			setStreamState((current) => {
				let next = seedSpaceConversationStreams(
					current,
					initialAgentStreamPresencesRef.current,
					initialAgentStreamsRef.current
				);
				for (const { frame, observedRevision } of observedFrames) {
					next = applySpaceConversationStreamFrame({
						current: next,
						frame,
						observedRevision,
					});
				}
				return next;
			});
		});
	}, [setStreamState]);

	const scheduleDeltaRender = useCallback(() => {
		if (
			renderTimerRef.current !== null ||
			renderAnimationFrameRef.current !== null
		) {
			return;
		}
		const delayMs = Math.max(
			0,
			lastRenderAtMsRef.current + AGENT_STREAM_RENDER_INTERVAL_MS - Date.now()
		);
		if (delayMs === 0) {
			flushPendingDeltaFrames();
			return;
		}
		renderTimerRef.current = window.setTimeout(() => {
			renderTimerRef.current = null;
			flushPendingDeltaFrames();
		}, delayMs);
	}, [flushPendingDeltaFrames]);

	const handleAgentStreamFrame = useCallback(
		(frame: AgentStreamFrame) => {
			if (frame.spaceId !== identityRef.current.spaceId) {
				return;
			}
			if (frame.type === "space.agent_stream_delta") {
				const pendingKey = buildPendingDeltaFrameKey(frame);
				const pending = pendingDeltaFramesRef.current.get(pendingKey);
				if (!pending || frame.sequence > pending.sequence) {
					pendingDeltaFramesRef.current.set(pendingKey, frame);
				}
				scheduleDeltaRender();
				return;
			}

			const pendingDeltas = takePendingDeltaFramesForStream(
				pendingDeltaFramesRef.current,
				frame.streamId
			);
			setStreamState((current) => {
				let next = seedSpaceConversationStreams(
					current,
					initialAgentStreamPresencesRef.current,
					initialAgentStreamsRef.current
				);
				for (const pendingDelta of pendingDeltas) {
					observedRevisionRef.current += 1;
					next = applySpaceConversationStreamFrame({
						current: next,
						frame: pendingDelta,
						observedRevision: observedRevisionRef.current,
					});
				}
				observedRevisionRef.current += 1;
				return applySpaceConversationStreamFrame({
					current: next,
					frame,
					observedRevision: observedRevisionRef.current,
				});
			});
		},
		[scheduleDeltaRender, setStreamState]
	);

	useEffect(() => {
		initialAgentStreamPresencesRef.current =
			input.initialAgentStreamPresences ?? [];
	}, [input.initialAgentStreamPresences]);

	useEffect(() => {
		initialAgentStreamsRef.current = input.initialAgentStreams;
	}, [input.initialAgentStreams]);

	useEffect(() => {
		identityRef.current = {
			spaceId: input.spaceId,
			openMeldProfileId: input.openMeldProfileId,
		};
		observedRevisionRef.current = Math.max(
			0,
			...(
				queryClient.getQueryData(
					spaceWakeProgressPresentationQueryOptions({
						spaceId: input.spaceId,
						openMeldProfileId: input.openMeldProfileId,
					}).queryKey
				)?.streams ?? []
			).map((stream) => stream.observedRevision)
		);
		pendingDeltaFramesRef.current.clear();
		lastRenderAtMsRef.current = 0;
		cancelScheduledRender();

		return () => {
			pendingDeltaFramesRef.current.clear();
			cancelScheduledRender();
		};
	}, [
		cancelScheduledRender,
		input.spaceId,
		input.openMeldProfileId,
		queryClient,
	]);

	const clearTransientStreams = useCallback(() => {
		// Socket replacement does not change the conversation's identity. Only an
		// explicit access boundary clears already displayed work during recovery.
		pendingDeltaFramesRef.current.clear();
		lastRenderAtMsRef.current = 0;
		cancelScheduledRender();
		setStreamState((current) =>
			clearSpaceConversationTransientStreams(current)
		);
	}, [cancelScheduledRender, setStreamState]);

	const seededStreamState = useMemo(
		() =>
			seedSpaceConversationStreams(
				streamState,
				input.initialAgentStreamPresences ?? [],
				input.initialAgentStreams
			),
		[input.initialAgentStreamPresences, input.initialAgentStreams, streamState]
	);

	const agentStreamProjections = useMemo(
		() =>
			listVisibleSpaceConversationStreams(seededStreamState).filter(
				(projection) => projection.spaceId === input.spaceId
			),
		[input.spaceId, seededStreamState]
	);

	return {
		agentStreamProjections,
		clearTransientStreams,
		handleAgentStreamFrame,
	};
}

function buildPendingDeltaFrameKey(frame: SpaceAgentStreamDeltaFrame): string {
	const kind = frame.kind ?? "text";
	return `${frame.streamId}:${kind}`;
}

function takePendingDeltaFramesForStream(
	pending: Map<string, SpaceAgentStreamDeltaFrame>,
	streamId: string
): SpaceAgentStreamDeltaFrame[] {
	const frames: SpaceAgentStreamDeltaFrame[] = [];
	for (const [key, frame] of pending) {
		if (frame.streamId === streamId) {
			frames.push(frame);
			pending.delete(key);
		}
	}
	return frames.sort((left, right) => left.sequence - right.sequence);
}

function seedSpaceConversationStreams(
	current: SpaceConversationStreamState,
	presences: readonly SpaceAgentStreamPresence[],
	snapshots: readonly SpaceAgentStreamSnapshot[]
): SpaceConversationStreamState {
	return reconcileSpaceConversationStreamSnapshots({
		current,
		presences,
		requestStartedRevision: 0,
		snapshots,
	});
}
