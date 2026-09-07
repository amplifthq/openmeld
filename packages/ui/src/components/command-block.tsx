"use client";

import { CheckIcon, CopyIcon } from "@phosphor-icons/react";
import type * as React from "react";
import { useCallback, useEffect, useState } from "react";
import { ScrollArea } from "#fluid/scroll-area";
import { resolveStatusToneStrongTextClassName } from "#lib/status-tone";
import { cn } from "#lib/utils";

const COMMAND_BLOCK_COPIED_RESET_MS = 1500;

type CommandBlockProps = React.ComponentProps<"div"> & {
  command: string;
  copiedLabel?: string;
  copyLabel?: string;
  label?: React.ReactNode;
  labelHref?: string;
};

function CommandBlock({
  className,
  command,
  copiedLabel = `Copied: ${command}`,
  copyLabel = `Copy command: ${command}`,
  label,
  labelHref,
  ...props
}: CommandBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const didCopy = await copyTextToClipboard(command);
    setCopied(didCopy);
  }, [command]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopied(false);
    }, COMMAND_BLOCK_COPIED_RESET_MS);

    return () => window.clearTimeout(timeout);
  }, [copied]);

  return (
    <div
      className={cn("text-card-foreground", className)}
      data-slot="command-block"
      {...props}
    >
      {label ? (
        <div
          className="mb-3 flex items-center justify-between gap-3 text-muted-foreground text-xs"
          data-slot="command-block-label"
        >
          {labelHref ? (
            <a
              className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
              href={labelHref}
              rel="noreferrer"
              target="_blank"
            >
              {label}
            </a>
          ) : (
            <span>{label}</span>
          )}
        </div>
      ) : null}
      <button
        aria-label={copied ? copiedLabel : copyLabel}
        className="group/command-block-copy flex w-full items-center justify-between gap-4 border border-border bg-background/70 px-3 py-2 text-left outline-none transition-colors hover:border-foreground/20 hover:bg-background focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50"
        data-copied={copied ? "" : undefined}
        data-slot="command-block-copy"
        onClick={handleCopy}
        type="button"
      >
        <ScrollArea className="min-w-0" orientation="horizontal">
          <code
            className="whitespace-nowrap font-mono text-foreground text-sm leading-6"
            data-slot="command-block-code"
          >
            {command}
          </code>
        </ScrollArea>
        <span
          aria-hidden="true"
          className={cn(
            "grid size-4 shrink-0 place-items-center text-muted-foreground transition-colors",
            copied
              ? resolveStatusToneStrongTextClassName("ready")
              : "group-hover/command-block-copy:text-foreground"
          )}
          data-slot="command-block-copy-icon"
        >
          {copied ? (
            <CheckIcon className="size-4" weight="bold" />
          ) : (
            <CopyIcon className="size-4" />
          )}
        </span>
      </button>
    </div>
  );
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

export { CommandBlock, type CommandBlockProps };
