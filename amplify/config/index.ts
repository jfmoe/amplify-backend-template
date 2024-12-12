export type TTLConfig = Array<{ modalName: string; tableName: string; timeToLive: number }>;
export const TTL_CONFIG = JSON.parse(process.env.TTL_CONFIG ?? '[]') as TTLConfig;
