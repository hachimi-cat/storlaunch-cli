import { describe, it, expect } from "vitest";
import { parseSessionCookie } from "../../lib/buyer-api.js";

describe("parseSessionCookie", () => {
  it("returns null for undefined / empty input", () => {
    expect(parseSessionCookie(undefined)).toBeNull();
    expect(parseSessionCookie([])).toBeNull();
  });

  it("extracts the token and expiresAt from Max-Age", () => {
    const set = ["storlaunch_buyer_session=tok_abc; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax"];
    const parsed = parseSessionCookie(set);
    expect(parsed?.token).toBe("tok_abc");
    expect(parsed?.expiresAt).toBeTypeOf("string");
    // Roughly 30 days in the future
    const diff = new Date(parsed!.expiresAt).getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * 86400 * 1000);
    expect(diff).toBeLessThan(31 * 86400 * 1000);
  });

  it("falls back to 30-day expiry when Max-Age missing", () => {
    const set = ["storlaunch_buyer_session=tok_xyz; Path=/"];
    const parsed = parseSessionCookie(set);
    expect(parsed?.token).toBe("tok_xyz");
    expect(parsed?.expiresAt).toBeTypeOf("string");
  });

  it("ignores cookies with a different name", () => {
    const set = [
      "csrf=abc; Path=/",
      "storlaunch_buyer_session=tok_yes; Max-Age=60; Path=/",
    ];
    const parsed = parseSessionCookie(set);
    expect(parsed?.token).toBe("tok_yes");
  });

  it("returns null when no matching cookie is present", () => {
    const set = ["other=val; Path=/"];
    expect(parseSessionCookie(set)).toBeNull();
  });
});
