/**
 * 日志级别枚举
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

/**
 * 日志类，支持通过级别设置打印，并支持环境变量控制
 */
export class Logger {
  private static currentLevel: LogLevel = LogLevel.INFO;

  /**
   * 初始化日志级别，从环境变量读取
   */
  static init(): void {
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case 'DEBUG':
        this.currentLevel = LogLevel.DEBUG;
        break;
      case 'INFO':
        this.currentLevel = LogLevel.INFO;
        break;
      case 'WARN':
        this.currentLevel = LogLevel.WARN;
        break;
      case 'ERROR':
        this.currentLevel = LogLevel.ERROR;
        break;
      default:
        this.currentLevel = LogLevel.INFO;
    }
  }

  /**
   * 设置日志级别
   * @param level 日志级别
   */
  static setLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  /**
   * 打印 DEBUG 级别日志
   * @param message 日志消息
   * @param data 额外数据
   */
  static debug(message: string, ...data: any[]): void {
    if (this.currentLevel <= LogLevel.DEBUG) {
      console.log(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...data);
    }
  }

  /**
   * 打印 INFO 级别日志
   * @param message 日志消息
   * @param data 额外数据
   */
  static info(message: string, ...data: any[]): void {
    if (this.currentLevel <= LogLevel.INFO) {
      console.info(`[INFO] ${new Date().toISOString()} - ${message}`, ...data);
    }
  }

  /**
   * 打印 WARN 级别日志
   * @param message 日志消息
   * @param data 额外数据
   */
  static warn(message: string, ...data: any[]): void {
    if (this.currentLevel <= LogLevel.WARN) {
      console.warn(`[WARN] ${new Date().toISOString()} - ${message}`, ...data);
    }
  }

  /**
   * 打印 ERROR 级别日志
   * @param message 日志消息
   * @param data 额外数据
   */
  static error(message: string, ...data: any[]): void {
    if (this.currentLevel <= LogLevel.ERROR) {
      console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...data);
    }
  }
}

// 初始化日志级别
Logger.init();