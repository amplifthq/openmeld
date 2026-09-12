"use client";

// Adapted from Motion Primitives' MIT-licensed Morphing Dialog, installed with
// `npx motion-primitives@latest add morphing-dialog`.
// https://github.com/ibelick/motion-primitives/blob/main/components/core/morphing-dialog.tsx
// Preserve its shared-layout trigger/content and presence transition; Base UI
// owns modal focus, dismissal, accessibility, and scroll locking.
import { Dialog } from "@base-ui/react/dialog";
import { XIcon } from "@phosphor-icons/react";
import {
  AnimatePresence,
  type HTMLMotionProps,
  MotionConfig,
  MotionConfigContext,
  motion,
  type Transition,
} from "framer-motion";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMediaQuery } from "#hooks/use-media-query";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

const MorphingDialogContext = createContext<{
  open: boolean;
  layoutId?: string;
  actionsRef: RefObject<Dialog.Root.Actions | null>;
} | null>(null);

function useMorphingDialog() {
  const context = useContext(MorphingDialogContext);
  if (!context) {
    throw new Error(
      "Morphing Dialog components must be inside MorphingDialog."
    );
  }
  return context;
}

export function MorphingDialog({
  children,
  open: controlledOpen,
  onOpenChange,
  transition = springs.slow,
}: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  transition?: Transition;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const uniqueId = useId();
  const actionsRef = useRef<Dialog.Root.Actions | null>(null);
  const prefersReducedMotion = useMediaQuery(
    "(prefers-reduced-motion: reduce)"
  );
  const motionConfig = useContext(MotionConfigContext);
  const reducedMotion =
    prefersReducedMotion || motionConfig.reducedMotion === "always";
  const open = controlledOpen ?? internalOpen;
  const layoutId = reducedMotion ? undefined : `dialog-${uniqueId}`;
  const context = useMemo(
    () => ({ open, layoutId, actionsRef }),
    [open, layoutId]
  );
  return (
    <MorphingDialogContext.Provider value={context}>
      <MotionConfig transition={reducedMotion ? { duration: 0.1 } : transition}>
        <Dialog.Root
          actionsRef={actionsRef}
          onOpenChange={(nextOpen, details) => {
            if (!nextOpen) {
              details.preventUnmountOnClose();
            }
            setInternalOpen(nextOpen);
            onOpenChange?.(nextOpen);
          }}
          open={open}
        >
          {children}
        </Dialog.Root>
      </MotionConfig>
    </MorphingDialogContext.Provider>
  );
}

export function MorphingDialogTrigger({
  children,
  ...props
}: Dialog.Trigger.Props) {
  const { layoutId } = useMorphingDialog();
  return (
    <Dialog.Trigger {...props} render={<motion.button layoutId={layoutId} />}>
      {children}
    </Dialog.Trigger>
  );
}

export function MorphingDialogContainer({ children }: { children: ReactNode }) {
  const { open, actionsRef } = useMorphingDialog();
  return (
    <Dialog.Portal keepMounted>
      <AnimatePresence
        initial={false}
        onExitComplete={() => actionsRef.current?.unmount()}
      >
        {open && (
          <motion.div
            className="fixed inset-0 z-50"
            exit={{ opacity: 0 }}
            key="dialog-container"
          >
            <Dialog.Backdrop
              className="absolute inset-0 bg-black/20 backdrop-blur-xs"
              render={
                <motion.div
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  initial={{ opacity: 0 }}
                />
              }
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-4">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog.Portal>
  );
}

export function MorphingDialogContent({
  className,
  ...props
}: Dialog.Popup.Props) {
  const { layoutId } = useMorphingDialog();
  return (
    <Dialog.Popup
      {...props}
      className={cn("pointer-events-auto relative outline-none", className)}
      render={<motion.div layoutId={layoutId} />}
    />
  );
}

export function MorphingDialogTitle(props: Dialog.Title.Props) {
  return <Dialog.Title {...props} />;
}

export function MorphingDialogSubtitle(props: Dialog.Description.Props) {
  return <Dialog.Description {...props} />;
}

export function MorphingDialogImage(props: HTMLMotionProps<"img">) {
  const { layoutId } = useMorphingDialog();
  return (
    // biome-ignore lint/performance/noImgElement: shared Vite component; no Next Image dependency.
    <motion.img
      {...props}
      height={props.height}
      layoutId={layoutId ? `${layoutId}-image` : undefined}
      width={props.width}
    />
  );
}

export function MorphingDialogDescription({
  disableLayoutAnimation,
  ...props
}: HTMLMotionProps<"div"> & { disableLayoutAnimation?: boolean }) {
  const { layoutId } = useMorphingDialog();
  return (
    <motion.div
      {...props}
      animate="animate"
      exit="exit"
      initial="initial"
      layoutId={
        !disableLayoutAnimation && layoutId
          ? `${layoutId}-description`
          : undefined
      }
    />
  );
}

export function MorphingDialogClose({
  children,
  className,
  ...props
}: Dialog.Close.Props) {
  return (
    <Dialog.Close
      {...props}
      aria-label="Close dialog"
      className={cn(
        "absolute top-3 right-3 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-interaction-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      type="button"
    >
      {children ?? <XIcon aria-hidden="true" className="size-4" />}
    </Dialog.Close>
  );
}
