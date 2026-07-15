import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

/**
 * Minimal interactive prompt helpers (no extra deps). For production UX we'd
 * use inquirer/enquirer; this covers CLI flows without bloating the bundle.
 */

let _rl: ReturnType<typeof createInterface> | null = null;
function rl() {
  if (!_rl) _rl = createInterface({ input: stdin, output: stdout });
  return _rl;
}

export async function prompt(question: string): Promise<string> {
  const r = rl();
  const answer = await r.question(`${question} `);
  return answer.trim();
}

export async function promptChoice<T extends { label: string }>(
  title: string,
  choices: T[]
): Promise<T | null> {
  if (choices.length === 0) return null;
  console.log(`\n${title}`);
  choices.forEach((c, i) => console.log(`  ${i + 1}. ${c.label}`));
  while (true) {
    const answer = await prompt(`Choice [1-${choices.length}]:`);
    const n = parseInt(answer, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= choices.length) return choices[n - 1];
    console.log("Invalid choice.");
  }
}

export async function promptConfirm(question: string): Promise<boolean> {
  const answer = (await prompt(`${question} (y/N):`)).toLowerCase();
  return answer === "y" || answer === "yes";
}

export function closePrompt(): void {
  if (_rl) { _rl.close(); _rl = null; }
}
