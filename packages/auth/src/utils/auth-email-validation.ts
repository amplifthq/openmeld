const EMAIL_DOMAIN_LABEL_PATTERN = /^[A-Za-z0-9-]+$/;
const EMAIL_LOCAL_PART_PATTERN = /^[^\s@]+$/;

export function validateAuthEmailAddress(email: string): boolean {
  const trimmedEmail = email.trim();
  if (trimmedEmail !== email) {
    return false;
  }

  const parts = email.split("@");
  if (parts.length !== 2) {
    return false;
  }

  const [localPart, domain] = parts;
  if (!(localPart && domain)) {
    return false;
  }
  if (!EMAIL_LOCAL_PART_PATTERN.test(localPart)) {
    return false;
  }

  const domainLabels = domain.split(".");
  if (domainLabels.length < 2) {
    return false;
  }

  return domainLabels.every(
    (label) =>
      label.length > 0 &&
      EMAIL_DOMAIN_LABEL_PATTERN.test(label) &&
      !label.startsWith("-") &&
      !label.endsWith("-")
  );
}
