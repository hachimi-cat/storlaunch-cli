import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdirSync, existsSync, unlinkSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Must define TEST_DIR before vi.mock so the hoisted mock can reference it
const TEST_DIR = join(tmpdir(), `storlaunch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const CONFIG_DIR = join(TEST_DIR, ".storlaunch");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => TEST_DIR,
  };
});

// Import after mock is defined
const { getConfig, setConfig, clearConfig, getConfigPath, resolveApiKey, resolveApiUrl } = await import("../../lib/config.js");

describe("config", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Clean config between tests
    if (existsSync(CONFIG_FILE)) unlinkSync(CONFIG_FILE);
    if (existsSync(CONFIG_DIR)) rmSync(CONFIG_DIR, { recursive: true, force: true });
    // Clear env
    delete process.env["STORLAUNCH_API_KEY"];
  });

  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env["STORLAUNCH_API_KEY"];
  });

  it("getConfigPath returns correct path", () => {
    expect(getConfigPath()).toBe(CONFIG_FILE);
  });

  it("getConfig returns null when no config file", () => {
    expect(getConfig()).toBeNull();
  });

  it("setConfig creates config with defaults", () => {
    const result = setConfig({ token: "sk_live_abc123" });
    expect(result.token).toBe("sk_live_abc123");
    expect(result.api_url).toBe("https://storlaunch.forjio.com/api/v1");
    expect(existsSync(CONFIG_FILE)).toBe(true);
  });

  it("setConfig merges with existing config", () => {
    setConfig({ token: "sk_live_abc" });
    setConfig({ testApiKey: "sk_test_xyz" });

    const config = getConfig()!;
    expect(config.token).toBe("sk_live_abc");
    expect(config.testApiKey).toBe("sk_test_xyz");
  });

  it("clearConfig removes config file", () => {
    setConfig({ token: "sk_live_abc" });
    expect(existsSync(CONFIG_FILE)).toBe(true);

    clearConfig();
    expect(existsSync(CONFIG_FILE)).toBe(false);
  });

  it("clearConfig is safe when no config exists", () => {
    expect(() => clearConfig()).not.toThrow();
  });

  describe("resolveApiKey", () => {
    it("returns env var first (highest precedence)", () => {
      setConfig({ token: "sk_live_stored", testApiKey: "sk_test_stored" });
      process.env["STORLAUNCH_API_KEY"] = "sk_env_override";

      expect(resolveApiKey()).toBe("sk_env_override");
      expect(resolveApiKey({ sandbox: true })).toBe("sk_env_override");
    });

    it("returns testApiKey when sandbox flag is set", () => {
      setConfig({ token: "sk_live_prod", testApiKey: "sk_test_sandbox" });
      expect(resolveApiKey({ sandbox: true })).toBe("sk_test_sandbox");
    });

    it("returns stored token by default", () => {
      setConfig({ token: "sk_live_default" });
      expect(resolveApiKey()).toBe("sk_live_default");
    });

    it("returns null when no config and no env", () => {
      expect(resolveApiKey()).toBeNull();
    });
  });

  describe("resolveApiUrl", () => {
    it("returns default URL when no config", () => {
      expect(resolveApiUrl()).toBe("https://storlaunch.forjio.com/api/v1");
    });

    it("returns custom URL from config", () => {
      setConfig({ api_url: "https://custom.api/v1", token: "" });
      expect(resolveApiUrl()).toBe("https://custom.api/v1");
    });
  });
});
