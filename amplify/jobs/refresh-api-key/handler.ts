import { AppSyncClient, UpdateApiKeyCommand } from '@aws-sdk/client-appsync';
import { Logger } from '@aws-lambda-powertools/logger';
import { env } from '$amplify/env/refresh-api-key';
import dayjs from 'dayjs';

const logger = new Logger({
  logLevel: 'INFO',
  serviceName: 'refresh-api-key-handler',
});

export const handler = async () => {
  if (!env.API_ID) {
    logger.error('Missing env variable API_ID');
    return;
  }

  if (!env.API_KEY) {
    logger.error('Missing secret API_KEY');
    return;
  }

  try {
    const client = new AppSyncClient({
      region: env.REGION,
    });

    const input = {
      apiId: env.API_ID,
      id: env.API_KEY,
      description: 'refresh apikey',
      expires: dayjs().add(1, 'year').unix(),
    };

    const command = new UpdateApiKeyCommand(input);
    const response = await client.send(command);

    logger.info('Successfully refreshed apikey.', JSON.stringify(response));
  } catch (error) {
    logger.error('Failed to refresh apikey.', error as Error);
  }
};
