import type { Manifest, Relationship } from '../models/manifest.js';
import type { FeedEntry } from '../models/feed-entry.js';
import type { Message } from '../models/message.js';
import type { Interaction } from '../models/interaction.js';
import type { Following } from '../models/following.js';
import type { ReputationRecord } from '../reputation/models.js';
import type { BehaviorConfig } from '../config/behavior.js';

export interface StoreData {
  manifest: Manifest | null;
  feed: FeedEntry[];
  inbox: Message[];
  interactions: { sent: Interaction[]; received: Interaction[] };
  following: Following[];
  relationships: Relationship[];
  reputation: ReputationRecord[];
  behavior: BehaviorConfig | null;
}

type StoreKey = keyof StoreData;

export interface ASPStore {
  get<K extends StoreKey>(key: K): Promise<StoreData[K]>;
  set<K extends StoreKey>(key: K, value: StoreData[K]): Promise<void>;
}

/** In-memory store — default for library users. */
export class MemoryStore implements ASPStore {
  private data: StoreData = {
    manifest: null,
    feed: [],
    inbox: [],
    interactions: { sent: [], received: [] },
    following: [],
    relationships: [],
    reputation: [],
    behavior: null,
  };

  async get<K extends StoreKey>(key: K): Promise<StoreData[K]> {
    return this.data[key];
  }

  async set<K extends StoreKey>(key: K, value: StoreData[K]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this.data as any)[key] = value;
  }
}

/** File-based store — delegates to existing YAML store modules (used by CLI). */
export class FileStore implements ASPStore {
  async get<K extends StoreKey>(key: K): Promise<StoreData[K]> {
    switch (key) {
      case 'manifest': {
        const { readManifest } = await import('../store/manifest-store.js');
        return await readManifest() as StoreData[K];
      }
      case 'feed': {
        const { readFeed } = await import('../store/feed-store.js');
        return await readFeed() as StoreData[K];
      }
      case 'inbox': {
        const { readInbox } = await import('../store/inbox-store.js');
        const data = await readInbox();
        return data.messages as StoreData[K];
      }
      case 'interactions': {
        const { readInteractions } = await import('../store/interaction-store.js');
        return await readInteractions() as StoreData[K];
      }
      case 'following': {
        const { readFollowing } = await import('../store/following-store.js');
        return await readFollowing() as StoreData[K];
      }
      case 'relationships': {
        const { readRelationships } = await import('../store/relationship-store.js');
        return await readRelationships() as StoreData[K];
      }
      case 'reputation': {
        const { readReputationRecords } = await import('../store/reputation-store.js');
        return await readReputationRecords() as StoreData[K];
      }
      case 'behavior': {
        const { readBehavior } = await import('../store/behavior-store.js');
        return await readBehavior() as StoreData[K];
      }
      default:
        throw new Error(`Unknown store key: ${key}`);
    }
  }

  async set<K extends StoreKey>(key: K, value: StoreData[K]): Promise<void> {
    switch (key) {
      case 'manifest': {
        const { writeManifest } = await import('../store/manifest-store.js');
        await writeManifest(value as Manifest);
        break;
      }
      case 'feed': {
        const { writeFeed } = await import('../store/feed-store.js');
        await writeFeed(value as FeedEntry[]);
        break;
      }
      case 'inbox': {
        const { writeInbox } = await import('../store/inbox-store.js');
        await writeInbox({ messages: value as Message[] });
        break;
      }
      case 'interactions': {
        const { writeInteractions } = await import('../store/interaction-store.js');
        await writeInteractions(value as StoreData['interactions']);
        break;
      }
      case 'following': {
        const { writeFollowing } = await import('../store/following-store.js');
        await writeFollowing(value as Following[]);
        break;
      }
      case 'relationships': {
        const { writeRelationships } = await import('../store/relationship-store.js');
        await writeRelationships(value as Relationship[]);
        break;
      }
      case 'reputation': {
        const { writeReputationRecords } = await import('../store/reputation-store.js');
        await writeReputationRecords(value as ReputationRecord[]);
        break;
      }
      case 'behavior': {
        const { writeBehavior } = await import('../store/behavior-store.js');
        await writeBehavior(value as BehaviorConfig);
        break;
      }
      default:
        throw new Error(`Unknown store key: ${key}`);
    }
  }
}
