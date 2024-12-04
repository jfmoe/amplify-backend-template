import { defineBackend } from '@aws-amplify/backend';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

import { auth } from './auth/resource';
import { data } from './data/resource';
import { refreshApiKey } from './jobs/refresh-api-key/resource';

const backend = defineBackend({
  auth,
  data,
  refreshApiKey,
});

/* --------------------------- Configuration start -------------------------- */
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
