import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveUserTimezone,
  getUserTimezone,
  formatUserClock,
  userTimeZoneLabel,
} from "@/utils/user-timezone";

test("valid IANA names pass through", () => {
  assert.equal(resolveUserTimezone("Asia/Jakarta"), "Asia/Jakarta");
  assert.equal(resolveUserTimezone("America/New_York"), "America/New_York");
  assert.equal(resolveUserTimezone("UTC"), "UTC");
});

test("blank and invalid zones resolve to null (UTC fallback)", () => {
  assert.equal(resolveUserTimezone(""), null);
  assert.equal(resolveUserTimezone("  "), null);
  assert.equal(resolveUserTimezone("Not/AZone"), null);
  assert.equal(resolveUserTimezone(null), null);
  assert.equal(resolveUserTimezone(42), null);
});

test("overlong input rejected", () => {
  assert.equal(resolveUserTimezone("a".repeat(65)), null);
});

test("detected timezone is a usable string or null", () => {
  const detected = getUserTimezone();
  assert.ok(
    detected === null || (typeof detected === "string" && detected.length > 0),
  );
});

test("clock formats user-local HH:MM in the given zone", () => {
  // 2026-09-26T01:23:00Z == 08:23 WIB.
  const date = new Date("2026-09-26T01:23:00Z");
  assert.equal(formatUserClock(date, "Asia/Jakarta"), "08:23");
  assert.equal(formatUserClock(date, "UTC"), "01:23");
  assert.match(formatUserClock(date, null), /^\d{2}:\d{2}$/);
});

test("zone label prefers short name with GMT fallback", () => {
  assert.equal(userTimeZoneLabel("Asia/Jakarta"), "WIB");
  assert.match(userTimeZoneLabel("Not/AZone"), /^(GMT[+-]\d+|local)$/);
});
