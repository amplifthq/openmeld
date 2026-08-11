"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  type ComponentProps,
  forwardRef,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { fontWeights } from "#lib/font-weight";
import { cn } from "#lib/utils";

const circleA =
  "M 12 8 C 14.21 8 16 9.79 16 12 C 16 14.21 14.21 16 12 16 C 9.79 16 8 14.21 8 12 C 8 9.79 9.79 8 12 8 Z";

const infinity =
  "M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z";

const circleB =
  "M 12 16 C 14.21 16 16 14.21 16 12 C 16 9.79 14.21 8 12 8 C 9.79 8 8 9.79 8 12 C 8 14.21 9.79 16 12 16 Z";

const DEFAULT_WORDS = ["Thinking", "Planning", "Working", "Refining"];

type ThinkingIndicatorProps = ComponentProps<"output"> & {
  icon?: ReactNode;
  words?: readonly string[];
};

const ThinkingIndicator = forwardRef<HTMLOutputElement, ThinkingIndicatorProps>(
  ({ className, icon, words = DEFAULT_WORDS, ...props }, ref) => {
    const [index, setIndex] = useState(0);
    const shouldReduceMotion = useReducedMotion() === true;
    const displayWords = words.length > 0 ? words : DEFAULT_WORDS;
    const activeWord = displayWords[index % displayWords.length] ?? "";
    const longestWord = displayWords.reduce((a, b) =>
      a.length >= b.length ? a : b
    );

    useEffect(() => {
      if (displayWords.length <= 1) {
        return;
      }

      const interval = setInterval(() => {
        setIndex((i) => i + 1);
      }, 4000);
      return () => clearInterval(interval);
    }, [displayWords.length]);

    return (
      <output
        className={cn("flex items-center gap-2 px-3 py-2", className)}
        ref={ref}
        {...props}
      >
        {icon ?? (
          <motion.svg
            aria-hidden="true"
            className="shrink-0 text-muted-foreground"
            fill="none"
            height={20}
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
            width={20}
          >
            <motion.path
              animate={{
                d: [circleA, infinity, circleB, infinity, circleA],
              }}
              d={circleA}
              initial={{ d: circleA }}
              transition={{
                d: {
                  duration: 6,
                  ease: "easeInOut",
                  repeat: Number.POSITIVE_INFINITY,
                  times: [0, 0.25, 0.5, 0.75, 1.0],
                },
              }}
            />
          </motion.svg>
        )}
        <span
          className="inline-grid overflow-hidden text-[13px]"
          style={{ fontVariationSettings: fontWeights.medium }}
        >
          <span
            aria-hidden="true"
            className="shimmer-text invisible col-start-1 row-start-1"
          >
            {longestWord}
          </span>
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{
                filter: "blur(0px)",
                y: 0,
                opacity: 1,
                transition: shouldReduceMotion
                  ? { duration: 0 }
                  : { duration: 0.24, ease: [0.16, 1, 0.3, 1] },
              }}
              className="shimmer-text col-start-1 row-start-1"
              data-slot="thinking-indicator-word"
              exit={
                shouldReduceMotion
                  ? undefined
                  : {
                      filter: "blur(8px)",
                      y: "-80%",
                      opacity: 0,
                      transition: {
                        duration: 0.16,
                        ease: [0.7, 0, 0.84, 0],
                      },
                    }
              }
              initial={
                shouldReduceMotion
                  ? false
                  : { filter: "blur(8px)", y: "80%", opacity: 0 }
              }
              key={activeWord}
            >
              {activeWord}
            </motion.span>
          </AnimatePresence>
        </span>
      </output>
    );
  }
);

ThinkingIndicator.displayName = "ThinkingIndicator";

export { ThinkingIndicator };
export default ThinkingIndicator;
