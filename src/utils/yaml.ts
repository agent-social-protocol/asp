import { readFile, writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';

export async function loadYaml<T>(path: string): Promise<T> {
  const content = await readFile(path, 'utf-8');
  return yaml.load(content) as T;
}

export async function dumpYaml(path: string, data: unknown): Promise<void> {
  const content = yaml.dump(data, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  await writeFile(path, content, 'utf-8');
}
