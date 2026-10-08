import type { ComponentProps, ReactNode } from "react";
import { buttonVariants } from "#components/button";
import { PlatformBadge } from "#components/platform-badge";
import { cn } from "#lib/utils";

export function OpenAppButton({
  badgeSlot = <PlatformBadge appearance="ring">Web</PlatformBadge>,
  className,
  size = "hero",
  ...props
}: Omit<ComponentProps<"a">, "children"> & {
  href: string;
  badgeSlot?: ReactNode;
  size?: "hero" | "compact";
}) {
  return (
    <a
      {...props}
      className={cn(
        buttonVariants({ size: "lg" }),
        "border-[#eeeeef] bg-[#eeeeef] font-medium text-[#18181b] hover:bg-white focus-visible:outline-2 focus-visible:outline-[#8daac5] focus-visible:outline-offset-2 motion-reduce:transition-none focus-visible:[outline-style:solid] [a]:hover:bg-white",
        size === "hero"
          ? "h-auto gap-2.5 rounded-full px-[22px] py-[13px] text-sm leading-[1.3]"
          : "h-9 gap-2 rounded-md px-3 text-sm",
        className
      )}
    >
      Open App {badgeSlot}
    </a>
  );
}
