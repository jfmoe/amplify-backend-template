import { defineFunction } from '@aws-amplify/backend';

/**
 * 根据 DynamoDB Stream 更新数据
 */
export const dynamoDBFunction = defineFunction({
  name: 'dynamoDB-function',
  entry: './handler.ts',
  environment: {
    TTL_TABLE_NAME: process.env.TTL_TABLE_NAME ?? '',
  },
});
