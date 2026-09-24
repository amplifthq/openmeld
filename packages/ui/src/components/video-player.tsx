"use client";

import {
  MediaControlBar,
  MediaController,
  MediaFullscreenButton,
  MediaMuteButton,
  MediaPlayButton,
  MediaPlaybackRateButton,
  MediaTimeDisplay,
  MediaTimeRange,
  MediaVolumeRange,
} from "media-chrome/react";
import type { ComponentProps, CSSProperties, Ref } from "react";
import { cn } from "#lib/utils";

// Media Chrome owns media controls and accessibility. This small composition
// follows Kibo UI's token-based approach without a second theme or glass layer.
const playerStyle = {
  "--media-primary-color": "var(--foreground)",
  "--media-secondary-color": "var(--background)",
  "--media-control-background": "var(--background)",
  "--media-control-hover-background": "var(--accent)",
  "--media-range-track-background": "var(--muted)",
  "--media-range-bar-color": "var(--foreground)",
  "--media-font-family": "var(--font-sans)",
  "--media-font-size": "12px",
  "--media-icon-size": "20px",
} as CSSProperties;

export function VideoPlayer(input: {
  title: string;
  videoRef: Ref<HTMLVideoElement>;
  videoProps: Omit<ComponentProps<"video">, "ref" | "children">;
  className?: string;
}) {
  return (
    <MediaController
      aria-label={`Video player: ${input.title}`}
      className={cn(
        "block w-full overflow-hidden rounded-md bg-background text-foreground",
        input.className
      )}
      noHotkeys
      style={playerStyle}
    >
      {/* Uploaded originals may not include a caption track; never fabricate one. */}
      <video
        {...input.videoProps}
        aria-label={input.title}
        className="block aspect-video max-h-[75dvh] w-full bg-black object-contain"
        playsInline
        preload="none"
        ref={input.videoRef}
        slot="media"
      />
      <MediaControlBar className="w-full border-border border-t">
        <MediaTimeRange className="w-full" />
      </MediaControlBar>
      <MediaControlBar className="flex w-full items-center">
        <MediaPlayButton />
        <MediaMuteButton />
        <MediaVolumeRange className="hidden max-w-20 sm:block" />
        <MediaTimeDisplay showDuration />
        <span className="flex-1" />
        <MediaPlaybackRateButton />
        <MediaFullscreenButton />
      </MediaControlBar>
    </MediaController>
  );
}
