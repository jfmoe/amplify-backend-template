import { defineFunction } from '@aws-amplify/backend';

/**
 * 从还原表恢复数据
 */
export const migrateData = defineFunction({
  name: 'migration-data',
  entry: './handler.ts',
});
