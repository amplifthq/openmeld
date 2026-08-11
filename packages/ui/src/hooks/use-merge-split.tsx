"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ItemRect } from "#hooks/use-proximity-hover";

// Run the layout effect on the client (where it must fire before paint, so a
// merge/split shows on the first frame) and a no-op-safe useEffect on the server.
const useIsoLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

// Edge spring for the selected-bg merge/split: moderate, no bounce so converging
// edges meet exactly instead of overshooting. On a merge the inner corners trail
// by `cornerDelay`, staying rounded until the halves meet.
const mergeSpring = { type: "spring" as const, duration: 0.16, bounce: 0 };
const cornerDelay = 0.07;
// A boundary resolves after its motion finishes (merge → swap to one block;
// split → drop), driven by a duration timer rather than onAnimationComplete —
// framer skips that callback when an animation's target equals its current value
// (which spam-toggling produces), which would otherwise strand a half. The
// buffer biases late, by which point the halves have met/parted, so it's unseen.
const convergeMs = (mergeSpring.duration + cornerDelay) * 1000 + 80;
const splitMs = mergeSpring.duration * 1000 + 80;

// A selected-background block for one render. A run is normally one block; mid
// merge/split it is drawn as two abutting halves with sharp inner corners.
type Rect = { top: number; left: number; width: number; height: number };
export interface SelBlock extends Rect {
  key: string;
  radii: [number, number, number, number]; // tl, tr, br, bl
  instant: boolean; // skip the spring (the zero-shift swap, the split snap-in)
  exitInstant: boolean; // drop without the fade (absorbed half at the swap)
  delayCorners: boolean; // trail the corner straightening (merge converge)
  cornerDelay?: number; // optional per-block delay override
  opacity?: number; // override the hover-derived opacity (commit ghost = 0)
  // State a fresh block animates *from* on mount, so it springs into place
  // instead of snapping when continuity is lost (fast toggling) or the block is
  // inherently new (a split's lower half). Continuous blocks ignore it.
  enterFrom?: {
    top: number;
    height: number;
    radii: [number, number, number, number];
  };
}

// A contiguous run of selected/checked rows, with a stable id so framer-motion
// can morph it across renders rather than exit+re-enter.
export type Run = { start: number; end: number; id: number };

// One in-flight merge or split; geometry is recomputed from the live runs each
// render so rapid toggles redirect instead of freezing.
type Boundary = {
  tid: number;
  kind: "merge" | "split";
  survivorId: number; // persisting run (merged run / split's upper run)
  otherId: number; // merge: absorbed run; split: new lower run
  gapIndex: number; // bridging/deselected row — where the halves meet
  phase: "converge" | "commit" | "splitIn" | "diverge";
};

// Two runs within `outer`, ordered, separated by exactly one row (a single-row
// bridge — the only shape a click can merge or split).
function bridgePair(
  outer: Run,
  runs: Run[]
): { gap: number; lo: Run; up: Run } | null {
  const inside = runs
    .filter((r) => r.start >= outer.start && r.end <= outer.end)
    .sort((a, b) => a.start - b.start);
  if (inside.length !== 2) {
    return null;
  }
  const up = inside[0];
  const lo = inside[1];
  if (!(up && lo)) {
    return null;
  }
  return lo.start === up.end + 2 ? { up, lo, gap: up.end + 1 } : null;
}

// Two prev runs collapsing into one (merge) and one prev run splitting into
// two (split), each bridged by exactly one row.
function detectBoundaries(
  prev: Run[],
  cur: Run[],
  nextTid: () => number
): Boundary[] {
  const found: Boundary[] = [];
  for (const c of cur) {
    const p = bridgePair(c, prev);
    if (p && (c.id === p.up.id || c.id === p.lo.id)) {
      found.push({
        tid: nextTid(),
        kind: "merge",
        survivorId: c.id,
        otherId: c.id === p.up.id ? p.lo.id : p.up.id,
        gapIndex: p.gap,
        phase: "converge",
      });
    }
  }
  for (const p of prev) {
    const c = bridgePair(p, cur);
    if (c) {
      found.push({
        tid: nextTid(),
        kind: "split",
        survivorId: c.up.id,
        otherId: c.lo.id,
        gapIndex: c.gap,
        phase: "splitIn",
      });
    }
  }
  return found;
}

// A merge boundary stays valid while the survivor still spans the gap; a split
// boundary while its two runs still abut the gap from both sides.
function boundaryStillValid(boundary: Boundary, runs: Run[]): boolean {
  if (boundary.kind === "merge") {
    return runs.some(
      (c) =>
        c.id === boundary.survivorId &&
        boundary.gapIndex > c.start &&
        boundary.gapIndex < c.end
    );
  }
  return (
    runs.some(
      (c) => c.id === boundary.survivorId && c.end === boundary.gapIndex - 1
    ) &&
    runs.some(
      (c) => c.id === boundary.otherId && c.start === boundary.gapIndex + 1
    )
  );
}

// Motion window elapsed: a merge swaps to its committed single block; a split
// is dropped so the halves diverge as independent runs.
function resolveBoundaryAfterTimeout(
  boundaries: Boundary[],
  tid: number
): Boundary[] {
  if (!boundaries.some((b) => b.tid === tid)) {
    return boundaries;
  }
  return boundaries.flatMap((b) => {
    if (b.tid !== tid) {
      return [b];
    }
    if (b.kind === "merge") {
      return [{ ...b, phase: "commit" as const }];
    }
    return [];
  });
}

// ── Merge / split boundary animation ─────────────────────────────
// When one unselected row bridges two selected runs, their inner edges glide to
// the bridging row's midpoint (facing corners straightening to sharp), then swap
// to one block with no visible motion — instead of the surviving block
// spring-growing over the whole union. Deselecting a middle row plays the
// inverse: snap into two abutting halves, then glide apart.
//
// Given the contiguous selection `runs` (with stable ids), the measured
// `itemRects`, and the corner radius `R` to round to, this returns the list of
// background blocks to paint — one per run, or two abutting halves for any run
// currently mid merge/split. Render them with <SelectionBackgrounds>.
export function useMergeSplitBlocks(
  runs: Run[],
  itemRects: ItemRect[],
  R: number
): SelBlock[] {
  const [boundaries, setBoundaries] = useState<Boundary[]>([]);
  const prevRunsRef = useRef<Run[]>([]);
  const tidRef = useRef(0);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const runsSig = runs.map((g) => `${g.id}:${g.start}-${g.end}`).join("|");

  // Detect merges/splits before paint (so the first frame already shows the
  // halves) and drop any boundary the latest selection invalidated (e.g. the
  // bridge row was toggled again mid-flight).
  useIsoLayoutEffect(() => {
    const prev = prevRunsRef.current;
    const cur = runs;
    const found = detectBoundaries(prev, cur, () => ++tidRef.current);
    prevRunsRef.current = cur.map((r) => ({ ...r }));
    // Resolve each new boundary after its motion window (merge → swap to one
    // block; split → drop), so an interrupted animation can't strand a half.
    for (const b of found) {
      timersRef.current.set(
        b.tid,
        setTimeout(
          () => {
            timersRef.current.delete(b.tid);
            setBoundaries((bs) => resolveBoundaryAfterTimeout(bs, b.tid));
          },
          b.kind === "merge" ? convergeMs : splitMs
        )
      );
    }
    setBoundaries((active) => [
      ...active.filter((b) => boundaryStillValid(b, cur)),
      ...found,
    ]);
  }, [runsSig]);

  // Clear any pending timers on unmount.
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  // Follow-up render: a fresh split holds its abutting frame once then
  // diverges; a committed merge is dropped.
  useEffect(() => {
    if (
      !boundaries.some((b) => b.phase === "splitIn" || b.phase === "commit")
    ) {
      return;
    }
    setBoundaries((bs) =>
      bs.flatMap((b) =>
        b.phase === "commit"
          ? []
          : [{ ...b, phase: b.phase === "splitIn" ? "diverge" : b.phase }]
      )
    );
  }, [boundaries]);

  return buildSelectionBlocks({
    boundaries,
    itemRects,
    prevRuns: prevRunsRef.current,
    radius: R,
    runs,
  });
}

// Build the blocks to paint: one per run, overridden into abutting halves for
// any run in an in-flight boundary.
function buildSelectionBlocks(input: {
  boundaries: Boundary[];
  itemRects: ItemRect[];
  prevRuns: Run[];
  radius: number;
  runs: Run[];
}): SelBlock[] {
  const { boundaries, itemRects, prevRuns, radius, runs } = input;
  const blocks: SelBlock[] = [];
  for (const run of runs) {
    const r = runRect(run, itemRects);
    if (r) {
      blocks.push({
        key: `sel-${run.id}`,
        ...r,
        radii: [radius, radius, radius, radius],
        instant: false,
        exitInstant: false,
        delayCorners: false,
      });
    }
  }
  const byId = new Map(blocks.map((b) => [b.key, b]));
  for (const b of boundaries) {
    applyBoundaryOverride({ blocks, boundary: b, byId, itemRects, radius });
  }

  // Split safety net, pinned synchronously. The split boundary above is created
  // in a layout effect that runs *after* this render, so on the very frame a
  // split first appears its fresh lower half would mount at its final rect and
  // snap. Detecting the split here (previous runs vs current) and pinning both
  // halves at the seam guarantees the lower mounts on the seam regardless of
  // render/paint timing (the cause of the rapid-toggle snap).
  for (const p of prevRuns) {
    const c = bridgePair(p, runs);
    const gap = c && itemRects[c.gap];
    if (!(c && gap)) {
      continue;
    }
    const up = byId.get(`sel-${c.up.id}`);
    const lo = byId.get(`sel-${c.lo.id}`);
    if (!(up && lo)) {
      continue;
    }
    pinSplitHalvesAtSeam({
      lo,
      midY: gap.top + gap.height / 2,
      radius,
      up,
    });
  }

  return blocks;
}

function runRect(run: Run, itemRects: ItemRect[]): Rect | null {
  const s = itemRects[run.start];
  const e = itemRects[run.end];
  if (!(s && e)) {
    return null;
  }
  return {
    top: s.top,
    left: Math.min(s.left, e.left),
    width: Math.max(s.width, e.width),
    height: e.top + e.height - s.top,
  };
}

function applyBoundaryOverride(input: {
  blocks: SelBlock[];
  boundary: Boundary;
  byId: Map<string, SelBlock>;
  itemRects: ItemRect[];
  radius: number;
}): void {
  const { blocks, boundary, byId, itemRects, radius } = input;
  const gap = itemRects[boundary.gapIndex];
  const sv = byId.get(`sel-${boundary.survivorId}`);
  if (!(gap && sv)) {
    return;
  }
  const midY = gap.top + gap.height / 2;
  if (boundary.kind === "merge") {
    applyMergeOverride({ blocks, boundary, gap, midY, radius, sv });
    return;
  }
  if (boundary.phase === "splitIn") {
    const lo = byId.get(`sel-${boundary.otherId}`);
    if (!lo) {
      return;
    }
    // Pin both halves at the seam (identical to the single block); the
    // diverge render then springs them to their real rects.
    pinSplitHalvesAtSeam({ lo, midY, radius, up: sv });
  }
  // diverge: nothing to override — the steady blocks spring to their real
  // rects from the seam; the timer drops the boundary.
}

function applyMergeOverride(input: {
  blocks: SelBlock[];
  boundary: Boundary;
  gap: ItemRect;
  midY: number;
  radius: number;
  sv: SelBlock;
}): void {
  const { blocks, boundary, gap, midY, radius, sv } = input;
  if (boundary.phase === "commit") {
    // Zero-shift swap: survivor jumps to the full union (already covered by
    // its top half + the absorbed bottom half). The absorbed half is held
    // one render at opacity 0 so removing it next render can't flash a
    // one-frame overlap with the now-full survivor.
    sv.instant = true;
    blocks.push({
      key: `sel-${boundary.otherId}`,
      top: midY,
      left: sv.left,
      width: sv.width,
      height: sv.top + sv.height - midY,
      radii: [0, 0, radius, radius],
      instant: true,
      exitInstant: true,
      delayCorners: false,
      opacity: 0,
    });
    return;
  }
  // converge: survivor → top half, absorbed run → bottom-half ghost, inner
  // corners straightening to sharp.
  // Slightly trail lower merges while keeping a baseline and small cap.
  const mergeCornerDelay = Math.min(
    cornerDelay + 0.03,
    Math.max(
      cornerDelay,
      cornerDelay + (midY / Math.max(gap.height, 1)) * 0.002
    )
  );
  const bottom = sv.top + sv.height;
  sv.height = midY - sv.top;
  sv.radii = [radius, radius, 0, 0];
  sv.delayCorners = true;
  sv.cornerDelay = mergeCornerDelay;
  blocks.push({
    key: `sel-${boundary.otherId}`,
    top: midY,
    left: sv.left,
    width: sv.width,
    height: bottom - midY,
    radii: [0, 0, radius, radius],
    // Mount at full corners so a fresh ghost still animates the
    // straightening with the same delay as the survivor.
    enterFrom: {
      top: midY,
      height: bottom - midY,
      radii: [radius, radius, radius, radius],
    },
    instant: false,
    exitInstant: true,
    delayCorners: true,
    cornerDelay: mergeCornerDelay,
  });
}

// Pin both halves of a split at the seam so the lower half mounts on the seam
// and the diverge render springs them apart without a snap.
function pinSplitHalvesAtSeam(input: {
  lo: SelBlock;
  midY: number;
  radius: number;
  up: SelBlock;
}): void {
  const { lo, midY, radius, up } = input;
  const bottom = lo.top + lo.height;
  up.height = midY - up.top;
  up.radii = [radius, radius, 0, 0];
  up.instant = true;
  lo.top = midY;
  lo.height = bottom - midY;
  lo.radii = [0, 0, radius, radius];
  lo.instant = true;
  lo.enterFrom = {
    top: midY,
    height: bottom - midY,
    radii: [0, 0, radius, radius],
  };
}

// Renders the selected-background blocks produced by useMergeSplitBlocks — one
// per run, or two abutting halves mid merge/split. `dimmed` drops the opacity to
// 0.8 (when the user is hovering a non-selected row) to match the standalone
// hover indicator; a block's own `opacity` override (e.g. the commit ghost)
// always wins. Corners are driven numerically so merge/split can straighten and
// re-round individual corners.
export function SelectionBackgrounds({
  blocks,
  dimmed,
}: {
  blocks: SelBlock[];
  dimmed: boolean;
}) {
  return (
    <AnimatePresence>
      {blocks.map((b) => {
        const corner = b.delayCorners
          ? { ...mergeSpring, delay: b.cornerDelay ?? cornerDelay }
          : mergeSpring;
        const opacity = b.opacity ?? (dimmed ? 0.8 : 1);
        return (
          <motion.div
            animate={{
              top: b.top,
              left: b.left,
              width: b.width,
              height: b.height,
              borderTopLeftRadius: b.radii[0],
              borderTopRightRadius: b.radii[1],
              borderBottomRightRadius: b.radii[2],
              borderBottomLeftRadius: b.radii[3],
              opacity,
            }}
            aria-hidden
            className="pointer-events-none absolute bg-muted"
            exit={{
              opacity: 0,
              transition: { duration: b.exitInstant ? 0 : 0.12 },
            }}
            initial={
              b.enterFrom
                ? {
                    opacity,
                    top: b.enterFrom.top,
                    left: b.left,
                    width: b.width,
                    height: b.enterFrom.height,
                    borderTopLeftRadius: b.enterFrom.radii[0],
                    borderTopRightRadius: b.enterFrom.radii[1],
                    borderBottomRightRadius: b.enterFrom.radii[2],
                    borderBottomLeftRadius: b.enterFrom.radii[3],
                  }
                : false
            }
            key={b.key}
            transition={
              b.instant
                ? { duration: 0 }
                : {
                    ...mergeSpring,
                    borderTopLeftRadius: corner,
                    borderTopRightRadius: corner,
                    borderBottomRightRadius: corner,
                    borderBottomLeftRadius: corner,
                    opacity: { duration: 0.08 },
                  }
            }
          />
        );
      })}
    </AnimatePresence>
  );
}
