type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export class Logger {
  private enabled: boolean;
  private prefix: string;
  private centralLogUrl?: string;
  private logs: { level: LogLevel; message: string; timestamp: string }[] = [];

  constructor(prefix = '', opts: { centralLogUrl?: string } = {}) {
    this.enabled = Deno.env.get('DL_LOGGING_ENABLED') === 'true';
    this.prefix = prefix;
    this.centralLogUrl = opts.centralLogUrl;
  }

  public info(msg: string) {
    this.log('info', msg, '🟢');
  }

  public warn(msg: string) {
    this.log('warn', msg, '🟡');
  }

  public error(msg: string) {
    this.log('error', msg, '🔴');
  }

  public debug(msg: string) {
    this.log('debug', msg, '🔍');
  }

  private log(level: LogLevel, msg: string, icon: string) {
    const timestamp = new Date().toISOString();
    const formatted = `${icon} ${this.prefix} ${msg}`;

    this.logs.push({ level, message: msg, timestamp });

    if (!this.enabled) return;

    try {
      if (level === 'error') console.error(formatted);
      else if (level === 'warn') console.warn(formatted);
      else console.log(formatted);
    } catch (_) {
      // Silent fail
    }
  }

  public getLogs() {
    return this.logs;
  }

  public async flushToRemote() {
    if (!this.centralLogUrl || this.logs.length === 0) return;

    try {
      await fetch(this.centralLogUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix: this.prefix,
          logs: this.logs,
          time: new Date().toISOString(),
        }),
      });
    } catch (_) {
      this.warn('Failed to send logs to central endpoint');
    }
  }
}
