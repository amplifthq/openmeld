import { cn } from "#lib/utils";

export const CARD_PICKER_GRID_CLASS_NAME =
  "grid grid-cols-[repeat(auto-fit,minmax(min(100%,24rem),1fr))] gap-3";

export function cardPickerCardClassName(input?: { muted?: boolean }) {
  return cn(
    "group flex h-full min-h-40 w-full flex-col rounded-md border border-border/70 bg-card p-0 text-left transition-[border-color,background-color] duration-150 hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    input?.muted && "border-dashed bg-muted/20"
  );
}

export const ADD_CARD_PICKER_CLASS_NAME =
  "group flex h-full min-h-40 w-full flex-col items-center justify-center gap-3 rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-6 text-center transition-[border-color,background-color] duration-150 hover:border-foreground/25 hover:bg-card/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
