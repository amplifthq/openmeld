/**
 * Application shortcut registry. Add global bindings here, not in page components.
 * Command center and sidebar use Cmd/Ctrl; theme uses Shift; navigation uses
 * G followed by a destination within one second. `[` is the sidebar alternative.
 * Web dispatch lives in use-app-keyboard-shortcuts; sidebar state owns its toggle.
 * Editor and dialog-local keys belong to their controls.
 */
export const APPLICATION_SHORTCUTS = {
  commandCenter: "k",
  sidebar: "b",
  sidebarAlternate: "[",
  theme: "d",
  navigationPrefix: "g",
  destinations: {
    h: "home",
    s: "spaces",
    m: "messages",
    p: "people",
    a: "agents",
    i: "inbox",
  },
} as const;

export function blocksLetterShortcuts(event: KeyboardEvent) {
  const target = event.target;
  return (
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    (target instanceof HTMLElement &&
      Boolean(
        target.closest(
          "input,textarea,select,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=dialog],[role=menu]"
        )
      )) ||
    Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
  );
}

export function matchesSidebarShortcut(event: KeyboardEvent) {
  return (
    (event.key === APPLICATION_SHORTCUTS.sidebarAlternate &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey) ||
    (event.key.toLowerCase() === APPLICATION_SHORTCUTS.sidebar &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey)
  );
}
