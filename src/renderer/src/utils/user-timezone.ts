/**
 * Best-effort user/session timezone for backend World State time rules.
 *
 * The browser knows the user's IANA zone; the backend only ever sees UTC.
 * Sending the zone name lets the backend derive time_context (and
 * day/night rules) from the user-local hour while persistence stays
 * canonical UTC. Unknown/empty resolves to null -> server-UTC fallback.
 */

export function resolveUserTimezone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > 64) return null;
  try {
    // Validate against the platform zone database without keeping anything.
    Intl.DateTimeFormat(undefined, { timeZone: name });
    return name;
  } catch (error) {
    console.warn("Ignoring invalid user timezone:", name);
    return null;
  }
}

export function getUserTimezone(): string | null {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return resolveUserTimezone(detected);
  } catch (error) {
    console.warn("Unable to detect user timezone:", error);
    return null;
  }
}
