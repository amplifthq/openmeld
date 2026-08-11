import type { ComponentProps } from "react";
import { cn } from "#lib/utils";

type ProgressProps = Omit<ComponentProps<"div">, "children"> & {
  max?: number;
  value: number;
};

function Progress({ className, max = 100, value, ...props }: ProgressProps) {
  const boundedMax = Math.max(1, max);
  const boundedValue = Math.min(Math.max(0, value), boundedMax);
  const percentage = (boundedValue / boundedMax) * 100;

  return (
    <div
      aria-valuemax={boundedMax}
      aria-valuemin={0}
      aria-valuenow={boundedValue}
      className={cn("h-1.5 overflow-hidden bg-border", className)}
      data-slot="progress"
      role="progressbar"
      {...props}
    >
      <div
        aria-hidden="true"
        className="h-full bg-foreground transition-[width] duration-200"
        data-slot="progress-indicator"
        style={{ width: `${String(percentage)}%` }}
      />
    </div>
  );
}

export { Progress };
