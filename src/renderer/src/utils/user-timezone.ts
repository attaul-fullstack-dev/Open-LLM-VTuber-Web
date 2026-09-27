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

/**
 * Current user-local clock as stable HH:MM (pure, unit-testable).
 * Uses the same zone sent to the backend, so the widget clock always
 * agrees with the time_context derivation. Falls back to device-local.
 */
export function formatUserClock(date: Date, tz: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      ...(tz ? { timeZone: tz } : {}),
    }).formatToParts(date);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? "";
    const hour = get("hour") === "24" ? "00" : get("hour");
    return `${hour}:${get("minute")}`;
  } catch (error) {
    console.warn("Unable to format user clock:", error);
    return "—";
  }
}

/**
 * Short zone label for the clock row (pure, unit-testable).
 * Prefers a localized short name ("WIB"); falls back to a GMT offset,
 * then to plain "local" when nothing resolves.
 */
export function userTimeZoneLabel(tz: string | null): string {
  const shortName = (locale: string): string | null => {
    try {
      const label = new Intl.DateTimeFormat(locale, {
        timeZone: tz ?? undefined,
        timeZoneName: "short",
      })
        .formatToParts(new Date())
        .find((part) => part.type === "timeZoneName")?.value;
      if (label && !label.startsWith("GMT")) return label;
      return null;
    } catch (error) {
      console.warn("Unable to resolve zone label:", error);
      return null;
    }
  };
  if (tz) {
    // Indonesian first: Asia/Jakarta -> "WIB" where CLDR data is present.
    const localized = shortName("id") ?? shortName("en-US");
    if (localized) return localized;
  }
  try {
    const offset = new Intl.DateTimeFormat("en-US", {
      ...(tz ? { timeZone: tz } : {}),
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    if (offset) return offset;
  } catch (error) {
    console.warn("Unable to resolve zone offset:", error);
  }
  return "local";
}
