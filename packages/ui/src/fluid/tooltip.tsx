"use client";

// Adapted from https://www.fluidfunctionalism.com/r/base/tooltip.json.
// Compound slots preserve existing render composition and one Base UI owner.
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { domAnimation, LazyMotion, m, useReducedMotion } from "framer-motion";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useId,
} from "react";
import { fontWeights } from "#lib/font-weight";
import { useShape } from "#lib/shape-context";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

const TooltipTimingContext = createContext({ delay: 500, closeDelay: 0 });
const TooltipIdContext = createContext<string | undefined>(undefined);

function TooltipProvider({
  delay = 500,
  closeDelay = 0,
  children,
}: TooltipPrimitive.Provider.Props) {
  return (
    <TooltipTimingContext.Provider value={{ delay, closeDelay }}>
      {children}
    </TooltipTimingContext.Provider>
  );
}

function Tooltip(props: TooltipPrimitive.Root.Props) {
  const timing = useContext(TooltipTimingContext);
  const id = useId();
  const root = (
    <TooltipIdContext.Provider value={id}>
      <TooltipPrimitive.Root {...props} />
    </TooltipIdContext.Provider>
  );
  // Independent delay groups keep adjacent hints from bypassing the 500ms wait.
  return (
    <TooltipPrimitive.Provider {...timing} timeout={0}>
      {root}
    </TooltipPrimitive.Provider>
  );
}

function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
  const id = useContext(TooltipIdContext);
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      {...props}
      aria-describedby={
        [props["aria-describedby"], id].filter(Boolean).join(" ") || undefined
      }
    />
  );
}

function TooltipHint({
  content,
  children,
}: {
  content: ReactNode;
  children: ReactElement;
}) {
  return (
    <Tooltip disabled={!content}>
      <TooltipTrigger
        aria-description={typeof content === "string" ? content : undefined}
        render={children}
      />
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}

function TooltipContent({
  className,
  children,
  side = "top",
  sideOffset = 8,
  align = "center",
  alignOffset = 0,
  anchor,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<
    TooltipPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "anchor"
  >) {
  const shape = useShape();
  const reducedMotion = useReducedMotion();
  const id = useContext(TooltipIdContext);
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className="isolate z-50"
        side={side}
        sideOffset={sideOffset}
      >
        <TooltipPrimitive.Popup
          {...props}
          className="transition-opacity duration-150 data-ending-style:opacity-0"
          data-slot="tooltip-content"
          id={id}
          render={(popupProps, state) => {
            const offset = reducedMotion
              ? "none"
              : {
                  top: "translateY(4px)",
                  bottom: "translateY(-4px)",
                  left: "translateX(4px)",
                  right: "translateX(-4px)",
                  "inline-start": "translateX(4px)",
                  "inline-end": "translateX(-4px)",
                }[state.side];
            const hidden = { opacity: 0, transform: offset };
            return (
              <div {...popupProps}>
                <LazyMotion features={domAnimation}>
                  <m.div
                    animate={
                      state.transitionStatus === "ending"
                        ? hidden
                        : { opacity: 1, transform: "none" }
                    }
                    className={cn(
                      "inline-flex w-fit max-w-xs items-center gap-1.5 bg-foreground px-2 py-1 text-background text-xs [text-box:trim-both_cap_alphabetic] supports-[text-box:trim-both]:py-2",
                      shape.bg,
                      className
                    )}
                    initial={hidden}
                    style={{ fontVariationSettings: fontWeights.medium }}
                    transition={springs.fast}
                  >
                    {children}
                  </m.div>
                </LazyMotion>
              </div>
            );
          }}
          role="tooltip"
        />
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export {
  Tooltip,
  TooltipContent,
  TooltipHint,
  TooltipProvider,
  TooltipTrigger,
};
