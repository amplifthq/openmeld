"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { CaretRightIcon, type Icon } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "framer-motion";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  type ReactNode,
} from "react";
import { Badge } from "#components/badge";
import { fontWeights } from "#lib/font-weight";
import { useShape } from "#lib/shape-context";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

/**
 * Source-adapted from Fluid Functionalism's Base UI ThinkingSteps registry
 * component. OpenMeld keeps the interaction model while reusing its existing
 * Base UI, Phosphor, shape, type, spring, badge, and shimmer foundations.
 *
 * https://www.fluidfunctionalism.com/docs/thinking-steps
 */

type ThinkingStepsProps = ComponentPropsWithoutRef<typeof Collapsible.Root>;

const ThinkingSteps = forwardRef<HTMLDivElement, ThinkingStepsProps>(
  ({ className, defaultOpen = true, ...props }, ref) => (
    <Collapsible.Root
      className={cn("min-w-0 max-w-full", className)}
      data-slot="thinking-steps"
      defaultOpen={defaultOpen}
      ref={ref}
      {...props}
    />
  )
);
ThinkingSteps.displayName = "ThinkingSteps";

type ThinkingStepsHeaderProps = Omit<
  ComponentPropsWithoutRef<typeof Collapsible.Trigger>,
  "children"
> & {
  active?: boolean;
  children?: ReactNode;
  summary?: ReactNode;
};

const ThinkingStepsHeader = forwardRef<
  HTMLButtonElement,
  ThinkingStepsHeaderProps
>(
  (
    {
      active = false,
      "aria-label": ariaLabel,
      children = "Thinking",
      className,
      summary,
      ...props
    },
    ref
  ) => {
    const shape = useShape();
    return (
      <Collapsible.Trigger
        aria-label={
          ariaLabel ??
          (typeof children === "string" && typeof summary === "string"
            ? `${children} ${summary}`
            : undefined)
        }
        className={cn(
          "group/thinking-steps-trigger flex h-7 min-w-0 max-w-full items-center gap-1.5 px-1.5 text-left text-[13px] outline-none transition-colors",
          "text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring",
          shape.item,
          className
        )}
        data-active={active || undefined}
        data-slot="thinking-steps-header"
        ref={ref}
        {...props}
      >
        {children ? (
          <span
            className="shrink-0 text-foreground"
            data-slot="thinking-steps-header-label"
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {children}
          </span>
        ) : null}
        {summary ? (
          <>
            {children ? (
              <span aria-hidden="true" className="shrink-0 text-border">
                ·
              </span>
            ) : null}
            <span
              aria-live="polite"
              className={cn(
                "min-w-0 flex-1 truncate whitespace-nowrap",
                active && "shimmer-text"
              )}
              data-slot="thinking-steps-header-summary"
            >
              {summary}
            </span>
          </>
        ) : null}
        <CaretRightIcon
          aria-hidden="true"
          className="size-3.5 shrink-0 transition-transform duration-200 group-data-[panel-open]/thinking-steps-trigger:rotate-90 motion-reduce:transition-none"
          data-slot="thinking-steps-header-caret"
          weight="regular"
        />
      </Collapsible.Trigger>
    );
  }
);
ThinkingStepsHeader.displayName = "ThinkingStepsHeader";

type ThinkingStepsContentProps = ComponentPropsWithoutRef<
  typeof Collapsible.Panel
>;

const ThinkingStepsContent = forwardRef<
  HTMLDivElement,
  ThinkingStepsContentProps
>(({ className, ...props }, ref) => (
  <Collapsible.Panel
    className={cn(
      "overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none data-[open]:[height:var(--collapsible-panel-height)]",
      className
    )}
    data-slot="thinking-steps-content"
    ref={ref}
    {...props}
  />
));
ThinkingStepsContent.displayName = "ThinkingStepsContent";

type ThinkingStepStatus = "active" | "complete" | "failed" | "pending";

type ThinkingStepProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  children?: ReactNode;
  delay?: number;
  description?: ReactNode;
  icon?: Icon;
  isLast?: boolean;
  label: ReactNode;
  status?: ThinkingStepStatus;
};

function ThinkingStep({
  children,
  className,
  delay = 0.08,
  description,
  icon: StepIcon,
  isLast = false,
  label,
  status = "complete",
  ...props
}: ThinkingStepProps) {
  const reduceMotion = useReducedMotion();
  if (status === "pending") {
    return null;
  }

  return (
    <motion.div
      animate={{ height: "auto", opacity: 1 }}
      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
      transition={reduceMotion ? { duration: 0 } : { ...springs.slow, delay }}
    >
      <div
        className={cn("relative flex min-w-0 gap-2.5 py-1.5", className)}
        data-slot="thinking-step"
        data-status={status}
        {...props}
      >
        <div
          aria-hidden="true"
          className="flex w-3.5 shrink-0 flex-col items-center"
          data-slot="thinking-step-indicator"
        >
          <span className="flex size-3.5 items-center justify-center">
            {StepIcon ? (
              <StepIcon
                className={cn(
                  "size-3.5 text-muted-foreground",
                  status === "failed" && "text-destructive"
                )}
                weight="regular"
              />
            ) : (
              <span
                className={cn(
                  "size-1.5 rounded-full bg-muted-foreground/60",
                  status === "active" && "animate-pulse bg-foreground/70",
                  status === "failed" && "bg-destructive"
                )}
              />
            )}
          </span>
          {isLast ? null : <span className="mt-1 w-px flex-1 bg-border/60" />}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span
            className={cn(
              "text-[13px]/tight text-foreground",
              status === "active" && "shimmer-text",
              status === "failed" && "text-destructive"
            )}
            data-slot="thinking-step-label"
            style={{ fontVariationSettings: fontWeights.medium }}
          >
            {label}
          </span>
          {description ? (
            <span
              className="text-[13px]/snug text-muted-foreground"
              data-slot="thinking-step-description"
            >
              {description}
            </span>
          ) : null}
          {children}
        </div>
      </div>
    </motion.div>
  );
}
ThinkingStep.displayName = "ThinkingStep";

type ThinkingStepDetailsProps = Omit<
  ComponentPropsWithoutRef<typeof Collapsible.Root>,
  "children"
> & {
  children?: ReactNode;
  details?: readonly string[];
  summary: ReactNode;
};

function ThinkingStepDetails({
  children,
  className,
  defaultOpen = false,
  details,
  summary,
  ...props
}: ThinkingStepDetailsProps) {
  return (
    <Collapsible.Root
      className={cn("mt-0.5 min-w-0", className)}
      data-slot="thinking-step-details"
      defaultOpen={defaultOpen}
      {...props}
    >
      <Collapsible.Trigger
        className="group/thinking-step-details-trigger flex min-w-0 items-center gap-1 text-left text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
        data-slot="thinking-step-details-trigger"
      >
        <CaretRightIcon
          aria-hidden="true"
          className="size-3 shrink-0 transition-transform duration-200 group-data-[panel-open]/thinking-step-details-trigger:rotate-90 motion-reduce:transition-none"
          weight="regular"
        />
        <span className="truncate">{summary}</span>
      </Collapsible.Trigger>
      <Collapsible.Panel
        className="overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none data-[open]:[height:var(--collapsible-panel-height)]"
        data-slot="thinking-step-details-content"
      >
        <div className="flex flex-col gap-0.5 pt-1 pl-4 text-muted-foreground text-xs/relaxed">
          {details?.map((detail, index) => (
            <span key={`${index}:${detail}`}>{detail}</span>
          ))}
          {children}
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
ThinkingStepDetails.displayName = "ThinkingStepDetails";

type ThinkingStepSourcesProps = HTMLAttributes<HTMLDivElement>;

const ThinkingStepSources = forwardRef<
  HTMLDivElement,
  ThinkingStepSourcesProps
>(({ className, ...props }, ref) => (
  <div
    className={cn("mt-1 flex flex-wrap gap-1.5", className)}
    data-slot="thinking-step-sources"
    ref={ref}
    {...props}
  />
));
ThinkingStepSources.displayName = "ThinkingStepSources";

type ThinkingStepSourceProps = ComponentPropsWithoutRef<typeof Badge> & {
  delay?: number;
};

function ThinkingStepSource({
  className,
  delay = 0,
  variant = "outline",
  ...props
}: ThinkingStepSourceProps) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.span
      animate={{ filter: "blur(0px)", opacity: 1, scale: 1 }}
      data-slot="thinking-step-source"
      initial={
        reduceMotion ? false : { filter: "blur(4px)", opacity: 0, scale: 0.94 }
      }
      transition={
        reduceMotion ? { duration: 0 } : { ...springs.moderate, delay }
      }
    >
      <Badge
        className={cn("max-w-full font-normal", className)}
        variant={variant}
        {...props}
      />
    </motion.span>
  );
}
ThinkingStepSource.displayName = "ThinkingStepSource";

type ThinkingStepImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "alt" | "height" | "src" | "width"
> & {
  alt: string;
  caption?: ReactNode;
  delay?: number;
  height: number;
  imageClassName?: string;
  src: string;
  width: number;
};

function ThinkingStepImage({
  alt,
  caption,
  className,
  delay = 0,
  height,
  imageClassName,
  loading = "lazy",
  src,
  width,
  ...props
}: ThinkingStepImageProps) {
  const reduceMotion = useReducedMotion();
  const shape = useShape();
  return (
    <motion.figure
      animate={{ filter: "blur(0px)", opacity: 1 }}
      className={cn("mt-1.5", className)}
      data-slot="thinking-step-image"
      initial={reduceMotion ? false : { filter: "blur(4px)", opacity: 0 }}
      transition={
        reduceMotion ? { duration: 0 } : { ...springs.moderate, delay }
      }
    >
      {/* biome-ignore lint/performance/noImgElement: shared UI cannot depend on a framework-specific image component. */}
      <img
        alt={alt}
        className={cn(
          "max-h-64 w-full max-w-sm object-cover",
          shape.container,
          imageClassName
        )}
        height={height}
        loading={loading}
        src={src}
        width={width}
        {...props}
      />
      {caption ? (
        <figcaption className="mt-1 text-[11px] text-muted-foreground">
          {caption}
        </figcaption>
      ) : null}
    </motion.figure>
  );
}
ThinkingStepImage.displayName = "ThinkingStepImage";

export type {
  ThinkingStepDetailsProps,
  ThinkingStepImageProps,
  ThinkingStepProps,
  ThinkingStepSourceProps,
  ThinkingStepSourcesProps,
  ThinkingStepStatus,
  ThinkingStepsContentProps,
  ThinkingStepsHeaderProps,
  ThinkingStepsProps,
};
export {
  ThinkingStep,
  ThinkingStepDetails,
  ThinkingStepImage,
  ThinkingStepSource,
  ThinkingStepSources,
  ThinkingSteps,
  ThinkingStepsContent,
  ThinkingStepsHeader,
};
