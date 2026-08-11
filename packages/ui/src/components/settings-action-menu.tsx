import { Popover } from "@base-ui/react/popover";
import { DotsThreeIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { Button } from "#components/button";
import { cn } from "#lib/utils";

export type SettingsActionMenuItem = {
  disabled?: boolean;
  icon?: ReactNode;
  id: string;
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
};

export type SettingsActionMenuProps = {
  ariaLabel: string;
  items: readonly SettingsActionMenuItem[];
};

export function SettingsActionMenu({
  ariaLabel,
  items,
}: SettingsActionMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root modal={false} onOpenChange={setOpen} open={open}>
      <Popover.Trigger
        render={
          <Button
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={ariaLabel}
            size="icon"
            type="button"
            variant="ghost"
          />
        }
      >
        <DotsThreeIcon aria-hidden="true" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          collisionAvoidance={{
            align: "shift",
            fallbackAxisSide: "start",
            side: "flip",
          }}
          collisionPadding={12}
          side="bottom"
          sideOffset={8}
        >
          <Popover.Popup
            className="z-50 min-w-52 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
            finalFocus={false}
            role="menu"
          >
            {items.map((item) => (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
                  item.tone === "danger" && "text-destructive"
                )}
                disabled={item.disabled}
                key={item.id}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                role="menuitem"
                type="button"
              >
                {item.icon ? (
                  <span className="grid size-4 shrink-0 place-items-center">
                    {item.icon}
                  </span>
                ) : null}
                <span className="min-w-0 truncate">{item.label}</span>
              </button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
