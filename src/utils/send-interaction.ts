import type { Interaction } from '../models/interaction.js';
import { interactionToInboxEntry } from './inbox-entry.js';
import { sendEntry } from './send-entry.js';

export async function sendInteraction(endpointUrl: string, interaction: Interaction): Promise<{ ok: boolean; error?: string }> {
  return sendEntry(endpointUrl, interactionToInboxEntry(interaction));
}
