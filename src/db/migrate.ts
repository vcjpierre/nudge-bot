import { closeDb, runMigrations } from './index.js';
import { logger } from '../utils/logger.js';

try {
  runMigrations();
  logger.info('migraciones ejecutadas correctamente');
} finally {
  closeDb();
}
