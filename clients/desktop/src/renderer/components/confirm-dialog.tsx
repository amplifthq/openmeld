import { Button } from "@openmeld/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@openmeld/ui/components/dialog";

type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  confirmVariant?: "default" | "destructive";
  busy?: boolean;
  onConfirm: () => void;
};

/**
 * A reusable confirm modal built on the shared `packages/ui` Dialog primitive,
 * for guarding actions that are easy to trigger by accident (e.g. Reconnect).
 * Controlled via `open` / `onOpenChange`.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmVariant = "default",
  busy = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog onOpenChange={(next) => onOpenChange(next)} open={open}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            disabled={busy}
            onClick={() => onOpenChange(false)}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            onClick={onConfirm}
            size="sm"
            variant={
              confirmVariant === "destructive" ? "destructive" : "default"
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
