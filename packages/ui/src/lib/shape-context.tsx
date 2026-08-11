"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

type ShapeVariant = "rounded" | "square";

/** Linear's standard control radius, measured from its live `--control-border-radius`. */
const DEFAULT_ROUNDED_SHAPE_RADIUS_PX = 8;

type ShapeClasses = {
  item: string;
  bg: string;
  focusRing: string;
  mergedBg: string;
  container: string;
  button: string;
  input: string;
  /** Numeric radius for geometry that cannot consume a Tailwind class. */
  mergedRadius: number;
};

const semanticShapeClasses = {
  item: "rounded-md",
  bg: "rounded-md",
  focusRing: "rounded-lg",
  mergedBg: "rounded-md",
  container: "rounded-xl",
  button: "rounded-md",
  input: "rounded-md",
} as const;

/**
 * Fluid components use the same semantic classes in both modes. The root
 * radius tokens make those classes square or rounded, while numeric geometry
 * keeps merge/split animations aligned with the selected style.
 */
function createShapeClasses(
  shape: ShapeVariant,
  roundedRadiusPx: number
): ShapeClasses {
  if (!(Number.isFinite(roundedRadiusPx) && roundedRadiusPx >= 0)) {
    throw new RangeError("Shape radius must be a finite non-negative number.");
  }

  return {
    ...semanticShapeClasses,
    mergedRadius: shape === "rounded" ? roundedRadiusPx : 0,
  };
}

const shapeMap: Record<ShapeVariant, ShapeClasses> = {
  rounded: createShapeClasses("rounded", DEFAULT_ROUNDED_SHAPE_RADIUS_PX),
  square: createShapeClasses("square", DEFAULT_ROUNDED_SHAPE_RADIUS_PX),
};

type ShapeContextValue = {
  shape: ShapeVariant;
  setShape: (shape: ShapeVariant) => void;
  classes: ShapeClasses;
};

type ShapeProviderProps = {
  children: ReactNode;
  defaultShape?: ShapeVariant;
  onShapeChange?: (shape: ShapeVariant) => void;
  roundedRadiusPx?: number;
  shape?: ShapeVariant;
};

const ShapeContext = createContext<ShapeContextValue | null>(null);

function useShape(): ShapeClasses {
  return useContext(ShapeContext)?.classes ?? shapeMap.rounded;
}

function useShapeContext(): ShapeContextValue {
  const context = useContext(ShapeContext);
  if (!context) {
    throw new Error("useShapeContext must be used within a ShapeProvider");
  }
  return context;
}

function ShapeProvider({
  children,
  defaultShape = "rounded",
  onShapeChange,
  roundedRadiusPx = DEFAULT_ROUNDED_SHAPE_RADIUS_PX,
  shape: controlledShape,
}: ShapeProviderProps) {
  const [uncontrolledShape, setUncontrolledShape] =
    useState<ShapeVariant>(defaultShape);
  const shape = controlledShape ?? uncontrolledShape;

  const setShape = useCallback(
    (nextShape: ShapeVariant) => {
      if (controlledShape === undefined) {
        setUncontrolledShape(nextShape);
      }
      onShapeChange?.(nextShape);
    },
    [controlledShape, onShapeChange]
  );

  const classes = useMemo(
    () => createShapeClasses(shape, roundedRadiusPx),
    [roundedRadiusPx, shape]
  );
  const value = useMemo(
    () => ({ classes, setShape, shape }),
    [classes, setShape, shape]
  );

  return (
    <ShapeContext.Provider value={value}>{children}</ShapeContext.Provider>
  );
}

export type { ShapeClasses, ShapeProviderProps, ShapeVariant };
export {
  DEFAULT_ROUNDED_SHAPE_RADIUS_PX,
  ShapeProvider,
  shapeMap,
  useShape,
  useShapeContext,
};
