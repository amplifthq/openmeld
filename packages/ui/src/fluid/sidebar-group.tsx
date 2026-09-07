"use client";
import { CaretRightIcon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
// Fluid Functionalism Sidebar, Base UI registry, retrieved 2026-09-05.
// https://www.fluidfunctionalism.com/r/base/sidebar.json
import {
  Children,
  type CSSProperties,
  cloneElement,
  createContext,
  type ElementType,
  forwardRef,
  type HTMLAttributes,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type Ref,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useShape } from "#lib/shape-context";
import { springs as spring } from "#lib/springs";
import { cn } from "#lib/utils";

const EVENT_HANDLER_PATTERN = /^on[A-Z]/;

type SidebarSectionProps = HTMLAttributes<HTMLDivElement>;
type SlotProps = {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & Record<string, unknown>;

function composeRefs<T>(...refs: (Ref<T> | undefined)[]): Ref<T> {
  return (node: T | null) => {
    for (const r of refs) {
      if (typeof r === "function") {
        r(node);
      } else if (r) {
        (r as React.MutableRefObject<T | null>).current = node;
      }
    }
  };
}

/** Resolves the element to clone: `render` wins, else `asChild`'s single
 *  element child. `content` is what should render inside it — for `asChild`
 *  the child element's own children, otherwise the caller's. */
export function resolveSlotTemplate(
  render: ReactElement | undefined,
  asChild: boolean | undefined,
  children: ReactNode
): { template: ReactElement<SlotProps> | null; content: ReactNode } {
  if (render && isValidElement(render)) {
    return { template: render as ReactElement<SlotProps>, content: children };
  }
  if (asChild) {
    const only = Children.toArray(children)[0];
    if (isValidElement(only)) {
      return {
        template: only as ReactElement<SlotProps>,
        content: (only.props as SlotProps).children,
      };
    }
  }
  return { template: null, content: children };
}

/** Renders `content` into the template element (merging class/style/handlers,
 *  composing refs) or into the default tag when there is no template. */
export function slotElement(
  template: ReactElement<SlotProps> | null,
  DefaultTag: ElementType,
  props: SlotProps & { ref?: Ref<HTMLElement> },
  content: ReactNode
): ReactElement {
  if (!template) {
    const Tag = DefaultTag as ElementType;
    return <Tag {...props}>{content}</Tag>;
  }
  const templateProps = template.props;
  const merged: SlotProps & { ref?: Ref<HTMLElement> } = {
    ...props,
    ...templateProps,
    className: cn(props.className, templateProps.className),
    style: {
      ...props.style,
      ...(templateProps.style as CSSProperties | undefined),
    },
  };
  // Chain duplicated event handlers, template's first (it owns the element).
  for (const key of Object.keys(props)) {
    if (!EVENT_HANDLER_PATTERN.test(key)) {
      continue;
    }
    const ours = props[key];
    const theirs = templateProps[key];
    if (typeof ours === "function" && typeof theirs === "function") {
      merged[key] = (...args: unknown[]) => {
        (theirs as (...a: unknown[]) => void)(...args);
        (ours as (...a: unknown[]) => void)(...args);
      };
    }
  }
  const templateRef = (templateProps as { ref?: Ref<HTMLElement> }).ref;
  merged.ref = composeRefs(props.ref, templateRef);
  return cloneElement(template, merged, content);
}

// ─── SidebarGroup family ─────────────────────────────────────────────────────

// SSR-safe layout effect (client components still server-render in Next).
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type SidebarGroupContextValue = {
  open: boolean;
  toggle: () => void;
  contentId: string;
  /** How many header action buttons overlay the label's right edge — the
   *  collapsible label pads itself so its chevron clears them. */
  actionsCount: number;
};

const SidebarGroupContext = createContext<SidebarGroupContextValue | null>(
  null
);

export interface SidebarGroupProps extends SidebarSectionProps {
  /** Makes the group's SidebarGroupLabel a toggle that collapses everything
   *  rendered after it — a group-level accordion. Uncontrolled by default;
   *  pass `open`/`onOpenChange` to control it. */
  collapsible?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const SidebarGroup = forwardRef<HTMLDivElement, SidebarGroupProps>(
  (
    {
      className,
      collapsible = false,
      open: openProp,
      defaultOpen = true,
      onOpenChange,
      children,
      ...props
    },
    ref
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Preserve upstream polymorphic composition for registry updates.
  ) => {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const open = openProp ?? uncontrolledOpen;
    const groupState = open ? "open" : "closed";
    const contentId = useId();
    const reduceMotion = useReducedMotion();
    const toggle = useCallback(() => {
      const next = !(openProp ?? uncontrolledOpen);
      setUncontrolledOpen(next);
      onOpenChange?.(next);
    }, [openProp, uncontrolledOpen, onOpenChange]);
    // Measured-height collapse: animate between 0 and the content's real
    // offsetHeight — never to "auto", which framer measures wrong under a
    // scaled ancestor.
    const contentRef = useRef<HTMLDivElement>(null);
    const [contentHeight, setContentHeight] = useState<number | null>(null);
    useIsoLayoutEffect(() => {
      if (!collapsible) {
        return;
      }
      const el = contentRef.current;
      if (!el || typeof ResizeObserver === "undefined") {
        return;
      }
      const measure = () => setContentHeight(el.offsetHeight);
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [collapsible]);
    const measured = contentHeight !== null;
    // The collapse wrapper must clip while animating, but a permanently
    // clipped box shaves the 2px focus ring off a group's first and last
    // rows — so clipping lifts once an open group has settled.
    const [settled, setSettled] = useState(open);
    useEffect(() => {
      if (!open) {
        setSettled(false);
      }
    }, [open]);

    // Height animates only when THIS group toggles. When the measured height
    // changes underneath it instead — a nested sub-menu collapsing inside the
    // group — the wrapper must snap: a spring re-targeted every frame chases
    // the child's own animation, lands well after it, and drags everything
    // below the group along late. Tracked with a ref so a controlled `open`
    // is covered too, and cleared once the toggle's animation lands.
    const prevOpenRef = useRef(open);
    const togglingRef = useRef(false);
    const shouldAnimate = prevOpenRef.current !== open || togglingRef.current;
    useIsoLayoutEffect(() => {
      if (prevOpenRef.current !== open) {
        prevOpenRef.current = open;
        togglingRef.current = true;
      }
    }, [open]);

    // The label and any header actions stay put; everything else after the
    // label rides in the collapse wrapper. If no SidebarGroupLabel child is
    // found the group renders untouched.
    const isHeaderAction = (k: ReactNode) =>
      isValidElement(k) &&
      (k.type === SidebarGroupAction || k.type === SidebarGroupActions);
    let inner: ReactNode = children;
    let actionsCount = 0;
    if (collapsible) {
      const kids = Children.toArray(children);
      const labelIdx = kids.findIndex(
        (k) => isValidElement(k) && k.type === SidebarGroupLabel
      );
      if (labelIdx !== -1) {
        const tail = kids.slice(labelIdx + 1);
        const headerActions = tail.filter(isHeaderAction);
        const rest = tail.filter((k) => !isHeaderAction(k));
        actionsCount = headerActions.reduce<number>(
          (n, k) =>
            n +
            (isValidElement(k) && k.type === SidebarGroupActions
              ? Children.count((k.props as { children?: ReactNode }).children)
              : 1),
          0
        );
        inner = (
          <>
            {kids.slice(0, labelIdx)}
            {/* Keep header actions anchored to the group on the row action axis. */}
            <div className="group/group-header w-full">
              {kids[labelIdx]}
              {headerActions}
            </div>
            <motion.div
              animate={
                measured
                  ? { height: open ? contentHeight : 0, opacity: open ? 1 : 0 }
                  : { opacity: open ? 1 : 0 }
              }
              aria-hidden={open ? undefined : true}
              className={cn(
                open && settled ? "overflow-visible" : "overflow-hidden",
                !(measured || open) && "h-0"
              )}
              id={contentId}
              inert={open ? undefined : true}
              initial={false}
              // Do NOT simplify this to `open ? spring.moderate : …`. The
              // togglingRef arm is what stops a re-measure from springing —
              // without it a nested collapse makes this wrapper chase its own
              // child and everything below the group moves late.
              onAnimationComplete={() => {
                togglingRef.current = false;
                if (open) {
                  setSettled(true);
                }
              }}
              transition={
                !reduceMotion && shouldAnimate
                  ? spring.moderate
                  : { duration: 0 }
              }
            >
              <div className="flex w-full min-w-0 flex-col" ref={contentRef}>
                {rest}
              </div>
            </motion.div>
          </>
        );
      }
    }

    const ctx = useMemo(
      () => ({ open, toggle, contentId, actionsCount }),
      [open, toggle, contentId, actionsCount]
    );

    return (
      <div
        className={cn("relative flex w-full min-w-0 flex-col p-2", className)}
        data-sidebar="group"
        data-state={collapsible ? groupState : undefined}
        ref={ref}
        {...props}
      >
        <SidebarGroupContext.Provider value={collapsible ? ctx : null}>
          {inner}
        </SidebarGroupContext.Provider>
      </div>
    );
  }
);
SidebarGroup.displayName = "SidebarGroup";

export interface SidebarGroupLabelProps extends HTMLAttributes<HTMLDivElement> {
  collapsedContent?: ReactNode;
  render?: ReactElement;
  asChild?: boolean;
}

const SidebarGroupLabel = forwardRef<HTMLDivElement, SidebarGroupLabelProps>(
  (
    { className, render, asChild, children, collapsedContent, ...props },
    ref
  ) => {
    const sizeVariant: string = "compact";
    const sizeClasses = { icon: 12 };
    const group = useContext(SidebarGroupContext);
    const reduceMotion = useReducedMotion();
    const shape = useShape();
    const ChevronRightIcon = CaretRightIcon;
    const { template, content } = resolveSlotTemplate(
      render,
      asChild,
      children
    );

    // Truncate only the leading text; element children (count badges,
    // trailing controls) stay flex siblings so the row's gap keeps spacing
    // them — same split MenuRowLabel does for menu rows.
    const nodes = Children.toArray(content);
    let textEnd = 0;
    while (
      textEnd < nodes.length &&
      (typeof nodes[textEnd] === "string" || typeof nodes[textEnd] === "number")
    ) {
      textEnd++;
    }
    const leadingText = nodes.slice(0, textEnd).join("");
    const labelContent = leadingText ? (
      <>
        <span className="min-w-0 truncate">{leadingText}</span>
        {nodes.slice(textEnd)}
      </>
    ) : (
      content
    );

    // Inside a collapsible group the label becomes the toggle. Design
    // hover only raises contrast; the compact chevron remains visible in both states.
    if (group) {
      return slotElement(
        template,
        "button",
        {
          ref: ref as Ref<HTMLElement>,
          type: template ? undefined : "button",
          "data-sidebar": "group-label",
          "aria-expanded": group.open,
          "aria-controls": group.contentId,
          onClick: group.toggle,
          // The action cluster overlays the label's right edge, so the label
          // pads past it — far enough that the chevron lands
          // one cluster gap (4px) to its left and the whole trailing run
          // keeps a single rhythm. Cluster width is 24px per action plus 4px
          // between them; add that gap again, less the 8px the group's
          // padding already gives back: 28n + 6. The cluster is always
          // visible, so the reservation is permanent.
          style:
            group.actionsCount > 0
              ? ({
                  "--group-actions-pad": `${group.actionsCount * 28 + 6}px`,
                } as CSSProperties)
              : undefined,
          className: cn(
            "flex h-8 w-full shrink-0 cursor-pointer select-none items-center gap-1 px-2 text-left text-muted-foreground/70 outline-none",
            "transition-colors duration-80 hover:text-muted-foreground motion-reduce:transition-none",
            group.actionsCount > 0 && "pr-[var(--group-actions-pad)]",
            "focus-visible:ring-1 focus-visible:ring-[color:var(--sidebar-ring)]",
            shape.item,
            sizeVariant === "compact" ? "text-[12px]" : "text-[12px]",
            className
          ),
          ...props,
        },
        <>
          {labelContent}
          {/* Keep the collapse affordance visible without changing label width. */}
          <span className="flex size-3 shrink-0 items-center justify-center">
            <motion.span
              animate={{ rotate: group.open ? 90 : 0 }}
              className="inline-flex"
              transition={reduceMotion ? { duration: 0 } : spring.fast}
            >
              <ChevronRightIcon
                className="shrink-0"
                size={sizeClasses.icon}
                strokeWidth={1.5}
              />
            </motion.span>
          </span>
          {!group.open && collapsedContent}
        </>
      );
    }

    return slotElement(
      template,
      "div",
      {
        ref: ref as Ref<HTMLElement>,
        "data-sidebar": "group-label",
        className: cn(
          "flex h-8 shrink-0 items-center gap-2 px-2 text-muted-foreground/70 outline-none",
          sizeVariant === "compact" ? "text-[12px]" : "text-[12px]",
          className
        ),
        ...props,
      },
      labelContent
    );
  }
);
SidebarGroupLabel.displayName = "SidebarGroupLabel";

export interface SidebarGroupActionProps
  extends HTMLAttributes<HTMLButtonElement> {
  render?: ReactElement;
  asChild?: boolean;
}

/** True while rendering inside a SidebarGroupActions cluster, where each
 *  action sits in the flex row instead of positioning itself absolutely. */
const GroupActionsContext = createContext(false);

const SidebarGroupAction = forwardRef<
  HTMLButtonElement,
  SidebarGroupActionProps
>(({ className, render, asChild, children, ...props }, ref) => {
  const shape = useShape();
  const sizeClasses = { icon: 16 };
  const inCluster = useContext(GroupActionsContext);
  const { template, content } = resolveSlotTemplate(render, asChild, children);
  return slotElement(
    template,
    "button",
    {
      ref: ref as Ref<HTMLElement>,
      type: template ? undefined : "button",
      "data-sidebar": "group-action",
      className: cn(
        inCluster
          ? "relative flex size-6 items-center justify-center text-muted-foreground outline-none"
          : // size-6 matches the rows' action hit-box, and right-3.5 puts that
            // 24px box's centre 26px from the sidebar's inner edge — the axis
            // the rows' badges and actions already sit on.
            "absolute top-3 right-3.5 flex size-6 items-center justify-center text-muted-foreground outline-none",
        "transition-colors duration-80 hover:bg-sidebar-accent hover:text-foreground motion-reduce:transition-none",
        "focus-visible:ring-1 focus-visible:ring-[color:var(--sidebar-ring)]",
        // Normalize bare icons to the site's 1.5 stroke (library defaults
        // vary), thickening to 2 on hover — the same treatment Button's
        // icon-only span applies.
        "motion-reduce:transition-none [&_svg]:size-[var(--icon-size)] [&_svg]:shrink-0 [&_svg]:stroke-[1.5] [&_svg]:transition-[stroke-width] [&_svg]:duration-80 hover:[&_svg]:stroke-[2]",
        shape.item,
        className
      ),
      ...props,
      // After ...props: the spread would otherwise replace this object
      // wholesale and drop the icon-size the glyph is sized from.
      style: {
        ...({ "--icon-size": `${sizeClasses.icon}px` } as CSSProperties),
        ...(props.style ?? {}),
      },
    },
    content
  );
});
SidebarGroupAction.displayName = "SidebarGroupAction";

/** Header action cluster: 1–3 SidebarGroupActions laid out in a row over the
 *  group label's right edge. Use instead of a lone SidebarGroupAction when a
 *  section needs several controls. */
export type SidebarGroupActionsProps = HTMLAttributes<HTMLDivElement>;

const SidebarGroupActions = forwardRef<
  HTMLDivElement,
  SidebarGroupActionsProps
>(({ className, children, ...props }, ref) => {
  return (
    <div
      className={cn(
        // right-3.5 lands the last 24px action's centre 26px from the
        // sidebar's inner edge — the rows' badge/action axis, so the header's
        // controls line up with the column below them.
        "absolute top-2 right-3.5 z-10 flex h-8 items-center gap-1",
        className
      )}
      data-sidebar="group-actions"
      ref={ref}
      {...props}
    >
      <GroupActionsContext.Provider value={true}>
        {children}
      </GroupActionsContext.Provider>
    </div>
  );
});
SidebarGroupActions.displayName = "SidebarGroupActions";

const SidebarGroupContent = forwardRef<HTMLDivElement, SidebarSectionProps>(
  ({ className, ...props }, ref) => (
    <div
      className={cn("w-full", className)}
      data-sidebar="group-content"
      ref={ref}
      {...props}
    />
  )
);
SidebarGroupContent.displayName = "SidebarGroupContent";

export {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarGroupAction,
  SidebarGroupActions,
};
