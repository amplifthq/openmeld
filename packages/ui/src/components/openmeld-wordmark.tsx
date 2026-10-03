import { cn } from "@openmeld/ui/lib/utils";

type OpenMeldWordmarkProps = {
  className?: string;
};

export function OpenMeldWordmark({ className }: OpenMeldWordmarkProps) {
  return (
    <span
      aria-label="OpenMeld"
      className={cn(
        "inline-flex items-center whitespace-nowrap font-geist-pixel-square text-foreground text-xs uppercase leading-none",
        className
      )}
      role="img"
    >
      OPENMELD
    </span>
  );
}
