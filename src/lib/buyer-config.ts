import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Buyer sessions are per-merchant. Stored separately from the seller config
 * so that logging into merchant A doesn't affect merchant B.
 *
 * Layout:
 *   ~/.storlaunch/buyer/<merchant-slug>.json
 */

export interface BuyerSession {
  accountSlug: string;
  email: string;
  // The raw cookie value (opaque token from server) — sent back as Cookie header.
  token: string;
  // ISO timestamp — server enforces real expiry, this is for UX hints.
  expiresAt: string;
}

const BUYER_DIR = join(homedir(), ".storlaunch", "buyer");

function fileFor(slug: string): string {
  return join(BUYER_DIR, `${slug}.json`);
}

export function getBuyerSession(slug: string): BuyerSession | null {
  const f = fileFor(slug);
  if (!existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf-8")) as BuyerSession;
  } catch {
    return null;
  }
}

export function setBuyerSession(session: BuyerSession): void {
  mkdirSync(BUYER_DIR, { recursive: true });
  writeFileSync(fileFor(session.accountSlug), JSON.stringify(session, null, 2) + "\n", "utf-8");
}

export function clearBuyerSession(slug: string): void {
  const f = fileFor(slug);
  if (existsSync(f)) unlinkSync(f);
}

export function listBuyerSessions(): BuyerSession[] {
  if (!existsSync(BUYER_DIR)) return [];
  const files = readdirSync(BUYER_DIR).filter((f) => f.endsWith(".json"));
  const sessions: BuyerSession[] = [];
  for (const f of files) {
    try {
      sessions.push(JSON.parse(readFileSync(join(BUYER_DIR, f), "utf-8")) as BuyerSession);
    } catch {
      // Skip corrupt sessions
    }
  }
  return sessions;
}

/**
 * Ensures a session is active for the given slug. Returns the token. If no
 * session exists OR the local record says it's expired, throws — caller should
 * prompt `storlaunch buy auth login --merchant <slug>`.
 */
export function requireBuyerSession(slug: string): BuyerSession {
  const session = getBuyerSession(slug);
  if (!session) {
    throw new Error(`Not signed in to ${slug}. Run: storlaunch buy auth login --merchant ${slug}`);
  }
  if (new Date(session.expiresAt) < new Date()) {
    throw new Error(`Session for ${slug} expired. Run: storlaunch buy auth login --merchant ${slug}`);
  }
  return session;
}
