type InferCookieDomainInput = {
  authUrl: string;
  appUrl: string;
  explicitCookieDomain?: string;
};
const LEADING_DOT_PATTERN = /^\./;

export function normalizeCookieDomain(raw: string): string {
  return raw.trim().replace(LEADING_DOT_PATTERN, "").toLowerCase();
}

export function isCookieDomainSuffixOfHost(
  cookieDomain: string,
  host: string
): boolean {
  return host === cookieDomain || host.endsWith(`.${cookieDomain}`);
}

export function inferCookieDomain(
  input: InferCookieDomainInput
): string | null {
  const { authUrl, appUrl, explicitCookieDomain } = input;

  const authHost = new URL(authUrl).hostname.toLowerCase();
  const appHost = stripWww(new URL(appUrl).hostname.toLowerCase());

  if (explicitCookieDomain?.trim()) {
    const normalized = normalizeCookieDomain(explicitCookieDomain);
    return isCookieDomainSuffixOfHost(normalized, authHost) ? normalized : null;
  }

  return isCookieDomainSuffixOfHost(appHost, authHost) ? appHost : null;
}

function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}
