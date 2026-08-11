"use client";

import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion";
import { CaretDownIcon } from "@phosphor-icons/react";
import {
  type ComponentPropsWithoutRef,
  forwardRef,
  type ReactNode,
} from "react";
import { cn } from "#lib/utils";

type AccordionProps = ComponentPropsWithoutRef<typeof AccordionPrimitive.Root>;
type AccordionItemProps = ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Item
>;
type AccordionTriggerProps = ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Trigger
> & {
  chevronClassName?: string;
  trailing?: ReactNode;
};
type AccordionContentProps = ComponentPropsWithoutRef<
  typeof AccordionPrimitive.Panel
>;

const Accordion = forwardRef<HTMLDivElement, AccordionProps>(
  ({ className, ...props }, ref) => (
    <AccordionPrimitive.Root
      className={cn("min-w-0", className)}
      ref={ref}
      {...props}
    />
  )
);
Accordion.displayName = "Accordion";

const AccordionItem = forwardRef<HTMLDivElement, AccordionItemProps>(
  ({ className, ...props }, ref) => (
    <AccordionPrimitive.Item
      className={cn("group/accordion-item min-w-0", className)}
      ref={ref}
      {...props}
    />
  )
);
AccordionItem.displayName = "AccordionItem";

const AccordionTrigger = forwardRef<HTMLElement, AccordionTriggerProps>(
  ({ children, chevronClassName, className, trailing, ...props }, ref) => (
    <AccordionPrimitive.Header>
      <AccordionPrimitive.Trigger
        className={cn(
          "flex w-full min-w-0 items-center gap-3 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      >
        <span className="min-w-0 flex-1">{children}</span>
        {trailing}
        <CaretDownIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[open]/accordion-item:rotate-180",
            chevronClassName
          )}
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
);
AccordionTrigger.displayName = "AccordionTrigger";

const AccordionContent = forwardRef<HTMLDivElement, AccordionContentProps>(
  ({ className, ...props }, ref) => (
    <AccordionPrimitive.Panel
      className={cn(
        "overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0 data-[open]:[height:var(--accordion-panel-height)]",
        className
      )}
      ref={ref}
      {...props}
    />
  )
);
AccordionContent.displayName = "AccordionContent";

export { Accordion, AccordionContent, AccordionItem, AccordionTrigger };
