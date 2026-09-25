"use client";

// Adapted from Fluid Functionalism's registry/blocks/sidebar-user-footer.tsx (MIT).
import { CaretUpDownIcon } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useState } from "react";
import { DropdownMenu, DropdownMenuTrigger } from "#components/dropdown-menu";
import { FluidDropdownMenuContent } from "#fluid/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "#fluid/sidebar-menu";
import { cn } from "#lib/utils";

type SidebarUserMenuProps = {
  name: string;
  avatar: ReactNode;
  menu: ReactNode;
  iconOnly?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
};

export function SidebarUserMenuItem({
  className,
  ...props
}: SidebarUserMenuProps & { className?: string }) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  const attachItem = useCallback((node: HTMLLIElement | null) => {
    if (node) {
      setPortalContainer(node.closest<HTMLElement>('[role="dialog"]'));
    }
  }, []);
  return (
    <SidebarMenuItem className={className} ref={attachItem}>
      <DropdownMenu onOpenChange={props.onOpenChange} open={props.open}>
        <DropdownMenuTrigger
          render={
            <SidebarMenuButton
              aria-label={
                props.triggerLabel ?? `Open user menu for ${props.name}`
              }
              className={cn(
                "h-8 gap-1.5",
                props.iconOnly && "size-9 justify-center px-0"
              )}
              isActive={props.open}
              tabIndex={0}
            >
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center",
                  props.iconOnly ? "size-9" : "size-5"
                )}
              >
                {props.avatar}
              </span>
              {!props.iconOnly && (
                <>
                  <span className="min-w-0 truncate text-[13px] text-foreground">
                    {props.name}
                  </span>
                  <CaretUpDownIcon
                    aria-hidden="true"
                    className="ml-auto size-3 shrink-0 text-muted-foreground"
                  />
                </>
              )}
            </SidebarMenuButton>
          }
        />
        <FluidDropdownMenuContent
          align="start"
          className="w-60"
          portalContainer={portalContainer ?? undefined}
          side="top"
          sideOffset={6}
        >
          {props.menu}
        </FluidDropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

export function SidebarUserFooter({
  className,
  ...props
}: SidebarUserMenuProps & { className?: string }) {
  return (
    <SidebarMenu aria-label="User" className={className}>
      <SidebarUserMenuItem {...props} />
    </SidebarMenu>
  );
}
