export function isDesktopAppHref(href: string): boolean {
  try {
    const url = new URL(href, "https://desktop.invalid");
    return (
      url.origin === "https://desktop.invalid" &&
      (url.pathname === "/" ||
        url.pathname.startsWith("/o/") ||
        url.pathname === "/invitation-requests" ||
        url.pathname === "/file-preview")
    );
  } catch {
    return false;
  }
}
