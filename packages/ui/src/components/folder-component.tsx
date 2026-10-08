"use client";

// Adapted from Rare UI — https://rareui.com/components/foldercomponent
// Copyright (c) 2026 Swami Malode. See folder-component.LICENSE.md.

import { motion, useReducedMotion } from "framer-motion";
import type React from "react";
import { useId, useState } from "react";
import { springs } from "#lib/springs";
import { cn } from "#lib/utils";

const themes = {
  black: {
    backFill: "black",
    backInsetColor: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.37 0",
    backInsetShadow: "inset 0 0 6px 2px rgba(255,255,255,0.37)",
    flapFill: "#292929",
    flapFillOpacity: 0.25,
    flapStroke: "#979797",
    flapInsetColor: "0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.08 0",
    cardFill: "#F1F1F1",
    cardStroke: "#E0E0E0",
    cardLineFill: "#D4D4D4",
    cardInsetColor: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0",
  },
  white: {
    backFill: "#ffffff",
    backInsetColor: "0 0 0 0 0.7 0 0 0 0 0.7 0 0 0 0 0.7 0 0 0 0.25 0",
    backInsetShadow: "inset 0 0 6px 2px rgba(178,178,178,0.25)",
    flapFill: "#f5f5f5",
    flapFillOpacity: 0.85,
    flapStroke: "#d4d4d4",
    flapInsetColor: "0 0 0 0 0.6 0 0 0 0 0.6 0 0 0 0 0.6 0 0 0 0.15 0",
    cardFill: "#262626",
    cardStroke: "#404040",
    cardLineFill: "#737373",
    cardInsetColor: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.15 0",
  },
  blue: {
    backFill: "#50B1FD",
    backInsetColor: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.35 0",
    backInsetShadow: "inset 0 0 6px 2px rgba(255,255,255,0.35)",
    flapFill: "#3a9ae8",
    flapFillOpacity: 0.45,
    flapStroke: "#7ec8ff",
    flapInsetColor: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.12 0",
    cardFill: "#F1F1F1",
    cardStroke: "#E0E0E0",
    cardLineFill: "#D4D4D4",
    cardInsetColor: "0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0",
  },
} as const;

const sizeScales = {
  sm: 0.65,
  md: 1,
  lg: 1.35,
} as const;

type FolderComponentProps = Omit<React.ComponentProps<"div">, "color"> & {
  color?: "black" | "white" | "blue";
  size?: "sm" | "md" | "lg" | number;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Replaces the demo cards without changing the folder artwork. */
  children?: React.ReactNode;
  /** Delegate activation to a surrounding accessible trigger. */
  decorative?: boolean;
};

const BASE_WIDTH = 321;
const BASE_HEIGHT = 270;

const FLAP_PATH =
  "M0 25C0 11.1929 11.1929 0 25 0H136.084C143.044 0 149.689 2.90139 154.42 8.00608L178.08 33.5343C182.811 38.639 189.456 41.5404 196.416 41.5404H296C309.807 41.5404 321 52.7333 321 66.5404V216C321 229.807 309.807 241 296 241H25C11.1929 241 0 229.807 0 216V25Z";

const FolderComponent = ({
  color = "black",
  size = "md",
  className,
  open,
  onOpenChange,
  children,
  decorative = false,
  ...props
}: FolderComponentProps) => {
  const theme = themes[color] ?? themes.black;
  const scale = typeof size === "number" ? size : sizeScales[size];
  const reduce = useReducedMotion();
  const filterId = useId();
  const [isHovered, setIsHovered] = useState(false);
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = open ?? internalOpen;
  const toggle = () => {
    setInternalOpen(!isOpen);
    onOpenChange?.(!isOpen);
  };

  const Trigger = decorative ? "div" : "button";
  let visualState: "closed" | "hover" | "open" = "closed";
  if (isHovered && !reduce) {
    visualState = "hover";
  }
  if (isOpen) {
    visualState = "open";
  }

  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center",
        className
      )}
      data-slot="folder"
      {...props}
    >
      <Trigger
        aria-expanded={decorative ? undefined : isOpen}
        aria-label={decorative ? undefined : "Toggle folder"}
        className="relative select-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={decorative ? undefined : toggle}
        onKeyDown={
          decorative
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggle();
                }
              }
        }
        onPointerEnter={(event) => {
          if (event.pointerType === "mouse") {
            setIsHovered(true);
          }
        }}
        onPointerLeave={() => setIsHovered(false)}
        style={{
          width: BASE_WIDTH * scale,
          height: BASE_HEIGHT * scale,
          touchAction: "manipulation",
          WebkitTapHighlightColor: "transparent",
        }}
        tabIndex={decorative ? undefined : 0}
        type={decorative ? undefined : "button"}
      >
        <div
          className="absolute top-1/2 left-1/2"
          style={{
            width: BASE_WIDTH,
            height: BASE_HEIGHT,
            transform: `translate(-50%, -50%) scale(${scale})`,
            perspective: 800,
          }}
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div
              style={{
                width: BASE_WIDTH,
                height: BASE_HEIGHT,
                borderRadius: 25,
                backgroundColor: theme.backFill,
                boxShadow: theme.backInsetShadow,
              }}
            />
          </div>

          <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center">
            {children !== undefined ? (
              children
            ) : (
              <DemoCards
                reduce={Boolean(reduce)}
                state={visualState}
                theme={theme}
              />
            )}
          </div>

          <motion.div
            animate={{
              transform: `rotateX(${{ closed: -15, hover: -30, open: -55 }[visualState]}deg)`,
            }}
            className="absolute top-1/2 left-1/2 mt-4 -translate-x-1/2 -translate-y-1/2"
            style={{
              transformOrigin: "bottom center",
              transformStyle: "preserve-3d",
              width: 321,
              height: 241,
            }}
            transition={reduce ? { duration: 0 } : springs.slow}
          >
            <div
              className="absolute inset-0"
              style={{
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
                clipPath: `path('${FLAP_PATH}')`,
                WebkitClipPath: `path('${FLAP_PATH}')`,
                transform: "translateZ(0)",
                backfaceVisibility: "hidden",
                WebkitBackfaceVisibility: "hidden",
                willChange: "transform",
              }}
            />
            <svg
              aria-hidden="true"
              className="absolute inset-0"
              fill="none"
              height="241"
              viewBox="0 0 321 241"
              width="321"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g filter={`url(#${filterId})`}>
                <path
                  d={FLAP_PATH}
                  fill={theme.flapFill}
                  fillOpacity={theme.flapFillOpacity}
                />
                <path
                  d="M25 0.5H136.084C142.905 0.5 149.417 3.3431 154.054 8.3457L177.713 33.874C182.539 39.0808 189.317 42.04 196.416 42.04H296C309.531 42.04 320.5 53.0092 320.5 66.54V216C320.5 229.531 309.531 240.5 296 240.5H25C11.469 240.5 0.5 229.531 0.5 216V25C0.5 11.469 11.469 0.5 25 0.5Z"
                  stroke={theme.flapStroke}
                />
              </g>
              <defs>
                <filter
                  colorInterpolationFilters="sRGB"
                  filterUnits="userSpaceOnUse"
                  height="291.8"
                  id={filterId}
                  width="371.8"
                  x="-25.4"
                  y="-25.4"
                >
                  <feFlood floodOpacity="0" result="BackgroundImageFix" />
                  <feBlend
                    in="SourceGraphic"
                    in2="BackgroundImageFix"
                    mode="normal"
                    result="shape"
                  />
                  <feColorMatrix
                    in="SourceAlpha"
                    result="hardAlpha"
                    type="matrix"
                    values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
                  />
                  <feOffset />
                  <feGaussianBlur stdDeviation="2.65" />
                  <feComposite
                    in2="hardAlpha"
                    k2="-1"
                    k3="1"
                    operator="arithmetic"
                  />
                  <feColorMatrix type="matrix" values={theme.flapInsetColor} />
                  <feBlend
                    in2="shape"
                    mode="normal"
                    result="effect1_innerShadow_171_13"
                  />
                </filter>
              </defs>
            </svg>
          </motion.div>
        </div>
      </Trigger>
    </div>
  );
};

export default FolderComponent;

export { FolderComponent as Folder };
export type { FolderComponentProps };

type Theme = (typeof themes)[keyof typeof themes];
const demoPositions = {
  closed: [
    [40, -10, 10],
    [3, -20, 2],
    [-40, -22, -5],
  ],
  hover: [
    [40, -30, 14],
    [3, -35, -1],
    [-40, -44, -9],
  ],
  open: [
    [70, -160, 18],
    [0, -180, -3],
    [-65, -170, -14],
  ],
} as const;
function DemoCards({
  theme,
  state,
  reduce,
}: {
  theme: Theme;
  state: keyof typeof demoPositions;
  reduce: boolean;
}) {
  return demoPositions[state].map(([x, y, rotation], index) => (
    <motion.div
      animate={{
        transform: `translate(${x}px, ${y}px) rotate(${rotation}deg)`,
      }}
      className="absolute"
      key={["back", "middle", "front"][index]}
      transition={reduce ? { duration: 0 } : springs.slow}
    >
      <Card id={index + 1} theme={theme} />
    </motion.div>
  ));
}

const Card = ({ id, theme }: { id: number; theme: Theme }) => {
  const filterId = useId();
  return (
    <div data-slot="folder-card">
      <svg
        aria-hidden="true"
        fill="none"
        height="214"
        viewBox="0 0 164 214"
        width="164"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g filter={`url(#${filterId})`}>
          <rect
            fill={theme.cardFill}
            height="213.262"
            rx="20"
            width="163.078"
          />
        </g>
        <rect
          height="212.262"
          rx="19.5"
          stroke={theme.cardStroke}
          width="162.078"
          x="0.5"
          y="0.5"
        />
        <rect
          fill={theme.cardLineFill}
          height="11.8892"
          rx="5.94459"
          width="134.84"
          x="14.1193"
          y="31.2091"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 60.9939)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 60.9617)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 75.1122)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 75.0801)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 89.2306)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 89.1985)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 103.349)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 103.317)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 117.467)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 117.435)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 131.586)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 131.554)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 145.704)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 145.672)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 159.823)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 159.79)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000409158 0.00201956 0.999998 14.8253 173.941)"
          width="64.5183"
        />
        <rect
          fill={theme.cardLineFill}
          height="5.88276"
          rx="2.94138"
          transform="matrix(1 -0.000461045 0.00179228 0.999998 84.4303 173.909)"
          width="64.5183"
        />
        <defs>
          <filter
            colorInterpolationFilters="sRGB"
            filterUnits="userSpaceOnUse"
            height="218.262"
            id={filterId}
            width="166.078"
            x="0"
            y="0"
          >
            <feFlood floodOpacity="0" result="BackgroundImageFix" />
            <feBlend
              in="SourceGraphic"
              in2="BackgroundImageFix"
              mode="normal"
              result="shape"
            />
            <feColorMatrix
              in="SourceAlpha"
              result="hardAlpha"
              type="matrix"
              values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"
            />
            <feMorphology
              in="SourceAlpha"
              operator="erode"
              radius="2"
              result={`effect1_innerShadow_${id}`}
            />
            <feOffset dx="3" dy="5" />
            <feGaussianBlur stdDeviation="3.05" />
            <feComposite in2="hardAlpha" k2="-1" k3="1" operator="arithmetic" />
            <feColorMatrix type="matrix" values={theme.cardInsetColor} />
            <feBlend
              in2="shape"
              mode="normal"
              result={`effect1_innerShadow_${id}`}
            />
          </filter>
        </defs>
      </svg>
    </div>
  );
};
