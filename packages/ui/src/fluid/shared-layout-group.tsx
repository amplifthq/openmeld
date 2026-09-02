"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  use,
  useId,
  useState,
} from "react";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

type SharedLayoutGroupContextValue = {
  activeItemId: string | null;
  indicatorLayoutId: string;
  reduceMotion: boolean;
  setActiveItemId?: (itemId: string | null) => void;
};

type SharedLayoutGroupProps = HTMLAttributes<HTMLDivElement> & {
  activeItemId?: string | null;
  children: ReactNode;
  onActiveItemIdChange?: (itemId: string | null) => void;
};

type SharedLayoutItemProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  indicatorClassName?: string;
  itemId: string;
};

const SharedLayoutGroupContext =
  createContext<SharedLayoutGroupContextValue | null>(null);

function useSharedLayoutGroup() {
  const context = use(SharedLayoutGroupContext);
  if (!context) {
    throw new Error("SharedLayoutItem must be used within SharedLayoutGroup.");
  }
  return context;
}

const SharedLayoutGroup = forwardRef<HTMLDivElement, SharedLayoutGroupProps>(
  (
    {
      activeItemId: controlledActiveItemId,
      children,
      className,
      onActiveItemIdChange,
      onBlur,
      onPointerLeave,
      ...props
    },
    ref
  ) => {
    const [uncontrolledActiveItemId, setUncontrolledActiveItemId] = useState<
      string | null
    >(null);
    const activeItemId =
      controlledActiveItemId === undefined
        ? uncontrolledActiveItemId
        : controlledActiveItemId;
    const setActiveItemId =
      controlledActiveItemId === undefined
        ? setUncontrolledActiveItemId
        : onActiveItemIdChange;
    const generatedId = useId();
    const reduceMotion = useReducedMotion() === true;

    return (
      <SharedLayoutGroupContext.Provider
        value={{
          activeItemId,
          indicatorLayoutId: `shared-layout-background-${generatedId}`,
          reduceMotion,
          setActiveItemId,
        }}
      >
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the group owns shared hover and focus state for its child links and buttons. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: child links and buttons retain all activation semantics. */}
        <div
          {...props}
          className={cn("relative", className)}
          data-slot="shared-layout-group"
          onBlur={(event) => {
            onBlur?.(event);
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            ) {
              setActiveItemId?.(null);
            }
          }}
          onPointerLeave={(event) => {
            onPointerLeave?.(event);
            setActiveItemId?.(null);
          }}
          ref={ref}
        >
          {children}
        </div>
      </SharedLayoutGroupContext.Provider>
    );
  }
);

SharedLayoutGroup.displayName = "SharedLayoutGroup";

const SharedLayoutItem = forwardRef<HTMLDivElement, SharedLayoutItemProps>(
  (
    {
      children,
      className,
      indicatorClassName,
      itemId,
      onFocus,
      onPointerEnter,
      ...props
    },
    ref
  ) => {
    const { activeItemId, indicatorLayoutId, reduceMotion, setActiveItemId } =
      useSharedLayoutGroup();
    const active = activeItemId === itemId;

    return (
      <>
        {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: the wrapper only tracks hover and delegated focus for its interactive child. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: the child retains all activation semantics. */}
        <div
          {...props}
          className={cn("relative isolate", className)}
          data-active={active || undefined}
          data-slot="shared-layout-item"
          onFocus={(event) => {
            onFocus?.(event);
            setActiveItemId?.(itemId);
          }}
          onPointerEnter={(event) => {
            onPointerEnter?.(event);
            setActiveItemId?.(itemId);
          }}
          ref={ref}
        >
          {active ? (
            <motion.div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 z-0 rounded-md bg-muted/55",
                indicatorClassName
              )}
              data-slot="shared-layout-background"
              layoutId={indicatorLayoutId}
              transition={reduceMotion ? { duration: 0 } : springs.fast}
            />
          ) : null}
          <div className="relative z-10 h-full">{children}</div>
        </div>
      </>
    );
  }
);

SharedLayoutItem.displayName = "SharedLayoutItem";

export { SharedLayoutGroup, SharedLayoutItem };
