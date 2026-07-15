import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface StorlaunchConfig {
  api_url: string;
  token: string;
  testApiKey?: string;
}

const CONFIG_DIR = join(homedir(), ".storlaunch");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_API_URL = "https://storlaunch.forjio.com/api/v1";

export function getConfigPath(): string {
  return CONFIG_FILE;
}

export function getConfig(): StorlaunchConfig | null {
  if (!existsSync(CONFIG_FILE)) {
    return null;
  }

  try {
    const raw = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(raw) as StorlaunchConfig;
  } catch {
    return null;
  }
}

export function setConfig(updates: Partial<StorlaunchConfig>): StorlaunchConfig {
  mkdirSync(CONFIG_DIR, { recursive: true });

  const existing = getConfig() ?? { api_url: DEFAULT_API_URL, token: "" };
  const config: StorlaunchConfig = { ...existing, ...updates };

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return config;
}

export function clearConfig(): void {
  if (existsSync(CONFIG_FILE)) {
    unlinkSync(CONFIG_FILE);
  }
}

/**
 * Resolves the active API key using the precedence chain:
 * 1. STORLAUNCH_API_KEY env var
 * 2. --sandbox flag (uses testApiKey)
 * 3. Stored token in config
 */
export function resolveApiKey(options?: { sandbox?: boolean }): string | null {
  const envKey = process.env["STORLAUNCH_API_KEY"];
  if (envKey) return envKey;

  const config = getConfig();
  if (!config) return null;

  if (options?.sandbox && config.testApiKey) {
    return config.testApiKey;
  }

  return config.token || null;
}

/**
 * Resolves the API base URL from config or default.
 */
export function resolveApiUrl(): string {
  return getConfig()?.api_url ?? DEFAULT_API_URL;
}
