import { requireNativeModule } from 'expo-modules-core';

/**
 * iOS Data Protection classes.
 * - `complete`: unreadable ~10 s after the phone locks (app-wide default).
 * - `completeUnlessOpen`: a file that is already open stays writable while locked.
 */
export type ProtectionClass =
  | 'complete'
  | 'completeUnlessOpen'
  | 'completeUntilFirstUserAuthentication'
  | 'none';

type FileProtectionNativeModule = {
  /** `path` is an absolute path or a file:// URI (e.g. `Directory.uri`). */
  setProtection(path: string, protection: ProtectionClass): Promise<void>;
  getProtection(path: string): Promise<ProtectionClass | null>;
  excludeFromBackup(path: string): Promise<void>;
  isExcludedFromBackup(path: string): Promise<boolean>;
};

export default requireNativeModule<FileProtectionNativeModule>('FileProtection');
