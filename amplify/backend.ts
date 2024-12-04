import { defineBackend } from '@aws-amplify/backend';
import { Policy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { StartingPosition, EventSourceMapping } from 'aws-cdk-lib/aws-lambda';

import { auth } from './auth/resource';
import { data } from './data/resource';
import { refreshApiKey } from './jobs/refresh-api-key/resource';
import { dynamoDBFunction } from './functions/dynamoDB-function/resource';
import { migrateData } from './functions/migrate-data/resource';

const backend = defineBackend({
  auth,
  data,
  refreshApiKey,
  dynamoDBFunction,
  migrateData,
});

/* --------------------------- Configuration start -------------------------- */

const { amplifyDynamoDbTables } = backend.data.resources.cfnResources;

// 为所有 table 开启时间点恢复功能和删除保护
for (const table of Object.values(amplifyDynamoDbTables)) {
  table.pointInTimeRecoveryEnabled = true;
  table.deletionProtectionEnabled = true;
}

// 根据需要为 table 开启 TTL 功能（如果当前时间超过设定的时间戳，则该条数据过期）
amplifyDynamoDbTables['Todo'].timeToLiveAttribute = {
  attributeName: 'expiredAt',
  enabled: true,
};

/* --------------------------- Configuration end -------------------------- */

/* --------------------------- Policy start -------------------------- */

/**
 * 添加刷新 API Key 的权限
 */
const refreshApiKeyLambda = backend.refreshApiKey.resources.lambda;
refreshApiKeyLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['appsync:UpdateApiKey'],
    resources: ['*'],
  }),
);

/**
 * 添加迁移数据的权限
 */
const migrateDataLambda = backend.migrateData.resources.lambda;
migrateDataLambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:Scan', 'dynamodb:PutItem'],
    resources: ['*'],
  }),
);

/**
 * 添加 DynamoDB Stream 权限
 */
const todoTable = backend.data.resources.tables['Todo'];
const policy = new Policy(Stack.of(todoTable), 'DynamoDBFunctionStreamingPolicy', {
  statements: [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'dynamodb:DescribeStream',
        'dynamodb:GetRecords',
        'dynamodb:GetShardIterator',
        'dynamodb:ListStreams',
        'dynamodb:UpdateItem',
      ],
      resources: ['*'],
    }),
  ],
});
backend.dynamoDBFunction.resources.lambda.role?.attachInlinePolicy(policy);

/**
 * 注册 DynamoDB Stream 事件流
 */
const mapping = new EventSourceMapping(
  Stack.of(todoTable),
  'DynamoDBFunctionTodoEventStreamMapping',
  {
    target: backend.dynamoDBFunction.resources.lambda,
    eventSourceArn: todoTable.tableStreamArn,
    startingPosition: StartingPosition.LATEST,
  },
);
mapping.node.addDependency(policy);
/* --------------------------- Policy end -------------------------- */
