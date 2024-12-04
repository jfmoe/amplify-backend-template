import { AppSyncClient, UpdateApiKeyCommand } from '@aws-sdk/client-appsync';
import { Logger } from '@aws-lambda-powertools/logger';
import { env } from '$amplify/env/refresh-api-key';
import dayjs from 'dayjs';

const logger = new Logger({
  logLevel: 'INFO',
  serviceName: 'refresh-api-key-handler',
});

export const handler = async () => {
  try {
    if (!env.API_ID || !env.API_KEY) {
      logger.error('Missing env variables API_ID or API_KEY');
      return;
    }

    const client = new AppSyncClient({
      region: env.REGION,
    });

    const input = {
      apiId: env.API_ID,
      id: env.API_KEY,
      description: 'refresh apikey',
      expires: dayjs().add(1, 'month').unix(),
    };

    const command = new UpdateApiKeyCommand(input);
    const response = await client.send(command);

    logger.info('Successfully refreshed apikey.', JSON.stringify(response));
  } catch (error) {
    logger.error('Failed to refresh apikey.', error as Error);
  }
};
