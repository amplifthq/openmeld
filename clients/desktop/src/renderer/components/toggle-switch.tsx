type ToggleSwitchProps = {
  checked: boolean;
  disabled?: boolean;
  busy?: boolean;
  label: string;
  onChange: (next: boolean) => void;
};

export function ToggleSwitch({
  checked,
  disabled = false,
  busy = false,
  label,
  onChange,
}: ToggleSwitchProps) {
  return (
    <button
      aria-busy={busy}
      aria-checked={checked}
      aria-label={`${checked ? "Disable" : "Enable"} ${label}`}
      className="relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50"
      disabled={disabled || busy}
      onClick={() => onChange(!checked)}
      role="switch"
      style={{
        background: checked ? "#10b981" : "var(--color-border, #3f3f46)",
      }}
      type="button"
    >
      <span
        className="absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform"
        style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
      />
    </button>
  );
}
