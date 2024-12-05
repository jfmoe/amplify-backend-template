/**
 * 等待一段时间
 */
export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
