import { defineBackend } from '@aws-amplify/backend';
import { Policy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Stack } from 'aws-cdk-lib';
import { StartingPosition, EventSourceMapping } from 'aws-cdk-lib/aws-lambda';
import { BackupPlan, BackupPlanRule, BackupResource, BackupVault } from 'aws-cdk-lib/aws-backup';
import { Schedule } from 'aws-cdk-lib/aws-events';
import { Duration } from 'aws-cdk-lib/core';

import { auth } from './auth/resource';
import { data } from './data/resource';
import { refreshApiKey } from './jobs/refresh-api-key/resource';
import { dynamoDBFunction } from './functions/dynamoDB-function/resource';
import { migrateData } from './functions/migrate-data/resource';
import { prefix, TTL_CONFIG } from './config';

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
for (const [modalName, table] of Object.entries(amplifyDynamoDbTables)) {
  const shouldEnableTTL = TTL_CONFIG.some(c => c.modalName === modalName);
  table.timeToLiveAttribute = {
    attributeName: 'expiredAt',
    enabled: shouldEnableTTL,
  };
}

/**
 * 按需备份所有 table
 */
const backupStack = backend.createStack('backup-stack');
const myTables = Object.values(backend.data.resources.tables);

const vault = new BackupVault(backupStack, 'BackupVault', {
  backupVaultName: `${prefix}-backup-vault`,
});

const plan = new BackupPlan(backupStack, 'BackupPlan', {
  backupPlanName: `${prefix}-backup-plan`,
  backupVault: vault,
});

plan.addRule(
  new BackupPlanRule({
    deleteAfter: Duration.days(365),
    ruleName: `${prefix}-backup-plan-rule`,
    scheduleExpression: Schedule.cron({
      minute: '0',
      hour: '0',
      day: '1',
      month: '*',
      year: '*',
    }),
  }),
);

plan.addSelection('BackupPlanSelection', {
  resources: myTables.map(table => BackupResource.fromDynamoDbTable(table)),
  allowRestores: true,
});

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
    actions: ['dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:BatchWriteItem'],
    resources: ['*'],
  }),
);

/**
 * 添加 DynamoDB Stream 权限和注册事件流
 */
const tablesToStream = TTL_CONFIG.map(c => c.modalName);

for (const tableName of tablesToStream) {
  const table = backend.data.resources.tables[tableName];
  const policy = new Policy(Stack.of(table), `${tableName}DynamoDBFunctionStreamingPolicy`, {
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

  const mapping = new EventSourceMapping(
    Stack.of(table),
    `${tableName}DynamoDBFunctionEventStreamMapping`,
    {
      target: backend.dynamoDBFunction.resources.lambda,
      eventSourceArn: table.tableStreamArn,
      startingPosition: StartingPosition.LATEST,
    },
  );
  mapping.node.addDependency(policy);
}
/* --------------------------- Policy end -------------------------- */
