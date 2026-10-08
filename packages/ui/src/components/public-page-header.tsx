import type { ReactNode } from "react";
import { AppBrandStatusLabel } from "#components/app-brand-status-label";
import { buttonVariants } from "#components/button";
import { OpenMeldLogoStrong } from "#components/openmeld-logo-strong";
import {
  APP_PAGE_FRAME_CLASS_NAME,
  APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#lib/page-frame";
import { cn } from "#lib/utils";

export type PublicPageHeaderProps = {
  appEntryPath: string | null;
  appEntryLabel?: string;
  appEntryClassName?: string;
  brandLinkClassName?: string;
  brandHref?: string;
  className?: string;
  statusLabel?: string | null;
  navigationSlot?: ReactNode;
  appEntrySlot?: ReactNode;
};

export function PublicPageHeader({
  appEntryPath,
  appEntryLabel = "Log in",
  appEntryClassName,
  brandLinkClassName,
  brandHref = "/",
  className,
  statusLabel = null,
  navigationSlot,
  appEntrySlot,
}: PublicPageHeaderProps) {
  return (
    <header
      className={cn(
        "border-foreground/10 border-b bg-background/96 backdrop-blur-sm",
        className
      )}
    >
      <div
        className={`mx-auto flex w-full flex-wrap items-center gap-4 py-3 ${APP_PAGE_FRAME_PADDING_CLASS_NAME} ${APP_PAGE_FRAME_CLASS_NAME}`}
      >
        <a
          aria-label="Go to OpenMeld homepage"
          className={cn(
            "inline-flex min-h-9 min-w-0 touch-manipulation items-center gap-2 max-lg:min-h-11",
            brandLinkClassName
          )}
          href={brandHref}
        >
          <OpenMeldLogoStrong
            ariaLabel="OpenMeld"
            size="clamp(3px, 0.95vw, 4px)"
          />
          <AppBrandStatusLabel label={statusLabel} />
        </a>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {navigationSlot}
          {appEntryPath
            ? (appEntrySlot ?? (
                <a
                  className={cn(
                    buttonVariants({
                      className: "rounded-md",
                      size: "sm",
                      variant: "outline",
                    }),
                    appEntryClassName
                  )}
                  href={appEntryPath}
                >
                  {appEntryLabel}
                </a>
              ))
            : null}
        </div>
      </div>
    </header>
  );
}
