import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * 自动刷新 API Key
 */
export const refreshApiKey = defineFunction({
  name: 'refresh-api-key',
  schedule: 'every day',
  entry: './handler.ts',
  environment: {
    API_KEY: secret('API_KEY'),
    API_ID: process.env.API_ID ?? '',
    REGION: process.env.AWS_REGION ?? '',
  },
});
