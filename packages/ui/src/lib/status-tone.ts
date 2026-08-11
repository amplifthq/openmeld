export type StatusTone =
  | "checking"
  | "danger"
  | "found"
  | "muted"
  | "ready"
  | "warning";

export type StatusToneIndicatorEmphasis =
  | "bright"
  | "prominent"
  | "quiet"
  | "solid";
export type StatusToneIconEmphasis = "bright" | "quiet";
export type StatusToneSurfaceEmphasis = "standard" | "subtle";

type StatusToneClassBundle = {
  badge: string;
  icon: Record<StatusToneIconEmphasis, string>;
  indicator: Record<StatusToneIndicatorEmphasis, string>;
  prominentBadge: string;
  prominentSurface: string;
  quietText: string;
  ringIndicator: string;
  softText: string;
  strongText: string;
  surface: Record<StatusToneSurfaceEmphasis, string>;
  text: string;
  tint: string;
};

const STATUS_TONE_CLASS_NAMES = {
  checking: {
    badge:
      "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:border-sky-300/35 dark:bg-sky-300/10 dark:text-sky-200/90",
    icon: {
      bright: "text-sky-700 dark:text-sky-300",
      quiet: "text-sky-700 dark:text-sky-600",
    },
    indicator: {
      bright: "bg-sky-700 dark:bg-sky-300",
      prominent: "bg-sky-700 dark:bg-sky-300",
      quiet: "bg-sky-700 dark:bg-sky-400",
      solid: "bg-sky-700 dark:bg-sky-500",
    },
    prominentBadge:
      "border-sky-700/40 bg-sky-700/10 text-sky-700 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200",
    prominentSurface:
      "border-sky-700/40 bg-sky-700/10 dark:border-sky-500/40 dark:bg-sky-500/10",
    quietText: "text-sky-700 dark:text-sky-700",
    ringIndicator:
      "bg-sky-700 ring-sky-700/20 dark:bg-sky-400 dark:ring-sky-400/20",
    softText: "text-sky-700 dark:text-sky-200",
    strongText: "text-sky-700 dark:text-sky-300",
    surface: {
      standard:
        "border-sky-700/30 bg-sky-700/5 dark:border-sky-500/30 dark:bg-sky-500/5",
      subtle:
        "border-sky-700/30 bg-sky-700/5 dark:border-sky-500/30 dark:bg-sky-500/5",
    },
    text: "text-sky-700 dark:text-sky-200/90",
    tint: "bg-sky-700/5 dark:bg-sky-500/5",
  },
  danger: {
    badge:
      "border-destructive/40 bg-destructive/10 text-destructive dark:border-destructive/35 dark:bg-destructive/15",
    icon: {
      bright: "text-destructive",
      quiet: "text-destructive",
    },
    indicator: {
      bright: "bg-destructive",
      prominent: "bg-destructive",
      quiet: "bg-destructive",
      solid: "bg-destructive",
    },
    prominentBadge: "border-destructive/40 bg-destructive/10 text-destructive",
    prominentSurface: "border-destructive bg-destructive/10",
    quietText: "text-destructive",
    ringIndicator: "bg-destructive ring-destructive/25",
    softText: "text-destructive",
    strongText: "text-destructive",
    surface: {
      standard: "border-destructive/35 bg-destructive/5",
      subtle: "border-destructive/35 bg-destructive/5",
    },
    text: "text-destructive",
    tint: "bg-destructive/5",
  },
  found: {
    badge:
      "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:border-violet-300/35 dark:bg-violet-300/10 dark:text-violet-200/90",
    icon: {
      bright: "text-violet-700 dark:text-violet-300",
      quiet: "text-violet-700 dark:text-violet-600",
    },
    indicator: {
      bright: "bg-violet-700 dark:bg-violet-300",
      prominent: "bg-violet-700 dark:bg-violet-300",
      quiet: "bg-violet-700 dark:bg-violet-400",
      solid: "bg-violet-700 dark:bg-violet-500",
    },
    prominentBadge:
      "border-violet-700/40 bg-violet-700/10 text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/10 dark:text-violet-200",
    prominentSurface:
      "border-violet-700/40 bg-violet-700/10 dark:border-violet-500/40 dark:bg-violet-500/10",
    quietText: "text-violet-700 dark:text-violet-700",
    ringIndicator:
      "bg-violet-700 ring-violet-700/20 dark:bg-violet-400 dark:ring-violet-400/20",
    softText: "text-violet-700 dark:text-violet-200",
    strongText: "text-violet-700 dark:text-violet-300",
    surface: {
      standard:
        "border-violet-700/30 bg-violet-700/5 dark:border-violet-500/30 dark:bg-violet-500/5",
      subtle:
        "border-violet-700/25 bg-violet-700/[0.03] dark:border-violet-500/25 dark:bg-violet-500/[0.03]",
    },
    text: "text-violet-700 dark:text-violet-200/90",
    tint: "bg-violet-700/5 dark:bg-violet-500/5",
  },
  muted: {
    badge: "border-border text-muted-foreground",
    icon: {
      bright: "text-muted-foreground",
      quiet: "text-muted-foreground",
    },
    indicator: {
      bright: "bg-muted-foreground",
      prominent: "bg-muted-foreground",
      quiet: "bg-muted-foreground",
      solid: "bg-muted-foreground",
    },
    prominentBadge: "border-border bg-muted/40 text-muted-foreground",
    prominentSurface: "border-border bg-muted/40",
    quietText: "text-muted-foreground",
    ringIndicator: "bg-muted-foreground ring-muted-foreground/20",
    softText: "text-muted-foreground",
    strongText: "text-muted-foreground",
    surface: {
      standard: "border-border bg-muted/10",
      subtle: "border-border/70 bg-background/20",
    },
    text: "text-muted-foreground",
    tint: "bg-muted/10",
  },
  ready: {
    badge:
      "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:border-emerald-300/35 dark:bg-emerald-300/10 dark:text-emerald-200/90",
    icon: {
      bright: "text-emerald-700 dark:text-emerald-400",
      quiet: "text-emerald-700 dark:text-emerald-600",
    },
    indicator: {
      bright: "bg-emerald-700 dark:bg-emerald-400",
      prominent: "bg-emerald-700 dark:bg-emerald-300",
      quiet: "bg-emerald-700 dark:bg-emerald-500",
      solid: "bg-emerald-700 dark:bg-emerald-500",
    },
    prominentBadge:
      "border-emerald-700/40 bg-emerald-700/10 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200",
    prominentSurface:
      "border-emerald-700/40 bg-emerald-700/10 dark:border-emerald-500/40 dark:bg-emerald-500/10",
    quietText: "text-emerald-700 dark:text-emerald-700",
    ringIndicator:
      "bg-emerald-700 ring-emerald-700/20 dark:bg-emerald-500 dark:ring-emerald-500/20",
    softText: "text-emerald-700 dark:text-emerald-200",
    strongText: "text-emerald-700 dark:text-emerald-300",
    surface: {
      standard:
        "border-emerald-700/30 bg-emerald-700/5 dark:border-emerald-500/30 dark:bg-emerald-500/5",
      subtle:
        "border-emerald-700/25 bg-emerald-700/[0.03] dark:border-emerald-500/25 dark:bg-emerald-500/[0.03]",
    },
    text: "text-emerald-700 dark:text-emerald-300",
    tint: "bg-emerald-700/5 dark:bg-emerald-500/5",
  },
  warning: {
    badge:
      "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-300/35 dark:bg-amber-300/10 dark:text-amber-200/90",
    icon: {
      bright: "text-amber-700 dark:text-amber-400",
      quiet: "text-amber-700 dark:text-amber-600",
    },
    indicator: {
      bright: "bg-amber-700 dark:bg-amber-300",
      prominent: "bg-amber-700 dark:bg-amber-300",
      quiet: "bg-amber-700 dark:bg-amber-400",
      solid: "bg-amber-700 dark:bg-amber-500",
    },
    prominentBadge:
      "border-amber-700/40 bg-amber-700/10 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200",
    prominentSurface:
      "border-amber-700/40 bg-amber-700/10 dark:border-amber-500/40 dark:bg-amber-500/10",
    quietText: "text-amber-700 dark:text-amber-700",
    ringIndicator:
      "bg-amber-700 ring-amber-700/20 dark:bg-amber-400 dark:ring-amber-400/20",
    softText: "text-amber-700 dark:text-amber-200",
    strongText: "text-amber-700 dark:text-amber-300",
    surface: {
      standard:
        "border-amber-700/40 bg-amber-700/5 dark:border-amber-500/40 dark:bg-amber-500/5",
      subtle:
        "border-amber-700/35 bg-amber-700/5 dark:border-amber-500/35 dark:bg-amber-500/5",
    },
    text: "text-amber-700 dark:text-amber-200/90",
    tint: "bg-amber-700/5 dark:bg-amber-500/5",
  },
} satisfies Record<StatusTone, StatusToneClassBundle>;

export function resolveStatusToneBadgeClassName(tone: StatusTone): string {
  return STATUS_TONE_CLASS_NAMES[tone].badge;
}

export function resolveStatusToneOutlineBadgeClassName(
  tone: "checking" | "muted"
): string {
  return tone === "checking"
    ? "border-sky-500/35 bg-transparent text-sky-700 dark:border-sky-300/35 dark:text-sky-200/90"
    : "border-border bg-transparent text-muted-foreground";
}

export function resolveStatusToneTextClassName(tone: StatusTone): string {
  return STATUS_TONE_CLASS_NAMES[tone].text;
}

export function resolveStatusToneProminentBadgeClassName(
  tone: StatusTone
): string {
  return STATUS_TONE_CLASS_NAMES[tone].prominentBadge;
}

export function resolveStatusToneCompactBadgeClassName(
  tone: "ready" | "warning"
): string {
  return tone === "ready"
    ? "border-emerald-700/35 bg-emerald-700/10 text-emerald-700 dark:border-emerald-500/35 dark:bg-emerald-500/10 dark:text-emerald-200"
    : "border-amber-700/35 bg-amber-700/10 text-amber-700 dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-200";
}

export function resolveStatusToneStrongBadgeClassName(
  tone: "ready" | "warning"
): string {
  return tone === "ready"
    ? "border-emerald-700/40 bg-emerald-700/10 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
    : "border-amber-700/40 bg-amber-700/10 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300";
}

export function resolveStatusToneProminentSurfaceClassName(
  tone: StatusTone
): string {
  return STATUS_TONE_CLASS_NAMES[tone].prominentSurface;
}

export function resolveStatusToneSurfaceClassName(
  tone: StatusTone,
  emphasis: StatusToneSurfaceEmphasis = "standard"
): string {
  return STATUS_TONE_CLASS_NAMES[tone].surface[emphasis];
}

export function resolveStatusToneTintClassName(tone: StatusTone): string {
  return STATUS_TONE_CLASS_NAMES[tone].tint;
}

export function resolveStatusToneStrongTextClassName(tone: StatusTone): string {
  return STATUS_TONE_CLASS_NAMES[tone].strongText;
}

export function resolveStatusToneSoftTextClassName(tone: StatusTone): string {
  return STATUS_TONE_CLASS_NAMES[tone].softText;
}

export function resolveStatusToneIconClassName(
  tone: StatusTone,
  emphasis: StatusToneIconEmphasis = "bright"
): string {
  return STATUS_TONE_CLASS_NAMES[tone].icon[emphasis];
}

export function resolveStatusToneIndicatorClassName(
  tone: StatusTone,
  emphasis: StatusToneIndicatorEmphasis = "bright"
): string {
  return STATUS_TONE_CLASS_NAMES[tone].indicator[emphasis];
}

export function resolveStatusToneRingIndicatorClassName(
  tone: StatusTone
): string {
  return STATUS_TONE_CLASS_NAMES[tone].ringIndicator;
}

export function resolveInformationStatusBadgeClassName(): string {
  return "border-blue-700/40 bg-blue-700/10 text-blue-700 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200";
}

export function resolveStatusToneAdvisoryBadgeClassName(): string {
  return "border-amber-700/35 bg-amber-700/10 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-100";
}

export function resolveStatusToneAttentionItemClassName(
  tone: "danger" | "warning"
): string {
  return tone === "danger"
    ? "!text-destructive hover:!text-destructive focus-visible:!text-destructive"
    : "!text-amber-700 hover:!text-amber-700 focus-visible:!text-amber-700 dark:!text-amber-300 dark:hover:!text-amber-300 dark:focus-visible:!text-amber-300";
}

export function resolveStatusToneInteractiveTextClassName(
  tone: "danger" | "warning"
): string {
  return tone === "danger"
    ? "text-destructive hover:text-destructive"
    : "text-amber-700 hover:text-amber-600 dark:text-amber-300 dark:hover:text-amber-200";
}

export function resolveStatusToneOutlineActionClassName(
  tone: "danger" | "warning"
): string {
  return tone === "danger"
    ? "border-destructive/40 text-destructive hover:bg-destructive/10"
    : "border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:border-amber-300/35 dark:text-amber-200/90";
}

export function resolveStatusToneQuietTextClassName(tone: StatusTone): string {
  return STATUS_TONE_CLASS_NAMES[tone].quietText;
}

export function resolveStatusToneWarningNoticeClassName(): string {
  return "border-amber-700/60 bg-amber-700/10 text-amber-700 dark:border-amber-500/60 dark:bg-amber-500/10 dark:text-amber-300";
}

export function resolveStatusToneOpaqueWarningSurfaceClassName(): string {
  return "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-300/60 dark:bg-amber-50 dark:text-amber-900";
}

export function resolveStatusToneVerificationIconClassName(
  tone: "ready" | "warning"
): string {
  return tone === "ready"
    ? "text-green-700 dark:text-green-600"
    : "text-orange-700 dark:text-orange-500";
}
