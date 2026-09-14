"use client";

// Adapted from Kevin's AICSS Thinking + Reasoning registry component:
// https://www.aicss.dev/components/thinking-reasoning
// Real provider events replace the demo sentences, timers, and fixed line heights.
import { CaretDownIcon } from "@phosphor-icons/react";
import { memo, useId, useLayoutEffect, useRef, useState } from "react";
import "./thinking-reasoning.css";

export const ThinkingReasoning = memo(function ThinkingReasoning(input: {
  text: string;
  streaming: boolean;
  firstOutputMs?: number;
}) {
  const id = useId();
  const viewport = useRef<HTMLElement>(null);
  const following = useRef(true);
  const [state, setState] = useState({
    streaming: input.streaming,
    open: input.streaming,
  });
  if (state.streaming !== input.streaming) {
    setState({ streaming: input.streaming, open: input.streaming });
  }
  useLayoutEffect(() => {
    if (
      input.text.length > 0 &&
      state.open &&
      following.current &&
      viewport.current
    ) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [input.text, state.open]);
  return (
    <div className="om-reasoning" data-slot="thinking-reasoning">
      <button
        aria-controls={id}
        aria-expanded={state.open}
        className="om-reasoning-header"
        onClick={() => setState({ ...state, open: !state.open })}
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
        data-open={state.open}
        id={id}
        inert={!state.open}
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
            tabIndex={state.open ? 0 : -1}
          >
            <div className="om-reasoning-stream">{input.text}</div>
          </section>
        </div>
      </div>
    </div>
  );
});
