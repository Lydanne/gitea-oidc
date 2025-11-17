import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Logger, LogLevel } from '../Logger';

describe('Logger', () => {
  const originalEnv = process.env.LOG_LEVEL;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.LOG_LEVEL = undefined;
    Logger.setLevel(LogLevel.INFO);
  });

  afterEach(() => {
    logSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.LOG_LEVEL = originalEnv;
    Logger.setLevel(LogLevel.INFO);
  });

  it('init 应该从环境变量读取日志级别', () => {
    process.env.LOG_LEVEL = 'debug';
    Logger.init();

    Logger.debug('debug log');
    expect(logSpy).toHaveBeenCalledTimes(1);

    Logger.setLevel(LogLevel.WARN);
    Logger.debug('should suppress');
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it('setLevel 应该控制各级日志输出', () => {
    Logger.setLevel(LogLevel.INFO);

    Logger.debug('no debug');
    expect(logSpy).not.toHaveBeenCalled();

    Logger.info('info');
    expect(infoSpy).toHaveBeenCalledTimes(1);

    Logger.warn('warn');
    expect(warnSpy).toHaveBeenCalledTimes(1);

    Logger.error('error');
    expect(errorSpy).toHaveBeenCalledTimes(1);

    Logger.setLevel(LogLevel.ERROR);
    Logger.warn('suppressed');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    Logger.error('still logs');
    expect(errorSpy).toHaveBeenCalledTimes(2);
  });
});
