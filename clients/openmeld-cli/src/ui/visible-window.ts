export function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

export function resolveAnchoredVisibleWindow(input: {
  anchorIndex: number | null;
  itemCount: number;
  maxVisible: number;
}): { end: number; start: number } {
  if (input.itemCount <= input.maxVisible) {
    return {
      start: 0,
      end: input.itemCount,
    };
  }

  const anchor =
    input.anchorIndex === null
      ? 0
      : clampNumber(input.anchorIndex, 0, input.itemCount - 1);
  const centeredStart = anchor - Math.floor(input.maxVisible / 2);
  const maxStart = input.itemCount - input.maxVisible;
  const start = clampNumber(centeredStart, 0, maxStart);
  return {
    start,
    end: Math.min(input.itemCount, start + input.maxVisible),
  };
}

export function resolveOffsetVisibleWindow(input: {
  itemCount: number;
  maxVisible: number;
  offset: number;
}): { end: number; start: number } {
  if (input.itemCount <= input.maxVisible) {
    return {
      start: 0,
      end: input.itemCount,
    };
  }

  const maxStart = Math.max(0, input.itemCount - input.maxVisible);
  const start = resolveVisibleWindowOffset(input.offset, maxStart);
  return {
    start,
    end: Math.min(input.itemCount, start + input.maxVisible),
  };
}

function resolveVisibleWindowOffset(offset: number, maxStart: number): number {
  if (!Number.isFinite(offset)) {
    return offset > 0 ? maxStart : 0;
  }

  return clampNumber(offset, 0, maxStart);
}
