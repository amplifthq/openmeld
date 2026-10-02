"use client";

import {
  type ComponentProps,
  createContext,
  useContext,
  useState,
} from "react";
import { ContextMenu, ContextMenuTrigger } from "#components/context-menu";
import { FluidDropdownMenuContent } from "#fluid/dropdown-menu";

const ContextMenuScope = createContext({ enabled: false, open: false });

/** Lets an action owner refresh eligibility when either menu entry opens. */
export function useFluidContextMenuOpen() {
  return useContext(ContextMenuScope).open;
}

/** Allows an action owner inside a card or message to supply its existing menu. */
export function FluidContextMenuScope({
  target,
  children,
  disabled = false,
}: {
  target: ComponentProps<typeof ContextMenuTrigger>["render"];
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ContextMenu onOpenChange={setOpen} open={open && !disabled}>
      <ContextMenuScope value={{ enabled: !disabled, open: open && !disabled }}>
        <ContextMenuTrigger
          className="select-auto"
          onContextMenu={(event) => {
            const element =
              event.target instanceof Element ? event.target : null;
            const selection = window.getSelection();
            if (
              disabled ||
              element?.closest(
                "input, textarea, select, [contenteditable=true]"
              ) ||
              (selection &&
                !selection.isCollapsed &&
                selection.anchorNode &&
                event.currentTarget.contains(selection.anchorNode))
            ) {
              event.preventBaseUIHandler();
              event.stopPropagation();
            }
          }}
          render={target}
        />
        {children}
      </ContextMenuScope>
    </ContextMenu>
  );
}

export function FluidContextMenuContent(
  props: ComponentProps<typeof FluidDropdownMenuContent>
) {
  const scoped = useContext(ContextMenuScope);
  return scoped.enabled ? <FluidDropdownMenuContent {...props} /> : null;
}

/** Right-click entry to the same Fluid menu used by an ordinary dropdown. */
export function FluidContextMenu({
  target,
  children,
  ...props
}: ComponentProps<typeof FluidDropdownMenuContent> & {
  target: ComponentProps<typeof ContextMenuTrigger>["render"];
}) {
  return (
    <FluidContextMenuScope target={target}>
      <FluidContextMenuContent {...props}>{children}</FluidContextMenuContent>
    </FluidContextMenuScope>
  );
}
