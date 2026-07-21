import "dotenv/config";
import { Worker } from "bullmq";
import {
  EXECUTION_QUEUE,
  createQueueConnection,
  type ExecutionJobData,
} from "../lib/queue";

/**
 * Code-execution worker — runs as a SEPARATE process/container from the web app
 * so a misbehaving execution job can't reach the web app's filesystem or env.
 *
 * Phase 0: a no-op consumer that just logs received jobs, to prove the queue and
 * worker wiring is sound. Phase 4 replaces the processor body with the real
 * Piston call, result persistence, and SSE pub/sub.
 */
const worker = new Worker<ExecutionJobData>(
  EXECUTION_QUEUE,
  async (job) => {
    console.log(`[worker] received job ${job.id} attemptId=${job.data.attemptId}`);
    // TODO(Phase 4): call Piston, persist Attempt result, publish SSE status.
    return { ok: true };
  },
  { connection: createQueueConnection() },
);

worker.on("ready", () => {
  console.log(`[worker] ready, listening on queue "${EXECUTION_QUEUE}"`);
});

worker.on("failed", (job, err) => {
  console.error(`[worker] job ${job?.id} failed:`, err.message);
});

async function shutdown() {
  console.log("[worker] shutting down…");
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
