type LogData = Record<string, unknown>;

interface LogEntry {
	level: 'INFO' | 'ERROR' | 'WARN' | 'DEBUG';
	message: string;
	data?: LogData;
	error?: { message: string; stack?: string } | unknown;
}

const logger = {
	info(message: string, data: LogData = {}): void {
		const entry: LogEntry = { level: 'INFO', message, data };
		console.log(JSON.stringify(entry));
	},

	warn(message: string, data: LogData = {}): void {
		const entry: LogEntry = { level: 'WARN', message, data };
		console.warn(JSON.stringify(entry));
	},

	error(message: string, error?: unknown, data: LogData = {}): void {
		const entry: LogEntry = {
			level: 'ERROR',
			message,
			data,
			error: error instanceof Error ? { message: error.message, stack: error.stack } : error,
		};
		console.error(JSON.stringify(entry));
	},

	debug(message: string, data: LogData = {}): void {
		const entry: LogEntry = { level: 'DEBUG', message, data };
		console.log(JSON.stringify(entry));
	},
};

export default logger;
