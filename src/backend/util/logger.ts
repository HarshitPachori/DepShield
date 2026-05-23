type LogData = Record<string, unknown>;

interface LogEntry {
  level: "INFO" | "ERROR";
  message: string;
  data?: LogData;
  error?: unknown;
}

const logger = {
  info(message: string, data: LogData = {}): void {
    const entry: LogEntry = { level: "INFO", message, data };
    console.log(JSON.stringify(entry, null, 2));
  },

  error(message: string, error?: unknown, data: LogData = {}): void {
    const entry: LogEntry = {
      level: "ERROR",
      message,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
      ...data,
    };
    console.error(JSON.stringify(entry, null, 2));
  },
};

export default logger;
