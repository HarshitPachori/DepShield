/// <reference path="./cloudflare-env.d.ts" />
import { default as handler } from './.open-next/worker.js';
import { processScanJob, ScanMessage } from './src/backend/queue/scan.consumer';

type QueueMessage = {};
export default {
	fetch: handler.fetch,
	async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
		console.log('Scheduled event triggered at', new Date().toISOString());
	},
	async queue(batch: MessageBatch<ScanMessage>, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
		for (const message of batch.messages) {
			ctx.waitUntil(
				processScanJob(message.body, env)
					.then(() => message.ack())
					.catch(() => message.retry()),
			);
		}
	},
};
