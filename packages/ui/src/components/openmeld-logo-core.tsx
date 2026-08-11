"use client";

import { useReducedMotion } from "framer-motion";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { cn } from "#lib/utils";

export const OPENMELD_LOGO_LINES = [
  " ██████╗ ██████╗ ███████╗███╗   ██╗███╗   ███╗███████╗██╗     ██████╗",
  "██╔═══██╗██╔══██╗██╔════╝████╗  ██║████╗ ████║██╔════╝██║     ██╔══██╗",
  "██║   ██║██████╔╝█████╗  ██╔██╗ ██║██╔████╔██║█████╗  ██║     ██║  ██║",
  "██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██║╚██╔╝██║██╔══╝  ██║     ██║  ██║",
  "╚██████╔╝██║     ███████╗██║ ╚████║██║ ╚═╝ ██║███████╗███████╗██████╔╝",
  " ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝     ╚═╝╚══════╝╚══════╝╚═════╝ ",
] as const;

export const OPENMELD_LETTER_O_LOGO_LINES = [
  " ██████╗",
  "██╔═══██╗",
  "██║   ██║",
  "██║   ██║",
  "╚██████╔╝",
  " ╚═════╝ ",
] as const;

export const OPENMELD_LOGO_CURRENT_COLOR = [
  "currentColor",
  "currentColor",
  "currentColor",
  "currentColor",
  "currentColor",
  "currentColor",
] as const;

const DEFAULT_POINTER_Y = 0.5;
const FILL_CHAR = "█";
const SMOOTHING_FACTOR = 0.32;

// Strong intensity is rendered as four stacked layers so the box-drawing
// shadow strokes read as one constant colour and never sit on top of the
// letters. Back to front: glow halo (blurred, follows the cursor) → dim body
// base → uniform stroke → bright body. The stroke sits above the glow (so the
// glow cannot wash it into bright/dark segments) and below the body (so the
// body masks any stroke that would otherwise overlap a letter).
const STRONG_INFLUENCE_RANGE = 0.34;

export type OpenMeldLogoStrongAppearance = {
  baseOpacity: number;
  fillMinOpacity: number;
  glowBlurPx: number;
  glowMaxOpacity: number;
  influenceContrast: number;
  strokeBrightness: number;
  strokeOpacity: number;
};

const DEFAULT_STRONG_APPEARANCE: OpenMeldLogoStrongAppearance = {
  baseOpacity: 0.4,
  fillMinOpacity: 0.62,
  glowBlurPx: 11,
  glowMaxOpacity: 0.85,
  influenceContrast: 1,
  // Dims a light currentColor to a recessed shadow tone in dark mode.
  strokeBrightness: 0.42,
  strokeOpacity: 1,
};

type StrongAppearanceVariables = CSSProperties & {
  "--openmeld-logo-strong-base-opacity": number;
  "--openmeld-logo-strong-glow-blur": string;
  "--openmeld-logo-strong-glow-bleed": string;
  "--openmeld-logo-strong-stroke-brightness": number;
  "--openmeld-logo-strong-stroke-opacity": number;
};

type OpenMeldLogoIntensity = "weak" | "strong";
type OpenMeldLogoPointerTracking = "element" | "viewport";

export type OpenMeldLogoCoreProps = {
  ariaLabel?: string | null;
  className?: string;
  colors?: readonly string[];
  intensity: OpenMeldLogoIntensity;
  lines?: readonly string[];
  pointerTracking?: OpenMeldLogoPointerTracking;
  scale?: number;
  size?: number | string;
  strongLightAppearance?: OpenMeldLogoStrongAppearance;
};

type LogoTone = {
  fillBrightness: number;
  fillContrast: number;
  fillOpacity: number;
  fillTextShadow: string;
  outlineBrightness: number;
  outlineContrast: number;
  outlineOpacity: number;
  outlineTextShadow: string;
};

export function OpenMeldLogoCore({
  ariaLabel = "OpenMeld logo",
  className,
  colors = OPENMELD_LOGO_CURRENT_COLOR,
  intensity,
  lines = OPENMELD_LOGO_LINES,
  pointerTracking = "element",
  scale,
  size,
  strongLightAppearance,
}: OpenMeldLogoCoreProps) {
  const logoRef = useRef<HTMLDivElement | null>(null);
  const outlineRowRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const fillRowRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const glowRowRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const targetY = useRef(DEFAULT_POINTER_Y);
  const smoothedY = useRef(DEFAULT_POINTER_Y);
  const rafRef = useRef<number | null>(null);
  const shouldReduceMotion = useReducedMotion();

  const isStrong = intensity === "strong";

  const lineEntries = useMemo(() => {
    const occurrences = new Map<string, number>();

    return lines.map((line) => {
      const nextCount = (occurrences.get(line) ?? 0) + 1;
      occurrences.set(line, nextCount);

      return {
        fillLine: [...line]
          .map((char) => (char === FILL_CHAR ? char : " "))
          .join(""),
        key: `${line}-${nextCount}`,
        outlineLine: line,
        strokeLine: [...line]
          .map((char) => (char === FILL_CHAR ? " " : char))
          .join(""),
      };
    });
  }, [lines]);

  const fontSize = useMemo(
    () => resolveLogoFontSize({ scale, size }),
    [scale, size]
  );
  const accessibilityProps =
    ariaLabel === null
      ? { "aria-hidden": true }
      : { "aria-label": ariaLabel, role: "img" as const };
  const lightAppearance = strongLightAppearance ?? DEFAULT_STRONG_APPEARANCE;
  const strongAppearanceVariables: StrongAppearanceVariables = {
    "--openmeld-logo-strong-base-opacity": lightAppearance.baseOpacity,
    "--openmeld-logo-strong-glow-blur": `${lightAppearance.glowBlurPx}px`,
    "--openmeld-logo-strong-glow-bleed": `${lightAppearance.glowBlurPx * 2}px`,
    "--openmeld-logo-strong-stroke-brightness":
      lightAppearance.strokeBrightness,
    "--openmeld-logo-strong-stroke-opacity": lightAppearance.strokeOpacity,
  };

  useEffect(() => {
    const total = Math.max(1, lineEntries.length);
    const paintFrame = (cursor: number) => {
      if (intensity === "strong") {
        const appearance =
          strongLightAppearance &&
          !document.documentElement.classList.contains("dark")
            ? strongLightAppearance
            : DEFAULT_STRONG_APPEARANCE;
        paintStrongFrame(
          total,
          cursor,
          glowRowRefs.current,
          fillRowRefs.current,
          appearance
        );
        return;
      }

      paintWeakFrame(
        total,
        cursor,
        outlineRowRefs.current,
        fillRowRefs.current
      );
    };
    if (shouldReduceMotion) {
      targetY.current = DEFAULT_POINTER_Y;
      smoothedY.current = DEFAULT_POINTER_Y;
      paintFrame(DEFAULT_POINTER_Y);
      return;
    }

    const updateTargetY = (event: PointerEvent) => {
      const nextY =
        pointerTracking === "viewport"
          ? resolveViewportPointerY(event)
          : resolveElementPointerY(event, logoRef.current);

      if (nextY === null) {
        return;
      }

      targetY.current = nextY;
    };
    const resetTargetY = () => {
      targetY.current = DEFAULT_POINTER_Y;
    };
    const tick = () => {
      smoothedY.current +=
        (targetY.current - smoothedY.current) * SMOOTHING_FACTOR;
      paintFrame(smoothedY.current);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", updateTargetY, { passive: true });
    window.addEventListener("pointerleave", resetTargetY);
    window.addEventListener("blur", resetTargetY);
    rafRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", updateTargetY);
      window.removeEventListener("pointerleave", resetTargetY);
      window.removeEventListener("blur", resetTargetY);
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, [
    intensity,
    lineEntries.length,
    pointerTracking,
    shouldReduceMotion,
    strongLightAppearance,
  ]);

  return (
    <div
      {...accessibilityProps}
      className={cn(
        "relative w-fit select-none text-left leading-none [font-variant-ligatures:none] dark:[--openmeld-logo-strong-base-opacity:0.4] dark:[--openmeld-logo-strong-glow-bleed:22px] dark:[--openmeld-logo-strong-glow-blur:11px] dark:[--openmeld-logo-strong-stroke-brightness:0.42] dark:[--openmeld-logo-strong-stroke-opacity:1]",
        className
      )}
      ref={logoRef}
      style={{
        ...strongAppearanceVariables,
        fontFamily:
          '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize,
        whiteSpace: "pre",
      }}
    >
      {isStrong ? (
        <>
          <pre
            aria-hidden
            className="pointer-events-none absolute m-0 w-fit"
            data-slot="openmeld-logo-strong-glow"
            style={{
              filter: "blur(var(--openmeld-logo-strong-glow-blur))",
              left: "calc(var(--openmeld-logo-strong-glow-bleed) * -1)",
              padding: "var(--openmeld-logo-strong-glow-bleed)",
              top: "calc(var(--openmeld-logo-strong-glow-bleed) * -1)",
              zIndex: 0,
            }}
          >
            {lineEntries.map((entry, rowIndex) => (
              <span
                className="block"
                key={`glow-${entry.key}`}
                ref={(node) => {
                  glowRowRefs.current[rowIndex] = node;
                }}
                style={{ color: resolveRowColor(colors, rowIndex), opacity: 0 }}
              >
                {entry.fillLine}
              </span>
            ))}
          </pre>

          <pre
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 m-0 w-fit"
            style={{
              opacity: "var(--openmeld-logo-strong-base-opacity)",
              zIndex: 1,
            }}
          >
            {lineEntries.map((entry, rowIndex) => (
              <span
                className="block"
                key={`base-${entry.key}`}
                style={{ color: resolveRowColor(colors, rowIndex) }}
              >
                {entry.fillLine}
              </span>
            ))}
          </pre>

          <pre
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 m-0 w-fit"
            style={{
              filter:
                "brightness(var(--openmeld-logo-strong-stroke-brightness))",
              opacity: "var(--openmeld-logo-strong-stroke-opacity)",
              zIndex: 2,
            }}
          >
            {lineEntries.map((entry, rowIndex) => (
              <span
                className="block"
                key={`stroke-${entry.key}`}
                style={{ color: resolveRowColor(colors, rowIndex) }}
              >
                {entry.strokeLine}
              </span>
            ))}
          </pre>

          <pre
            aria-hidden
            className="pointer-events-none relative m-0 w-fit"
            style={{ zIndex: 3 }}
          >
            {lineEntries.map((entry, rowIndex) => (
              <span
                className="block"
                key={`fill-${entry.key}`}
                ref={(node) => {
                  fillRowRefs.current[rowIndex] = node;
                }}
                style={{ color: resolveRowColor(colors, rowIndex) }}
              >
                {entry.fillLine}
              </span>
            ))}
          </pre>
        </>
      ) : (
        <>
          <pre aria-hidden className="m-0 w-fit">
            {lineEntries.map((entry, rowIndex) => (
              <span
                className="block"
                key={`outline-${entry.key}`}
                ref={(node) => {
                  outlineRowRefs.current[rowIndex] = node;
                }}
                style={{ color: resolveRowColor(colors, rowIndex) }}
              >
                {entry.outlineLine}
              </span>
            ))}
          </pre>

          <pre
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 m-0 w-fit"
          >
            {lineEntries.map((entry, rowIndex) => (
              <span
                className="block"
                key={`fill-${entry.key}`}
                ref={(node) => {
                  fillRowRefs.current[rowIndex] = node;
                }}
                style={{ color: resolveRowColor(colors, rowIndex) }}
              >
                {entry.fillLine}
              </span>
            ))}
          </pre>
        </>
      )}
    </div>
  );
}

function resolveLogoFontSize(input: {
  scale: number | undefined;
  size: number | string | undefined;
}): string {
  if (typeof input.size === "string") {
    return input.size;
  }

  if (typeof input.size === "number") {
    return `${input.size}px`;
  }

  const scale = input.scale ?? 1;
  const min = (0.54 * scale).toFixed(3);
  const fluid = (1.8 * scale).toFixed(3);
  const max = (1 * scale).toFixed(3);
  return `clamp(${min}rem,${fluid}vw,${max}rem)`;
}

function resolveElementPointerY(
  event: PointerEvent,
  element: HTMLElement | null
): number | null {
  const rect = element?.getBoundingClientRect();
  if (!rect || rect.height <= 0) {
    return null;
  }

  return clamp((event.clientY - rect.top) / rect.height, 0, 1);
}

function resolveViewportPointerY(event: PointerEvent): number | null {
  if (window.innerHeight <= 0) {
    return null;
  }

  return clamp(event.clientY / window.innerHeight, 0, 1);
}

function paintStrongFrame(
  total: number,
  cursor: number,
  glowRows: (HTMLSpanElement | null)[],
  fillRows: (HTMLSpanElement | null)[],
  appearance: OpenMeldLogoStrongAppearance
) {
  for (let index = 0; index < total; index += 1) {
    const center = (index + 0.5) / total;
    const influence = Math.max(
      0,
      1 - Math.abs(center - cursor) / STRONG_INFLUENCE_RANGE
    );
    const visualInfluence = clamp(
      (influence - 0.5) * appearance.influenceContrast + 0.5,
      0,
      1
    );
    const glowRow = glowRows[index];
    const fillRow = fillRows[index];

    if (glowRow) {
      glowRow.style.opacity = (
        visualInfluence * appearance.glowMaxOpacity
      ).toFixed(3);
    }
    if (fillRow) {
      fillRow.style.opacity = (
        appearance.fillMinOpacity +
        visualInfluence * (1 - appearance.fillMinOpacity)
      ).toFixed(3);
    }
  }
}

function paintWeakFrame(
  total: number,
  cursor: number,
  outlineRows: (HTMLSpanElement | null)[],
  fillRows: (HTMLSpanElement | null)[]
) {
  for (let index = 0; index < total; index += 1) {
    const tone = getWeakTone(index, total, cursor);
    const outlineRow = outlineRows[index];
    const fillRow = fillRows[index];

    if (outlineRow) {
      applyTone(outlineRow, {
        brightness: tone.outlineBrightness,
        contrast: tone.outlineContrast,
        opacity: tone.outlineOpacity,
        textShadow: tone.outlineTextShadow,
      });
    }
    if (fillRow) {
      applyTone(fillRow, {
        brightness: tone.fillBrightness,
        contrast: tone.fillContrast,
        opacity: tone.fillOpacity,
        textShadow: tone.fillTextShadow,
      });
    }
  }
}

function getWeakTone(index: number, total: number, cursorY: number): LogoTone {
  const center = (index + 0.5) / total;
  const distance = Math.abs(center - cursorY);
  const influence = Math.max(0, 1 - distance / 0.22);
  return {
    fillBrightness: 0.84 + influence * 0.52,
    fillContrast: 1 + influence * 0.05,
    fillOpacity: 0.9 + influence * 0.1,
    fillTextShadow: "none",
    outlineBrightness: 0.72 + influence * 0.52 * 0.6,
    outlineContrast: 1 + influence * 0.04,
    outlineOpacity: 0.72 + influence * 0.14,
    outlineTextShadow: "none",
  };
}

function applyTone(
  row: HTMLSpanElement,
  tone: {
    brightness: number;
    contrast: number;
    opacity: number;
    textShadow: string;
  }
) {
  row.style.filter = `brightness(${tone.brightness.toFixed(3)}) contrast(${tone.contrast.toFixed(3)})`;
  row.style.opacity = tone.opacity.toFixed(3);
  row.style.textShadow = tone.textShadow;
}

function resolveRowColor(colors: readonly string[], rowIndex: number): string {
  return colors[Math.min(colors.length - 1, rowIndex)] ?? "currentColor";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
