import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

let rl: ReturnType<typeof createInterface> | null = null;

function getRL() {
  if (!rl) {
    rl = createInterface({ input: stdin, output: stdout });
    rl.on('close', () => { rl = null; });
  }
  return rl;
}

export async function prompt(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : '';
  const answer = await getRL().question(`${question}${suffix}: `);
  return answer.trim() || defaultValue || '';
}

export function closePrompts(): void {
  if (rl) {
    rl.close();
    rl = null;
  }
}
