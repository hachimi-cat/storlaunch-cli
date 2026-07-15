import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `storlaunch-buyer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return { ...actual, homedir: () => TEST_DIR };
});

const {
  getBuyerSession, setBuyerSession, clearBuyerSession, listBuyerSessions, requireBuyerSession,
} = await import("../../lib/buyer-config.js");

describe("buyer-config", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  it("returns null for unknown slug", () => {
    expect(getBuyerSession("unknown")).toBeNull();
  });

  it("set + get roundtrips a session", () => {
    setBuyerSession({
      accountSlug: "my-shop", email: "alice@test.com",
      token: "tok_abc", expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const got = getBuyerSession("my-shop");
    expect(got?.email).toBe("alice@test.com");
    expect(got?.token).toBe("tok_abc");
  });

  it("clear removes the session file", () => {
    setBuyerSession({
      accountSlug: "shop-x", email: "x@t.com", token: "tok",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    clearBuyerSession("shop-x");
    expect(getBuyerSession("shop-x")).toBeNull();
  });

  it("listBuyerSessions returns all stored sessions", () => {
    setBuyerSession({
      accountSlug: "a", email: "a@t.com", token: "1",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    setBuyerSession({
      accountSlug: "b", email: "b@t.com", token: "2",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    const all = listBuyerSessions();
    expect(all).toHaveLength(2);
    expect(all.map((s) => s.accountSlug).sort()).toEqual(["a", "b"]);
  });

  it("requireBuyerSession throws if no session", () => {
    expect(() => requireBuyerSession("none")).toThrow(/Not signed in/);
  });

  it("requireBuyerSession throws if expired", () => {
    setBuyerSession({
      accountSlug: "exp", email: "e@t.com", token: "t",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(() => requireBuyerSession("exp")).toThrow(/expired/i);
  });

  it("requireBuyerSession returns the session when valid", () => {
    setBuyerSession({
      accountSlug: "ok", email: "k@t.com", token: "t",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const s = requireBuyerSession("ok");
    expect(s.email).toBe("k@t.com");
  });

  it("sessions for different merchants are isolated", () => {
    setBuyerSession({
      accountSlug: "m1", email: "a@t.com", token: "t1",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    setBuyerSession({
      accountSlug: "m2", email: "a@t.com", token: "t2",
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    expect(getBuyerSession("m1")?.token).toBe("t1");
    expect(getBuyerSession("m2")?.token).toBe("t2");
    clearBuyerSession("m1");
    expect(getBuyerSession("m1")).toBeNull();
    expect(getBuyerSession("m2")?.token).toBe("t2");
  });
});
