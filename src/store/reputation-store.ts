import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { ReputationRecord } from '../reputation/models.js';

export async function readReputationRecords(): Promise<ReputationRecord[]> {
  const { reputationPath } = getStorePaths();
  if (!existsSync(reputationPath)) return [];
  const data = await loadYaml<ReputationRecord[]>(reputationPath);
  return data || [];
}

export async function writeReputationRecords(records: ReputationRecord[]): Promise<void> {
  await dumpYaml(getStorePaths().reputationPath, records);
}

export async function getReputationRecord(entity: string): Promise<ReputationRecord | undefined> {
  const records = await readReputationRecords();
  return records.find((r) => r.entity === entity);
}

export async function upsertReputationRecord(record: ReputationRecord): Promise<void> {
  const records = await readReputationRecords();
  const idx = records.findIndex((r) => r.entity === record.entity);
  if (idx === -1) {
    records.push(record);
  } else {
    records[idx] = record;
  }
  await writeReputationRecords(records);
}
