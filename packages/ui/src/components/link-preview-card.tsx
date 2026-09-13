import { GlobeIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { cn } from "#lib/utils";

const WWW_PREFIX = /^www\./;

export type LinkPreviewCardProps = {
  url: string;
  title?: string | null;
  description?: string | null;
  siteName?: string | null;
  image?: string | null;
  icon?: string | null;
  compact?: boolean;
  className?: string;
};

/** Presentation only. The caller supplies authorized metadata and mediated media. */
export function LinkPreviewCard(props: LinkPreviewCardProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const domain = new URL(props.url).hostname.replace(WWW_PREFIX, "");
  const label = props.title || domain;
  if (!props.title) {
    return (
      <a
        className={cn(
          "flex w-fit max-w-sm items-center gap-1.5 border-border/70 border-l-2 pl-3 text-muted-foreground text-sm leading-5 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          props.className
        )}
        data-slot="link-preview-card"
        href={props.url}
        onClick={(event) => event.stopPropagation()}
        rel="noopener noreferrer"
        target="_blank"
      >
        <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">
          {domain}
          {new URL(props.url).pathname === "/"
            ? ""
            : new URL(props.url).pathname}
        </span>
      </a>
    );
  }
  return (
    <div
      className={cn(
        "w-full max-w-sm border-border/70 border-l-2 pl-3 text-left text-sm leading-5",
        props.className
      )}
      data-slot="link-preview-card"
    >
      <div className="mb-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs leading-5">
        {props.icon && props.icon !== failedIcon ? (
          // biome-ignore lint/performance/noImgElement: Shared client primitive displays already mediated image bytes.
          // biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError handles an image load failure, not user input.
          <img
            alt=""
            className="size-3.5 shrink-0 object-contain"
            height={14}
            onError={() => setFailedIcon(props.icon ?? null)}
            src={props.icon}
            width={14}
          />
        ) : (
          <GlobeIcon aria-hidden="true" className="size-3.5 shrink-0" />
        )}
        <span className="truncate">{props.siteName || domain}</span>
        {props.siteName && props.siteName.toLowerCase() !== domain ? (
          <span className="truncate text-muted-foreground/70">· {domain}</span>
        ) : null}
      </div>
      <a
        aria-label={label}
        className="block rounded-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={props.url}
        onClick={(event) => event.stopPropagation()}
        rel="noopener noreferrer"
        target="_blank"
      >
        <span className="line-clamp-2 break-words font-medium">{label}</span>
      </a>
      {props.description && !props.compact ? (
        <p className="mt-0.5 line-clamp-2 break-words text-muted-foreground">
          {props.description}
        </p>
      ) : null}
      {props.image && props.image !== failedImage && !props.compact ? (
        <a
          aria-label={label}
          className="mt-2 block w-fit max-w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={props.url}
          onClick={(event) => event.stopPropagation()}
          rel="noopener noreferrer"
          tabIndex={-1}
          target="_blank"
        >
          {/* biome-ignore lint/performance/noImgElement: Shared client primitive displays already mediated image bytes. */}
          {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: onError handles image load failure. */}
          <img
            alt=""
            className="h-auto max-h-32 w-auto max-w-full object-contain object-left"
            height={128}
            loading="lazy"
            onError={() => setFailedImage(props.image ?? null)}
            src={props.image}
            width={384}
          />
        </a>
      ) : null}
    </div>
  );
}
