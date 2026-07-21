import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

/**
 * BullMQ queue for code-execution jobs (Run/Submit → Piston). BullMQ requires a
 * dedicated connection with maxRetriesPerRequest: null, so we don't reuse the
 * shared rate-limit redis client here.
 *
 * The actual job payload/processing lands in Phase 4; this module establishes the
 * queue name and connection now so the web (producer) and worker (consumer) share
 * one definition.
 */
export const EXECUTION_QUEUE = "code-execution";

export interface ExecutionJobData {
  attemptId: string;
}

export function createQueueConnection(): IORedis {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

const globalForQueue = globalThis as unknown as {
  executionQueue: Queue<ExecutionJobData> | undefined;
};

export const executionQueue =
  globalForQueue.executionQueue ??
  new Queue<ExecutionJobData>(EXECUTION_QUEUE, {
    connection: createQueueConnection(),
  });

if (env.NODE_ENV !== "production") {
  globalForQueue.executionQueue = executionQueue;
}
