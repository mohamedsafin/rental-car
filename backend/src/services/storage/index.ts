/**
 * services/storage/index.ts
 * ---------------------------------------------------------------------------
 * Chooses the storage driver once, at boot, from STORAGE_DRIVER.
 *
 * This is the ONLY file that knows which provider is in use. Every module
 * imports `storage` and sees the interface. When the client picks S3, this file
 * gains one `case` and gains one new file - nothing in vehicles, documents or
 * inspections changes.
 */
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { LocalStorageProvider } from './localProvider';
import type { StorageProvider } from './types';

function createProvider(): StorageProvider {
  switch (env.STORAGE_DRIVER) {
    case 'local':
      return new LocalStorageProvider();

    case 's3':
    case 'cloudinary':
      // Deliberately not stubbed with a silent fallback: quietly writing a
      // customer's Emirates ID to local disk when the config says S3 would be
      // a data-handling failure nobody would notice until an audit.
      throw new Error(
        `STORAGE_DRIVER="${env.STORAGE_DRIVER}" is not implemented yet. ` +
          'The provider is chosen by the client (BRD 51) and is added in Phase 11. ' +
          'Use STORAGE_DRIVER=local for development.',
      );

    default:
      throw new Error(`Unknown STORAGE_DRIVER: ${String(env.STORAGE_DRIVER)}`);
  }
}

export const storage: StorageProvider = createProvider();

logger.info('Storage provider initialised', { driver: storage.name });

export * from './types';
export { LocalStorageProvider };
