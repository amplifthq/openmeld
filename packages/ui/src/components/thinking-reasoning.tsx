"use client";

// Adapted from Kevin's AICSS Thinking + Reasoning registry component:
// https://www.aicss.dev/components/thinking-reasoning
// Real provider events replace the demo sentences, timers, and fixed line heights.
import { CaretDownIcon } from "@phosphor-icons/react";
import {
  memo,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import "./thinking-reasoning.css";

export const ThinkingReasoning = memo(function ThinkingReasoning(input: {
  text: string;
  streaming: boolean;
  firstOutputMs?: number;
  children?: ReactNode;
}) {
  const id = useId();
  const viewport = useRef<HTMLElement>(null);
  const following = useRef(true);
  const [open, setOpen] = useState(true);
  useLayoutEffect(() => {
    if (
      input.text.length > 0 &&
      open &&
      following.current &&
      viewport.current
    ) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [input.text, open]);
  return (
    <div className="om-reasoning" data-slot="thinking-reasoning">
      <button
        aria-controls={id}
        aria-expanded={open}
        className="om-reasoning-header"
        onClick={() => setOpen(!open)}
        type="button"
      >
        <span
          className={
            input.streaming
              ? "om-reasoning-label om-reasoning-live"
              : "om-reasoning-label"
          }
        >
          {input.streaming ? "Thinking" : "Reasoning"}
        </span>
        <CaretDownIcon aria-hidden="true" size={12} />
        {input.firstOutputMs !== undefined ? (
          <span className="om-reasoning-timing">
            First output in {(input.firstOutputMs / 1000).toFixed(1)}s
          </span>
        ) : null}
      </button>
      <div
        className="om-reasoning-collapsible"
        data-open={open}
        id={id}
        inert={!open}
      >
        <div className="om-reasoning-inner">
          <section
            aria-label="Live reasoning"
            className="om-reasoning-viewport"
            onScroll={(event) => {
              const el = event.currentTarget;
              following.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 24;
            }}
            ref={viewport}
            tabIndex={open ? 0 : -1}
          >
            <div className="om-reasoning-stream">
              {open ? (input.children ?? input.text) : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});
