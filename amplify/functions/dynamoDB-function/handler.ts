import type { DynamoDBStreamHandler } from 'aws-lambda';
import { DynamoDBClient, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { env } from '$amplify/env/dynamoDB-function';
import dayjs from 'dayjs';
import { TTLConfig } from '../../config';

const TTL_CONFIG = JSON.parse(env.TTL_CONFIG) as TTLConfig;

const logger = new Logger({
  logLevel: 'INFO',
  serviceName: 'dynamodb-stream-handler',
});

const dynamoDBClient = new DynamoDBClient({});

export const handler: DynamoDBStreamHandler = async event => {
  for (const record of event.Records) {
    logger.info(`Processing record: ${JSON.stringify(record)}`);

    const tableName = record.eventSourceARN?.split('/')[1];

    if (record.eventName === 'INSERT') {
      const newImage = record.dynamodb?.NewImage;
      logger.info(`New Image: ${JSON.stringify(newImage)}`);

      if (!newImage?.id?.S) {
        logger.error('Invalid id');
        continue;
      }

      // 更新 expiredAt 字段，使得数据在一段时间后过期
      const config = TTL_CONFIG.find(c => c.tableName === tableName);
      if (!config) continue;

      if (newImage?.expiredAt?.N) {
        logger.warn('Item already has expiredAt field');
        continue;
      }

      const input = {
        TableName: config.tableName,
        Key: {
          id: newImage?.id,
        },
        UpdateExpression: 'SET #expiredAt = :expiredAt',
        ExpressionAttributeNames: {
          '#expiredAt': 'expiredAt',
        },
        ExpressionAttributeValues: {
          ':expiredAt': {
            N: dayjs(newImage?.createdAt?.S ?? Date.now())
              .add(config.timeToLive, 'second')
              .unix()
              .toString(),
          },
        },
      };

      try {
        // @ts-expect-error xxx
        const command = new UpdateItemCommand(input);
        const response = await dynamoDBClient.send(command);
        logger.info(`Item updated successfully: ${JSON.stringify(response)}`);
      } catch (error) {
        logger.error('Error updating item:', error as Error);
        return {
          batchItemFailures: [{ itemIdentifier: record.dynamodb?.SequenceNumber ?? 'unknown' }],
        };
      }
    }
  }

  logger.info(`Successfully processed ${event.Records.length} records.`);

  return {
    batchItemFailures: [],
  };
};
