import { existsSync } from 'node:fs';
import { getStorePaths } from './index.js';
import { loadYaml, dumpYaml } from '../utils/yaml.js';
import type { Relationship } from '../models/manifest.js';

export async function readRelationships(): Promise<Relationship[]> {
  const { relationshipsPath } = getStorePaths();
  if (!existsSync(relationshipsPath)) return [];
  const data = await loadYaml<Relationship[]>(relationshipsPath);
  return data || [];
}

export async function writeRelationships(rels: Relationship[]): Promise<void> {
  await dumpYaml(getStorePaths().relationshipsPath, rels);
}

export async function addRelationship(rel: Relationship): Promise<void> {
  const rels = await readRelationships();
  const exists = rels.some((r) => r.type === rel.type && r.target === rel.target);
  if (exists) throw new Error(`Relationship already exists: ${rel.type} -> ${rel.target}`);
  rels.push(rel);
  await writeRelationships(rels);
}

export async function removeRelationship(type: string, target: string): Promise<void> {
  const rels = await readRelationships();
  const filtered = rels.filter((r) => !(r.type === type && r.target === target));
  if (filtered.length === rels.length) throw new Error(`Relationship not found: ${type} -> ${target}`);
  await writeRelationships(filtered);
}

export async function getRelationshipsByType(type: string): Promise<Relationship[]> {
  const rels = await readRelationships();
  return rels.filter((r) => r.type === type);
}
