const backgrounds = [
  "bg-surface-1",
  "bg-surface-2",
  "bg-surface-3",
  "bg-surface-4",
  "bg-surface-5",
  "bg-surface-6",
  "bg-surface-7",
  "bg-surface-8",
];
const shadows = [
  "shadow-surface-1",
  "shadow-surface-2",
  "shadow-surface-3",
  "shadow-surface-4",
  "shadow-surface-5",
  "shadow-surface-6",
  "shadow-surface-7",
  "shadow-surface-8",
];

export function surfaceClasses(level: number, shadowLevel = level): string {
  return `${backgrounds[Math.max(1, Math.min(8, level)) - 1]} ${shadows[Math.max(1, Math.min(8, shadowLevel)) - 1]}`;
}
