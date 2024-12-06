/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Handler } from 'aws-lambda';
import {
  DynamoDBClient,
  BatchWriteItemCommand,
  ScanCommand,
  ScanCommandInput,
  BatchWriteItemCommandInput,
} from '@aws-sdk/client-dynamodb';
import { LambdaClient, InvokeCommand, InvokeCommandInput } from '@aws-sdk/client-lambda'; // ES Modules import
import { Logger } from '@aws-lambda-powertools/logger';
import { sleep } from '../../utils';

const BATCH_SIZE = 25; // 批量写入的数据数量（n <= 25，size <= 16MB）
const MAX_RETRY = 5; // 最大重试次数
const REMAINING_TIME = 60 * 1000 * 15 - 100; // 剩余多少时间时触发自身调用

const client = new DynamoDBClient({});

const logger = new Logger({
  logLevel: 'INFO',
  serviceName: 'dynamodb-stream-handler',
});

interface HandlerEvent {
  sourceTableName: string;
  targetTableName: string;
  ExclusiveStartKey?: string;
  result?: HandlerResult;
}

interface HandlerResult {
  result: boolean;
  totalCount: number;
  startTime: number;
  endTime: number;
}

export const handler: Handler<HandlerEvent, HandlerResult> = async (
  {
    sourceTableName,
    targetTableName,
    ExclusiveStartKey,
    result = {
      result: false,
      totalCount: 0,
      startTime: Date.now(),
      endTime: Date.now(),
    },
  },
  context,
) => {
  logger.info(`Migrating data from ${sourceTableName} to ${targetTableName}`);

  if (!sourceTableName || !targetTableName || sourceTableName === targetTableName) {
    logger.error('Invalid source or target table name');
    return { ...result, endTime: Date.now() };
  }

  const scanInput = {
    TableName: sourceTableName,
    ExclusiveStartKey,
    Limit: BATCH_SIZE, // 每次扫描的最大数量
    ConsistentRead: true, // 结果包含扫描开始前的存在的所有数据
  } as ScanCommandInput;

  try {
    // ScanCommand 单次扫描结果不会超过 1MB
    while (true) {
      // 如果执行时间超过最大限制，异步调用自身以继续任务
      if (context.getRemainingTimeInMillis() <= REMAINING_TIME) {
        logger.info('Execution time limit reached, invoking function again.');

        const lambdaClient = new LambdaClient();
        const lambdaInput = {
          FunctionName: context.functionName,
          InvocationType: 'Event', // 异步调用
          Payload: JSON.stringify({ ...scanInput, result }),
        } as InvokeCommandInput;
        const command = new InvokeCommand(lambdaInput);
        lambdaClient.send(command);

        return { ...result, endTime: Date.now() };
      }

      const scanCommand = new ScanCommand(scanInput);
      const { Items, LastEvaluatedKey } = await client.send(scanCommand);

      if (!Items || Items?.length === 0) break;

      const batchWriteInput = {
        RequestItems: {
          [targetTableName]: Items.map(item => ({ PutRequest: { Item: item } })),
        },
      };

      const batchWritecommand = new BatchWriteItemCommand(batchWriteInput);
      let { UnprocessedItems } = await client.send(batchWritecommand);

      // 对于因吞吐量限制等原因未处理的数据，使用指数退避算法重试
      if (UnprocessedItems && UnprocessedItems[targetTableName]?.length > 0) {
        logger.warn('Unprocessed item', UnprocessedItems);

        let retry = 1;
        while (
          retry <= MAX_RETRY &&
          UnprocessedItems &&
          UnprocessedItems[targetTableName]?.length > 0
        ) {
          await sleep(50 * Math.pow(2, retry)); // 指数退避延迟

          const retryBatchWriteInput: BatchWriteItemCommandInput = {
            RequestItems: UnprocessedItems,
          };

          const retryBatchWritecommand = new BatchWriteItemCommand(retryBatchWriteInput);
          const { UnprocessedItems: retryUnprocessedItems } = await client.send(
            retryBatchWritecommand,
          );

          // 如果还有未处理的数据，继续重试
          if (retryUnprocessedItems && retryUnprocessedItems[targetTableName]?.length > 0) {
            UnprocessedItems = retryUnprocessedItems;
            retry += 1;
          } else {
            break;
          }
        }

        if (retry > MAX_RETRY)
          throw new Error(
            `Failed to process unprocessed items after retry: ${JSON.stringify(UnprocessedItems)}`,
          );
      }

      result.totalCount += Items.length;
      logger.info(`Processed ${result.totalCount} items`);

      if (!LastEvaluatedKey) break;

      // 继续扫描下一批次
      scanInput.ExclusiveStartKey = LastEvaluatedKey;
    }
  } catch (error) {
    logger.error(`Migrating data failed`, error as Error);
    return { ...result, endTime: Date.now() };
  }

  return { ...result, endTime: Date.now(), result: true };
};
