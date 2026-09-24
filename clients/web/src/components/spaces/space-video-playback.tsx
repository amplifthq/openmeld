import { VideoPlayer } from "@openmeld/ui/components/video-player";
import { QueryClientContext } from "@tanstack/react-query";
import {
	type RefObject,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { buildWebSpaceVideoPath } from "#/lib/spaces/web-space-video-path";
import {
	type CachedSpaceFileContent,
	spaceFileMediaResources,
} from "#/query/spaces/space-file-media-resource";
import { spaceFileQueryKeys } from "#/query/spaces/space-files";
import type { SpaceVideoTarget } from "./space-video-preview";

export type VideoPlaybackSnapshot = {
	time: number;
	rate: number;
	volume: number;
	muted: boolean;
	playing: boolean;
};
export type SpaceVideoPlaybackProps = {
	fileName: string;
	compactControls?: boolean;
	idle?: boolean;
	onReady?: () => void;
	target?: SpaceVideoTarget;
	localPreviewUrl?: string | null;
	isLocal?: boolean;
	snapshot: RefObject<VideoPlaybackSnapshot>;
	videoRef: RefObject<HTMLVideoElement | null>;
	transferring: RefObject<boolean>;
	onRevoked: () => void;
};

let currentlyPlaying: HTMLVideoElement | null = null;

export function SpaceVideoPlayback(input: SpaceVideoPlaybackProps) {
	const client = useContext(QueryClientContext);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const resource = useMemo(() => {
		if (!client) {
			return undefined;
		}
		if (input.localPreviewUrl) {
			return spaceFileMediaResources(client).find(input.localPreviewUrl);
		}
		if (!input.target) {
			return undefined;
		}
		return client.getQueryData<CachedSpaceFileContent>(
			spaceFileQueryKeys.content(
				input.target.spaceId,
				input.target.fileId,
				input.target.revision
			)
		)?.mediaPreview;
	}, [client, input.localPreviewUrl, input.target]);
	const remoteSource =
		input.target && !input.isLocal
			? buildWebSpaceVideoPath(input.target)
			: null;
	const source = resource
		? resource.getSnapshot()
		: (input.localPreviewUrl ?? remoteSource);
	const revokedRef = useRef(input.onRevoked);
	revokedRef.current = input.onRevoked;
	const readyRef = useRef(input.onReady);
	readyRef.current = input.onReady;
	const targetRef = useRef(input.target);
	targetRef.current = input.target;
	// A user Retry is a new playback request even when its source is unchanged.
	const playbackRequest = useMemo(
		() => ({ source, attempt }),
		[source, attempt]
	);

	useEffect(() => {
		const source = playbackRequest.source;
		const video = input.videoRef.current;
		if (!(video && source)) {
			return;
		}
		let disposed = false;
		const revoke = () => {
			video.pause();
			video.removeAttribute("src");
			video.load();
			revokedRef.current();
		};
		const unsubscribeResource = resource?.subscribe(() => {
			if (!resource.getSnapshot()) {
				revoke();
			}
		});
		const unsubscribeScope = client
			? spaceFileMediaResources(client).subscribeRevocation((scope) => {
					const spaceId = targetRef.current?.spaceId ?? resource?.spaceId;
					if (
						(scope.spaceId === undefined || scope.spaceId === spaceId) &&
						(scope.fileId === undefined ||
							scope.fileId === targetRef.current?.fileId)
					) {
						revoke();
					}
				})
			: undefined;
		const initial = { ...input.snapshot.current };
		const restore = () => {
			if (disposed) {
				return;
			}
			video.currentTime = Math.min(
				initial.time,
				Number.isFinite(video.duration)
					? Math.max(0, video.duration - 0.01)
					: initial.time
			);
			video.playbackRate = initial.rate;
			video.volume = initial.volume;
			video.muted = initial.muted;
		};
		const play = () => {
			if (document.visibilityState === "hidden") {
				video.pause();
				return;
			}
			if (currentlyPlaying && currentlyPlaying !== video) {
				currentlyPlaying.pause();
			}
			currentlyPlaying = video;
		};
		const hidden = () => {
			if (document.visibilityState === "hidden") {
				video.pause();
			}
		};
		const error = () => {
			if (!disposed) {
				setFailed(true);
			}
		};
		const ready = () => readyRef.current?.();
		video.addEventListener("loadedmetadata", restore, { once: true });
		video.addEventListener("loadeddata", ready, { once: true });
		video.addEventListener("play", play);
		video.addEventListener("error", error);
		document.addEventListener("visibilitychange", hidden);
		// This component exists only following an explicit play/expand action.
		video.src = source;
		video.preload = "metadata";
		video.load();
		if (initial.playing && document.visibilityState !== "hidden") {
			video.play().catch((error: unknown) => {
				// Browsers may still require a second gesture when module loading
				// finishes after activation. Paused controls remain available.
				if (
					!(
						disposed ||
						(error instanceof DOMException &&
							(error.name === "NotAllowedError" || error.name === "AbortError"))
					)
				) {
					setFailed(true);
				}
			});
		}
		return () => {
			disposed = true;
			input.snapshot.current = {
				time: video.currentTime,
				rate: video.playbackRate,
				volume: video.volume,
				muted: video.muted,
				playing: input.transferring.current && !video.paused && !video.ended,
			};
			input.transferring.current = false;
			video.pause();
			video.removeEventListener("loadedmetadata", restore);
			video.removeEventListener("loadeddata", ready);
			video.removeEventListener("play", play);
			video.removeEventListener("error", error);
			document.removeEventListener("visibilitychange", hidden);
			if (currentlyPlaying === video) {
				currentlyPlaying = null;
			}
			video.removeAttribute("src");
			video.load();
			unsubscribeResource?.();
			unsubscribeScope?.();
		};
	}, [
		playbackRequest,
		client,
		resource,
		input.videoRef,
		input.snapshot,
		input.transferring,
	]);

	return (
		<div>
			<VideoPlayer
				compactControls={input.compactControls}
				idle={input.idle}
				title={input.fileName}
				videoProps={{}}
				videoRef={input.videoRef}
			/>
			{(failed || !source) && (
				<div
					className="space-y-2 border-border border-t p-4 text-sm"
					role="alert"
				>
					<p>
						This video couldn't be played. Its format may not be supported, or
						access may have changed.
					</p>
					<div className="flex gap-4 text-xs">
						<button
							className="font-medium underline underline-offset-4"
							onClick={() => {
								setFailed(false);
								setAttempt((value) => value + 1);
							}}
							type="button"
						>
							Retry
						</button>
						{source && (
							<a
								className="font-medium underline underline-offset-4"
								download={input.fileName}
								href={source}
							>
								Download original
							</a>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
