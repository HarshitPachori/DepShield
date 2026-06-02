import { default as handler } from './.open-next/worker.js';

type QueueMessage = {};
export default {
	fetch: handler.fetch,
	async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
		console.log('Scheduled event triggered at', new Date().toISOString());
	},
	async queue(batch: MessageBatch<QueueMessage>, env: CloudflareEnv, ctx: ExecutionContext): Promise<void> {
		console.log(`Processing batch of ${batch.messages.length} messages at`, new Date().toISOString());
	},
};
