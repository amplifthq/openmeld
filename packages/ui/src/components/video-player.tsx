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
  "--media-primary-color": "white",
  "--media-secondary-color": "transparent",
  "--media-control-background": "transparent",
  "--media-control-hover-background": "rgb(0 0 0 / 18%)",
  "--media-range-track-background": "rgb(255 255 255 / 50%)",
  "--media-range-bar-color": "white",
  "--media-font-family": "var(--font-sans)",
} as CSSProperties;

export function VideoPlayer(input: {
  title: string;
  videoRef: Ref<HTMLVideoElement>;
  videoProps: Omit<ComponentProps<"video">, "ref" | "children">;
  className?: string;
  compactControls?: boolean;
  idle?: boolean;
}) {
  return (
    <MediaController
      aria-label={`Video player: ${input.title}`}
      className={cn(
        "block w-full overflow-hidden rounded-md bg-black text-white [--media-control-padding:2px] [--media-font-size:10px] [--media-icon-size:14px] sm:[--media-control-padding:4px] sm:[--media-font-size:12px] sm:[--media-icon-size:20px]",
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
      <MediaControlBar
        className={cn(
          "h-4 w-full bg-transparent px-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:h-5 sm:px-3",
          input.idle && "hidden"
        )}
      >
        <MediaTimeRange className="h-4 w-full sm:h-5" />
      </MediaControlBar>
      <MediaControlBar
        className={cn(
          "flex w-full items-center gap-1 bg-transparent px-2 pb-1 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] sm:gap-2 sm:px-3 sm:pb-2",
          input.idle && "hidden"
        )}
      >
        <MediaPlayButton className="rounded-md" />
        <MediaMuteButton className="rounded-md" />
        <MediaVolumeRange className="hidden max-w-20 sm:block" />
        <MediaTimeDisplay showDuration />
        <span className="flex-1" />
        {!input.compactControls && (
          <MediaPlaybackRateButton className="rounded-md" />
        )}
        {!input.compactControls && (
          <MediaFullscreenButton className="rounded-md" />
        )}
      </MediaControlBar>
    </MediaController>
  );
}
