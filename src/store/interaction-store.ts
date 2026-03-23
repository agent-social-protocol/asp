import type { Interaction } from '../models/interaction.js';
import { addReceivedEntry, addSentEntry, readInbox, writeInbox } from './inbox-store.js';
import { inboxEntryToInteraction, interactionToInboxEntry } from '../utils/inbox-entry.js';

interface InteractionsFile {
  sent: Interaction[];
  received: Interaction[];
}

export async function readInteractions(): Promise<InteractionsFile> {
  const data = await readInbox();
  return {
    sent: data.sent
      .map(inboxEntryToInteraction)
      .filter((interaction): interaction is Interaction => interaction !== null),
    received: data.received
      .map(inboxEntryToInteraction)
      .filter((interaction): interaction is Interaction => interaction !== null),
  };
}

export async function writeInteractions(data: InteractionsFile): Promise<void> {
  const inbox = await readInbox();
  inbox.sent = [
    ...inbox.sent.filter((entry) => entry.kind !== 'interaction'),
    ...data.sent.map(interactionToInboxEntry),
  ];
  inbox.received = [
    ...inbox.received.filter((entry) => entry.kind !== 'interaction'),
    ...data.received.map(interactionToInboxEntry),
  ];
  await writeInbox(inbox);
}

export async function addSentInteraction(interaction: Interaction): Promise<void> {
  await addSentEntry(interactionToInboxEntry(interaction));
}

export async function addReceivedInteraction(interaction: Interaction): Promise<void> {
  await addReceivedEntry(interactionToInboxEntry(interaction));
}
