"use client";

// Adapted from Fluid Functionalism's Base UI ScrollArea (MIT).
import { ScrollArea as Primitive } from "@base-ui/react/scroll-area";
import type { ComponentProps, Ref } from "react";
import { cn } from "#lib/utils";

type ScrollAreaProps = ComponentProps<"div"> & {
  orientation?: "vertical" | "horizontal" | "both";
  viewportClassName?: string;
  contentClassName?: string;
  viewportRef?: Ref<HTMLDivElement>;
  viewportProps?: ComponentProps<typeof Primitive.Viewport>;
  scrollFade?: boolean;
};

function ScrollArea({
  children,
  className,
  orientation = "vertical",
  viewportClassName,
  contentClassName,
  viewportRef,
  viewportProps,
  scrollFade = true,
  ...props
}: ScrollAreaProps) {
  return (
    <Primitive.Root
      data-slot="scroll-area"
      {...props}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
        className
      )}
    >
      <ScrollAreaViewport
        {...viewportProps}
        className={viewportClassName}
        data-fade={scrollFade || undefined}
        data-orientation={orientation}
        data-slot="scroll-area-viewport"
        ref={viewportRef}
        style={{
          overflowX: orientation === "vertical" ? "hidden" : undefined,
          overflowY: orientation === "horizontal" ? "hidden" : undefined,
          ...viewportProps?.style,
        }}
      >
        <Primitive.Content
          className={cn("min-h-full min-w-0", contentClassName)}
          style={orientation === "vertical" ? { minWidth: 0 } : undefined}
        >
          {children}
        </Primitive.Content>
      </ScrollAreaViewport>
      {orientation !== "horizontal" && <ScrollBar orientation="vertical" />}
      {orientation !== "vertical" && <ScrollBar orientation="horizontal" />}
      {orientation === "both" && <Primitive.Corner />}
    </Primitive.Root>
  );
}

const ScrollAreaRoot = Primitive.Root;
const ScrollAreaContent = Primitive.Content;
function ScrollAreaViewport({
  className,
  ...props
}: Omit<ComponentProps<typeof Primitive.Viewport>, "className"> & {
  className?: string;
}) {
  return (
    <Primitive.Viewport
      data-fade="true"
      {...props}
      className={cn(
        "fluid-scroll-viewport size-full min-h-0 min-w-0 flex-1 rounded-[inherit] outline-none focus-visible:outline-2 focus-visible:outline-ring",
        className
      )}
    />
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ComponentProps<typeof Primitive.Scrollbar>) {
  return (
    <Primitive.Scrollbar
      {...props}
      className={cn(
        "group/scrollbar absolute z-20 flex touch-none select-none opacity-0 transition-opacity delay-160 duration-120 ease-out data-hovering:opacity-100 data-scrolling:opacity-100 data-hovering:delay-0 data-scrolling:delay-0 motion-reduce:transition-none [@media(pointer:coarse)]:hidden",
        orientation === "vertical"
          ? "top-0 right-0 h-full w-2.5"
          : "bottom-0 left-0 h-2.5 w-full flex-col",
        className
      )}
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
    >
      <Primitive.Thumb
        className={cn(
          "relative rounded-md bg-foreground/[0.08] transition-[background-color,width,height] duration-160 ease-in-out active:bg-foreground/[0.16] group-hover/scrollbar:bg-foreground/[0.12] motion-reduce:transition-none",
          orientation === "vertical"
            ? "mx-auto my-1 h-(--scroll-area-thumb-height) w-1 -translate-x-0.5 group-hover/scrollbar:w-1.5"
            : "mx-1 my-auto h-1 w-(--scroll-area-thumb-width) -translate-y-0.5 group-hover/scrollbar:h-1.5"
        )}
        data-slot="scroll-area-thumb"
      />
    </Primitive.Scrollbar>
  );
}

export {
  ScrollArea,
  ScrollBar,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaContent,
};
export type { ScrollAreaProps };
