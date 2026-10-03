import { AppBrandStatusLabel } from "#components/app-brand-status-label";
import { buttonVariants } from "#components/button";
import { OpenMeldWordmark } from "#components/openmeld-wordmark";
import {
  APP_PAGE_FRAME_CLASS_NAME,
  APP_PAGE_FRAME_PADDING_CLASS_NAME,
} from "#lib/page-frame";
import { cn } from "#lib/utils";

export type PublicPageHeaderProps = {
  appEntryPath: string;
  appEntryLabel?: string;
  appEntryClassName?: string;
  brandLinkClassName?: string;
  brandHref?: string;
  className?: string;
  statusLabel?: string | null;
};

export function PublicPageHeader({
  appEntryPath,
  appEntryLabel = "Log in",
  appEntryClassName,
  brandLinkClassName,
  brandHref = "/",
  className,
  statusLabel = "Experimental",
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
            "inline-flex min-w-0 touch-manipulation items-center gap-2 max-lg:min-h-11",
            brandLinkClassName
          )}
          href={brandHref}
        >
          <OpenMeldWordmark className="transition-colors duration-200 hover:text-foreground" />
          <AppBrandStatusLabel label={statusLabel} />
        </a>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
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
        </div>
      </div>
    </header>
  );
}
