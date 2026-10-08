"use client";

import { motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  forwardRef,
  type HTMLAttributes,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { createActiveItemStore } from "#lib/active-item-store";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

type SharedLayoutGroupContextValue = {
  activeItems: ReturnType<typeof createActiveItemStore<string>>;
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
  disabled?: boolean;
  indicatorClassName?: string;
  itemId: string;
};

const SharedLayoutGroupContext =
  createContext<SharedLayoutGroupContextValue | null>(null);
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

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
    const [activeItems] = useState(() => createActiveItemStore(activeItemId));
    useIsoLayoutEffect(() => {
      activeItems.set(activeItemId);
    }, [activeItems, activeItemId]);
    const context = useMemo(
      () => ({
        activeItems,
        indicatorLayoutId: `shared-layout-background-${generatedId}`,
        reduceMotion,
        setActiveItemId,
      }),
      [activeItems, generatedId, reduceMotion, setActiveItemId]
    );

    return (
      <SharedLayoutGroupContext.Provider value={context}>
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
      disabled = false,
      indicatorClassName,
      itemId,
      onFocus,
      onPointerEnter,
      ...props
    },
    ref
  ) => {
    const { activeItems, indicatorLayoutId, reduceMotion, setActiveItemId } =
      useSharedLayoutGroup();
    const subscribe = useCallback(
      (notify: () => void) => activeItems.subscribe(itemId, notify),
      [activeItems, itemId]
    );
    const getActive = useCallback(
      () => !disabled && activeItems.isActive(itemId),
      [activeItems, disabled, itemId]
    );
    const active = useSyncExternalStore(subscribe, getActive, getActive);

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
            setActiveItemId?.(disabled ? null : itemId);
          }}
          onPointerEnter={(event) => {
            onPointerEnter?.(event);
            setActiveItemId?.(disabled ? null : itemId);
          }}
          ref={ref}
        >
          {active ? (
            <motion.div
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-0 z-0 rounded-md bg-interaction-hover",
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
