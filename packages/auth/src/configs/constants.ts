export const AUTH_SERVICE_NAME = "openmeld-auth";

export const DEFAULT_AUTH_BASE_URL = "http://localhost:8788";

export const AUTH_SECRET_MIN_LENGTH = 44;

export const DEFAULT_AUTH_BRAND_NAME = "OpenMeld";

export const DEFAULT_AUTH_FROM_EMAIL = "OpenMeld <noreply@openmeld.ai>";

export const DEFAULT_MAGIC_LINK_EXPIRES_IN_SECONDS = 60 * 5;

export const DEFAULT_EMAIL_VERIFICATION_EXPIRES_IN_SECONDS = 60 * 60;

export const DEFAULT_OTT_EXPIRES_IN_MINUTES = 10;

export const DEFAULT_DEVICE_ALLOWED_CLIENT_IDS = [
  "openmeld-cli",
  "openmeld-cli-dev",
] as const;

export const AUTH_COOKIE_CACHE_CONFIG = {
  enabled: true,
  maxAge: 60 * 60 * 24, // 1 day
} as const;

export const LAST_USED_LOGIN_METHOD_COOKIE_NAME =
  "openmeld.last_used_login_method";

export const AUTH_RATE_LIMIT_CUSTOM_RULES = {
  "/sign-in/magic-link": {
    window: 10,
    max: 3,
  },
  "/magic-link/*": {
    window: 10,
    max: 3,
  },
  "/sign-up/email": {
    window: 10,
    max: 5,
  },
  "/sign-in/email": {
    window: 10,
    max: 10,
  },
  "/send-verification-email": {
    window: 10,
    max: 5,
  },
  "/one-time-token/generate": {
    window: 10,
    max: 5,
  },
  "/one-time-token/verify": {
    window: 10,
    max: 10,
  },
} as const;

export const AUTHENTICATION_RATE_LIMIT_CONFIG = {
  customRules: AUTH_RATE_LIMIT_CUSTOM_RULES,
} as const;
