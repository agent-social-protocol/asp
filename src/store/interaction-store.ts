import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { Interaction } from '../models/interaction.js';

interface InteractionsFile {
  sent: Interaction[];
  received: Interaction[];
}

export async function readInteractions(): Promise<InteractionsFile> {
  const { interactionsPath } = getStorePaths();
  if (!existsSync(interactionsPath)) return { sent: [], received: [] };
  const data = await loadYaml<InteractionsFile>(interactionsPath);
  return { sent: data?.sent || [], received: data?.received || [] };
}

export async function writeInteractions(data: InteractionsFile): Promise<void> {
  await dumpYaml(getStorePaths().interactionsPath, data);
}

export async function addSentInteraction(interaction: Interaction): Promise<void> {
  const data = await readInteractions();
  data.sent.push(interaction);
  await writeInteractions(data);
}

export async function addReceivedInteraction(interaction: Interaction): Promise<void> {
  const data = await readInteractions();
  data.received.push(interaction);
  await writeInteractions(data);
}
