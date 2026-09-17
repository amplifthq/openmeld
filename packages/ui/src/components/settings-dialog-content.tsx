import type { ReactNode } from "react";
import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "#components/dialog";
import { DialogContent } from "#fluid/dialog";
import { ScrollArea } from "#fluid/scroll-area";
import { cn } from "#lib/utils";

/** Shared settings shell; each consumer owns its navigation and content. */
export function SettingsDialogContent({
  title,
  description,
  navigation,
  children,
  spacious = false,
  contentKey,
  scrollTestId,
}: {
  title: string;
  description: string;
  navigation: ReactNode;
  children: ReactNode;
  spacious?: boolean;
  contentKey?: string;
  scrollTestId?: string;
}) {
  return (
    <DialogContent
      className={cn(
        "flex h-[min(36rem,calc(100dvh-2rem))] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:flex-row",
        spacious && "h-[min(42rem,calc(100dvh-2rem))] sm:max-w-[1024px]"
      )}
      size="xl"
    >
      <aside
        className={cn(
          "flex max-h-[35%] shrink-0 flex-col border-border border-b p-4 sm:max-h-none sm:w-44 sm:border-r sm:border-b-0",
          spacious && "sm:w-56"
        )}
      >
        <DialogHeader className="mb-4 pr-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            {description}
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="min-h-0 flex-1" orientation="vertical">
          {navigation}
        </ScrollArea>
      </aside>
      <ScrollArea
        className="min-h-0 min-w-0 flex-1"
        contentClassName="space-y-5 p-5 sm:p-6"
        data-testid={scrollTestId}
        key={contentKey}
        orientation="vertical"
      >
        {children}
      </ScrollArea>
    </DialogContent>
  );
}
