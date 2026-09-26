import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveUserTimezone, getUserTimezone } from "@/utils/user-timezone";

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
