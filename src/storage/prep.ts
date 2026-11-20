import { File } from 'expo-file-system';

import FileProtection from '../../modules/file-protection';
import { EMPTY_STORE, type OwnQuestion, type PrepStore } from '../prep/list';
import { visitsRoot } from './visits';

// Inside `visits/`, so it shares the folder's backup exclusion and protection.
// `listVisits()` only reads folders, so this file is ignored there.
const prepFile = () => new File(visitsRoot, 'prep.json');

function clean(data: unknown): PrepStore {
  if (!data || typeof data !== 'object') return EMPTY_STORE;
  const { own, done } = data as { own?: unknown; done?: unknown };
  return {
    own: Array.isArray(own)
      ? own.filter(
          (q): q is OwnQuestion =>
            !!q && typeof q.id === 'string' && typeof q.text === 'string' && typeof q.createdAt === 'string',
        )
      : [],
    done:
      done && typeof done === 'object'
        ? Object.fromEntries(Object.entries(done).filter(([, v]) => typeof v === 'string'))
        : {},
  };
}

export async function readPrepStore(): Promise<PrepStore> {
  const file = prepFile();
  if (!file.exists) return EMPTY_STORE;
  try {
    return clean(JSON.parse(await file.text()));
  } catch {
    return EMPTY_STORE;
  }
}

export async function writePrepStore(store: PrepStore): Promise<void> {
  const isNew = !visitsRoot.exists || !prepFile().exists;
  visitsRoot.create({ intermediates: true, idempotent: true });
  const file = prepFile();
  file.write(JSON.stringify(store, null, 2));
  if (isNew) {
    await FileProtection.excludeFromBackup(visitsRoot.uri);
    await FileProtection.setProtection(file.uri, 'complete');
    await FileProtection.excludeFromBackup(file.uri);
  }
}
