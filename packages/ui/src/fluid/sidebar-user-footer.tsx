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

export function SidebarUserFooter({
  name,
  avatar,
  menu,
  className,
  iconOnly = false,
  open,
  onOpenChange,
  triggerLabel,
}: {
  name: string;
  avatar: ReactNode;
  menu: ReactNode;
  className?: string;
  iconOnly?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerLabel?: string;
}) {
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null
  );
  const attachMenu = useCallback((node: HTMLUListElement | null) => {
    if (node) {
      setPortalContainer(node.closest<HTMLElement>('[role="dialog"]'));
    }
  }, []);
  return (
    <SidebarMenu aria-label="User" className={className} ref={attachMenu}>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={onOpenChange} open={open}>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                aria-label={triggerLabel ?? `Open user menu for ${name}`}
                className={cn(
                  "h-8 gap-1.5",
                  iconOnly && "size-9 justify-center px-0"
                )}
              >
                <span className="flex size-5 shrink-0 items-center justify-center">
                  {avatar}
                </span>
                {!iconOnly && (
                  <>
                    <span className="min-w-0 truncate text-[13px] text-foreground">
                      {name}
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
            {menu}
          </FluidDropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
