import type { ReactNode } from "react";
import { cn } from "#lib/utils";

export function PlatformBadge({
  children,
  appearance = "fill",
}: {
  children: ReactNode;
  appearance?: "fill" | "ring";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-full text-[11px] leading-none",
        appearance === "fill"
          ? "meld-platform-badge min-h-[22px] bg-[linear-gradient(155deg,#eff4f7_8%,#aebdc9_32%,#fff_54%,#c5cbd2_76%,#eef2f5)] px-[9px] py-[3px] font-semibold text-[#25282c] shadow-[inset_0_0_0_1px_#ffffff80,inset_0_1px_0_#ffffffc7]"
          : "meld-web-badge border border-transparent bg-[linear-gradient(#eeeeef,#eeeeef),linear-gradient(120deg,#83b5d5,#78839f,#e6d0a0,#e89c81,#7b92b2)] px-2 py-0.5 font-medium text-[#18181b] [background-clip:padding-box,border-box] [background-origin:padding-box,border-box]"
      )}
    >
      {children}
    </span>
  );
}
