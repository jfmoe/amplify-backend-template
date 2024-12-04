/* eslint-disable @typescript-eslint/no-explicit-any */
import { Handler } from 'aws-cdk-lib/aws-lambda';
import { DynamoDBClient, PutItemCommand, ScanCommand } from '@aws-sdk/client-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { chunk } from 'lodash-es';

const CHUNK_SIZE = 10;

const client = new DynamoDBClient({});

const logger = new Logger({
  logLevel: 'INFO',
  serviceName: 'dynamodb-stream-handler',
});

interface HandlerEvent {
  sourceTableName: string;
  targetTableName: string;
}

export const handler: Handler = async ({ sourceTableName, targetTableName }: HandlerEvent) => {
  try {
    logger.info(`Migrating data from ${sourceTableName} to ${targetTableName}`);

    if (!sourceTableName || !targetTableName || sourceTableName === targetTableName) {
      throw new Error('Invalid source or target table name');
    }

    const allItems = await getAllItemsFromSourceTable(sourceTableName);

    logger.info(`Migration item count: ${allItems.length}`);

    let count = 1;
    const chunks = chunk(allItems, CHUNK_SIZE);

    for (const chunk of chunks) {
      logger.info(`creating tasks for chunk: ${chunk}`);
      await Promise.all(updateItemsInTargetTable(chunk, targetTableName));
      logger.info(`Processed chunk ${count++} of ${chunks.length}`);
    }
    return true;
  } catch (error) {
    logger.error('migration failed =>', error as Error);
    return false;
  }
};

async function getAllItemsFromSourceTable(sourceTableName: string) {
  const input = {
    TableName: sourceTableName,
  };
  const command = new ScanCommand(input);

  let nextScan = await client.send(command);
  let items = [...(nextScan.Items || [])];

  while (nextScan.LastEvaluatedKey) {
    const input = {
      TableName: sourceTableName,
      ExclusiveStartKey: nextScan.LastEvaluatedKey,
    };

    nextScan = await client.send(new ScanCommand(input));
    items = items.concat(nextScan.Items || []);
  }

  return items;
}

async function createPutPromise(item: any, targetTableName: string) {
  const input = {
    Item: item,
    TableName: targetTableName,
  };
  const command = new PutItemCommand(input);
  return client.send(command);
}

function updateItemsInTargetTable(items: any[], targetTableName: string) {
  return items.map(item => createPutPromise(item, targetTableName));
}
