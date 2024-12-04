import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

import { auth } from './auth/resource';
import { data } from './data/resource';
import { refreshApiKey } from './jobs/refresh-api-key/resource';

export const backend = defineBackend({
  auth,
  data,
  refreshApiKey,
});

/* --------------------------- Configuration start -------------------------- */

const { amplifyDynamoDbTables } = backend.data.resources.cfnResources;

// 为所有 table 开启时间点恢复功能
for (const table of Object.values(amplifyDynamoDbTables)) {
  table.pointInTimeRecoveryEnabled = true;
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
/* --------------------------- Policy end -------------------------- */
