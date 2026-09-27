import {
	MorphingDialog,
	MorphingDialogClose,
	MorphingDialogContainer,
	MorphingDialogContent,
	MorphingDialogFrame,
	MorphingDialogTitle,
	MorphingDialogTrigger,
} from "@openmeld/ui/components/morphing-dialog";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowsOutIcon, PlayIcon, XIcon } from "@phosphor-icons/react";
import { QueryClientContext } from "@tanstack/react-query";
import { type RefObject, useContext, useEffect, useRef, useState } from "react";
import { buildWebSpaceVideoPath } from "#/lib/spaces/web-space-video-path";
import { spaceFileMediaResources } from "#/query/spaces/space-file-media-resource";
import { loadSpaceVideoPlayback } from "./load-space-video-playback";
import { SPACE_ATTACHMENT_FRAME_CLASS } from "./space-attachment-strip";
import type {
	SpaceVideoPlaybackProps,
	VideoPlaybackSnapshot,
} from "./space-video-playback";
import { useSpaceImagePreviewSource } from "./use-space-image-preview-source";

// React's video attribute types lag the browser's native lazy-loading support.
const lazyVideoLoading = { loading: "lazy" } as const;

type Playback = typeof import("./space-video-playback").SpaceVideoPlayback;
let playbackModule: Promise<Playback> | undefined;
function loadPlayback(): Promise<Playback> {
	playbackModule ??= loadSpaceVideoPlayback().catch((error: unknown) => {
		playbackModule = undefined;
		throw error;
	});
	return playbackModule;
}

function usePreparedPlayback(posterRef: RefObject<HTMLVideoElement | null>) {
	const [component, setComponent] = useState<Playback | null>(null);
	useEffect(() => {
		const poster = posterRef.current;
		if (!poster) {
			return;
		}
		let cancelled = false;
		const prepare = () => {
			loadPlayback()
				.then((playback) => {
					if (!cancelled) {
						setComponent(() => playback);
					}
				})
				.catch(() => {
					// Explicit Play reports module-load failures with a retry path.
				});
		};
		poster.addEventListener("loadeddata", prepare, { once: true });
		if (poster.readyState >= 2) {
			prepare();
		}
		return () => {
			cancelled = true;
			poster.removeEventListener("loadeddata", prepare);
		};
	}, [posterRef]);
	return [component, setComponent] as const;
}

export type SpaceVideoTarget = {
	spaceId: string;
	fileId: string;
	revision: number;
	organizationSlug?: string;
};

function resolvePreviewSource(input: {
	localPreviewUrl?: string | null;
	target?: SpaceVideoTarget;
	isLocal?: boolean;
}) {
	if (input.localPreviewUrl) {
		return input.localPreviewUrl;
	}
	if (input.target && !input.isLocal) {
		return buildWebSpaceVideoPath(input.target);
	}
	return undefined;
}

/** Idle cards show a native first frame, then prepare a paused player for one-click playback. */
export function SpaceVideoPreview(input: {
	fileName: string;
	target?: SpaceVideoTarget;
	localPreviewUrl?: string | null;
	isLocal?: boolean;
	compact?: boolean;
	onOpenFile?: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [activation, setActivation] = useState(0);
	const active = activation > 0;
	const [inlineReady, setInlineReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [thumbnailRevoked, setThumbnailRevoked] = useState(false);
	const client = useContext(QueryClientContext);
	const thumbnailSource = useSpaceImagePreviewSource(
		resolvePreviewSource(input) ?? null
	);
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const posterVideoRef = useRef<HTMLVideoElement | null>(null);
	const [PlaybackComponent, setPlaybackComponent] =
		usePreparedPlayback(posterVideoRef);
	const transferring = useRef(false);
	const pendingOpenFile = useRef(false);
	const snapshot = useRef<VideoPlaybackSnapshot>({
		time: 0,
		rate: 1,
		volume: 1,
		muted: false,
		playing: false,
	});
	// Compact attachments do not mount a hidden player merely to own access.
	// Subscribe the native poster to the same account/Space/file revocations.
	useEffect(() => {
		if (!client) {
			return;
		}
		const resources = spaceFileMediaResources(client);
		const resource = input.localPreviewUrl
			? resources.find(input.localPreviewUrl)
			: undefined;
		return resources.subscribeRevocation((scope) => {
			const spaceId = input.target?.spaceId ?? resource?.spaceId;
			if (
				(scope.spaceId === undefined || scope.spaceId === spaceId) &&
				(scope.fileId === undefined || scope.fileId === input.target?.fileId)
			) {
				setThumbnailRevoked(true);
				const poster = posterVideoRef.current;
				poster?.removeAttribute("src");
				poster?.load();
			}
		});
	}, [
		client,
		input.localPreviewUrl,
		input.target?.spaceId,
		input.target?.fileId,
	]);

	useEffect(() => {
		if (activation === 0) {
			return;
		}
		let cancelled = false;
		loadPlayback()
			.then((component) => {
				if (!cancelled) {
					setPlaybackComponent(() => component);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setError("The video player couldn't load. Try again.");
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activation, setPlaybackComponent]);

	const remember = () => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		snapshot.current = {
			time: video.currentTime,
			rate: video.playbackRate,
			volume: video.volume,
			muted: video.muted,
			playing: !(video.paused || video.ended),
		};
	};
	const activate = () => {
		setError(null);
		snapshot.current.playing = true;
		videoRef.current?.play().catch(() => {
			// An early click can precede player readiness; mounted controls retry.
		});
		setActivation((value) => value + 1);
	};
	const changeOpen = (next: boolean) => {
		remember();
		if (next) {
			transferring.current = active;
			if (!active) {
				activate();
			}
		} else {
			transferring.current = false;
			videoRef.current?.pause();
			snapshot.current.playing = false;
			setActivation(0);
		}
		setOpen(next);
	};
	const playbackProps: SpaceVideoPlaybackProps = {
		compactControls: !open,
		idle: !active,
		fileName: input.fileName,
		target: input.target,
		localPreviewUrl: input.localPreviewUrl,
		isLocal: input.isLocal,
		snapshot,
		videoRef,
		transferring,
		onReady: () => setInlineReady(true),
		onRevoked: () => {
			setActivation(0);
			setOpen(false);
			setError("This video is no longer accessible.");
		},
	};
	const loading = (
		<div
			aria-live="polite"
			className="flex aspect-video items-center justify-center bg-muted text-muted-foreground text-sm"
		>
			Loading video…
		</div>
	);
	const previewSource = thumbnailRevoked ? null : thumbnailSource.source;
	const placeholder = (
		<SpaceVideoPoster
			compact={input.compact}
			fileName={input.fileName}
			hasPlayback={Boolean(PlaybackComponent)}
			inlineReady={inlineReady}
			onPlay={activate}
			open={open}
			posterRef={posterVideoRef}
			revoked={thumbnailRevoked || thumbnailSource.revoked}
			source={previewSource}
		/>
	);

	const playback = PlaybackComponent ? (
		<PlaybackComponent {...playbackProps} />
	) : (
		loading
	);
	let inlineContent = placeholder;
	if (!input.compact && active && !open && !error) {
		inlineContent = loading;
	}
	if (!(input.compact || open) && PlaybackComponent && !error) {
		inlineContent = playback;
	}
	return (
		<MorphingDialog
			onOpenChange={changeOpen}
			open={open}
			transition={{ duration: 0.2 }}
		>
			<MorphingDialogFrame
				className={cn(
					"group relative w-full overflow-hidden rounded-md border border-border bg-background",
					input.compact ? SPACE_ATTACHMENT_FRAME_CLASS : "w-full max-w-96"
				)}
			>
				{inlineContent}
				{!(input.compact || active || open) && PlaybackComponent && placeholder}
				{!input.compact && (
					<MorphingDialogTrigger
						aria-label={`Expand ${input.fileName}`}
						className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-md bg-black/35 text-white opacity-0 transition-opacity hover:bg-black/50 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-focus-within:opacity-100 group-hover:opacity-100 sm:top-2 sm:right-2 [@media(hover:none)]:opacity-100"
						disableLayoutAnimation
					>
						<ArrowsOutIcon aria-hidden="true" className="size-3.5" />
					</MorphingDialogTrigger>
				)}
			</MorphingDialogFrame>
			{error && !input.compact && (
				<p className="mt-2 text-destructive text-xs" role="alert">
					{error}
				</p>
			)}
			<MorphingDialogContainer
				backdropClassName="bg-black/70 backdrop-blur-none"
				onExitComplete={() => {
					if (pendingOpenFile.current) {
						pendingOpenFile.current = false;
						input.onOpenFile?.();
					}
				}}
			>
				<MorphingDialogContent className="w-[min(64rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-background shadow-xl">
					<div className="flex items-center gap-3 border-border border-b px-4 py-3">
						<MorphingDialogTitle className="min-w-0 flex-1 truncate font-medium text-sm">
							{input.fileName}
						</MorphingDialogTitle>
						{input.onOpenFile && (
							<button
								className="text-muted-foreground text-xs hover:text-foreground"
								onClick={() => {
									pendingOpenFile.current = true;
									changeOpen(false);
								}}
								type="button"
							>
								Open in Files
							</button>
						)}
						<MorphingDialogClose
							aria-label="Close video"
							className="static flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent"
						>
							<XIcon aria-hidden="true" className="size-4" />
						</MorphingDialogClose>
					</div>
					{active && open && !error ? playback : null}
					{error && (
						<div className="space-y-2 p-4 text-sm">
							<p className="text-destructive" role="alert">
								{error}
							</p>
							<button
								className="rounded-md px-2 py-1 underline focus-visible:ring-2 focus-visible:ring-ring"
								onClick={activate}
								type="button"
							>
								Retry
							</button>
						</div>
					)}
				</MorphingDialogContent>
			</MorphingDialogContainer>
		</MorphingDialog>
	);
}

function SpaceVideoPoster(input: {
	compact?: boolean;
	fileName: string;
	hasPlayback: boolean;
	inlineReady: boolean;
	open: boolean;
	onPlay: () => void;
	posterRef: RefObject<HTMLVideoElement | null>;
	revoked: boolean;
	source: string | null;
}) {
	return (
		<div
			className={cn(
				"relative flex flex-col items-center justify-center bg-muted text-muted-foreground",
				input.compact ? "size-full" : "aspect-video w-full",
				!input.compact &&
					input.hasPlayback &&
					!input.open &&
					"absolute inset-0 bg-transparent"
			)}
		>
			{input.source &&
				(!input.inlineReady || input.compact) &&
				!(input.compact && input.open) && (
					<video
						{...lazyVideoLoading}
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 size-full object-cover"
						muted
						playsInline
						preload="metadata"
						ref={input.posterRef}
						src={input.source}
						tabIndex={-1}
					/>
				)}
			{input.compact ? (
				<MorphingDialogTrigger
					aria-label={`Play ${input.fileName}`}
					className="absolute inset-0 flex size-full items-center justify-center rounded-[inherit] text-white drop-shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
					disabled={!input.source || input.revoked}
					disableLayoutAnimation
				>
					{input.revoked ? (
						<span className="p-1 text-xs">Video unavailable</span>
					) : (
						<PlayIcon aria-hidden="true" className="size-5" weight="fill" />
					)}
				</MorphingDialogTrigger>
			) : (
				<>
					<button
						aria-label={`Play ${input.fileName}`}
						className="relative flex size-10 items-center justify-center rounded-full bg-black/35 text-white hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-12"
						onClick={input.onPlay}
						type="button"
					>
						<PlayIcon
							aria-hidden="true"
							className="size-4 sm:size-5"
							weight="fill"
						/>
					</button>
					<span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-center text-white text-xs">
						{input.fileName}
					</span>
				</>
			)}
		</div>
	);
}
