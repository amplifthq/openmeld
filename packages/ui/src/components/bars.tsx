import type { ComponentProps } from "react";
import { cn } from "#lib/utils";

function Bars({
  className,
  bars = 3,
  ...props
}: ComponentProps<"output"> & { bars?: number }) {
  const barIndexes = Array.from({ length: bars }, (_, index) => index);

  return (
    <output
      className={cn("inline-flex items-stretch gap-[5%]", className)}
      {...props}
    >
      {barIndexes.map((barIndex) => (
        <span
          aria-hidden="true"
          className="inline-block h-full rounded-xs bg-current"
          key={`bar-${barIndex + 1}`}
          style={{
            width: `${100 / bars}%`,
            animation:
              "loading-ui-wave-bars var(--duration, 1.2s) ease-in-out infinite",
            animationDelay: `calc(var(--delay, 0.2s) * ${barIndex})`,
          }}
        />
      ))}
      <span className="sr-only">Loading</span>
    </output>
  );
}

export { Bars };
