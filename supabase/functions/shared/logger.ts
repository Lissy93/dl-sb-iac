type LogLevel = "debug" | "info" | "success" | "warn" | "error";

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  success: 2,
  warn: 3,
  error: 4,
};

const LOG_CONFIG: Record<LogLevel, { emoji: string; method: "log" | "info" | "warn" | "error" }> = {
  debug: { emoji: "🔍", method: "log" },
  info: { emoji: "ℹ️", method: "info" },
  success: { emoji: "✅", method: "log" },
  warn: { emoji: "⚠️", method: "warn" },
  error: { emoji: "❌", method: "error" },
};

export class Logger {
  private enabled: boolean;
  private prefix: string;
  private minLevel: LogLevel;
  private centralLogUrl?: string;
  private logs: { level: LogLevel; message: string; timestamp: string }[] = [];

  constructor(prefix = "") {
    this.enabled = Deno.env.get("DL_LOGGING_ENABLED") === "true";
    this.prefix = prefix;
    this.minLevel = (Deno.env.get("DL_LOG_LEVEL") as LogLevel) ?? "debug";
    this.centralLogUrl = Deno.env.get("LOGFLARE_ENDPOINT_URL") ??
      Deno.env.get("DL_CENTRAL_LOG_URL");
  }

  public debug(msg: string) {
    this.log("debug", msg);
  }

  public info(msg: string) {
    this.log("info", msg);
  }

  public success(msg: string) {
    this.log("success", msg);
  }

  public warn(msg: string) {
    this.log("warn", msg);
  }

  public error(msg: string) {
    this.log("error", msg);
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_VALUES[level] >= LOG_LEVEL_VALUES[this.minLevel];
  }

  private log(level: LogLevel, msg: string) {
    const timestamp = new Date().toISOString();
    this.logs.push({ level, message: msg, timestamp });

    if (!this.enabled || !this.shouldLog(level)) return;

    const config = LOG_CONFIG[level];
    const formatted = `${config.emoji} ${this.prefix} ${msg}`;

    try {
      console[config.method](formatted);
    } catch {
        console.log('Error in error logger 💀');
    }
  }

  public getLogs() {
    return this.logs;
  }

  public async flushToRemote() {
    if (!this.centralLogUrl || this.logs.length === 0) return;

    try {
      // Asynchronously (as to not block), send logs to a place far, far away
      const payload = {
        prefix: this.prefix,
        timestamp: new Date().toISOString(),
        logs: this.logs,
      };
      await fetch(this.centralLogUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).catch((err) => this.warn("Logflare send error: " + err.message));
    } catch (_) {
      this.warn("Error in flushToRemote");
    }
  }
}
