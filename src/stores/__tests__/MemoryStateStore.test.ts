import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { MemoryStateStore } from '../MemoryStateStore';
import { Logger } from '../../utils/Logger';

describe('MemoryStateStore', () => {
  let stores: MemoryStateStore[];
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let debugSpy: ReturnType<typeof vi.spyOn>;

  const createStore = (options?: { maxSize?: number; cleanupIntervalMs?: number }) => {
    const store = new MemoryStateStore(options);
    stores.push(store);
    return store;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    stores = [];
    infoSpy = vi.spyOn(Logger, 'info').mockImplementation(() => {});
    debugSpy = vi.spyOn(Logger, 'debug').mockImplementation(() => {});
  });

  afterEach(() => {
    stores.forEach(store => store.destroy());
    vi.useRealTimers();
    infoSpy.mockRestore();
    debugSpy.mockRestore();
  });

  it('应该在 TTL 内返回数据并统计命中', async () => {
    const store = createStore();

    await store.set('state-1', { foo: 'bar' }, 5);

    const value = await store.get('state-1');

    expect(value).toEqual({ foo: 'bar' });
    const stats = store.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.totalRequests).toBe(1);
  });

  it('没有命中时应该返回 null 并记录 miss', async () => {
    const store = createStore();

    const value = await store.get('unknown');

    expect(value).toBeNull();
    expect(store.getStats().misses).toBe(1);
  });

  it('TTL 过期后应返回 null 并记录过期次数', async () => {
    const store = createStore();

    await store.set('state-expire', { value: 1 }, 1);

    vi.setSystemTime(new Date('2025-01-01T00:00:02Z'));

    const value = await store.get('state-expire');

    expect(value).toBeNull();
    const stats = store.getStats();
    expect(stats.expired).toBe(1);
  });

  it('delete 应该移除指定 state', async () => {
    const store = createStore();

    await store.set('state-delete', { value: 2 }, 10);
    await store.delete('state-delete');

    expect(await store.get('state-delete')).toBeNull();
    expect(store.size()).toBe(0);
  });

  it('cleanup 应该移除所有已过期 state', async () => {
    const store = createStore();

    await store.set('expired', { value: 'old' }, 1);
    await store.set('fresh', { value: 'new' }, 10);

    vi.setSystemTime(new Date('2025-01-01T00:00:05Z'));

    await store.cleanup();

    expect(await store.get('expired')).toBeNull();
    expect(await store.get('fresh')).toEqual({ value: 'new' });
  });

  it('达到容量上限时应该淘汰最旧 state', async () => {
    const store = createStore({ maxSize: 2 });

    await store.set('state-1', { order: 1 }, 60);
    vi.advanceTimersByTime(1);
    await store.set('state-2', { order: 2 }, 60);
    vi.advanceTimersByTime(1);
    await store.set('state-3', { order: 3 }, 60);

    expect(store.size()).toBe(2);
    expect(await store.get('state-1')).toBeNull();
    expect(store.getStats().evicted).toBe(1);
  });

  it('destroy 应该清空所有数据并停止计时器', async () => {
    const store = createStore();

    await store.set('state-destroy', { value: 'bye' }, 10);
    expect(store.size()).toBe(1);

    store.destroy();

    expect(store.size()).toBe(0);
    expect(await store.get('state-destroy')).toBeNull();
  });

  it('listAll 应该返回格式化后的调试信息', async () => {
    const store = createStore();
    const payload = { type: 'custom', createdAt: Date.now(), extra: true };

    await store.set('state-debug', payload, 60);

    const list = store.listAll();

    expect(list).toHaveLength(1);
    expect(list[0].type).toBe('custom');
    expect(list[0].state.endsWith('...')).toBe(true);
    expect(list[0].data).toEqual(payload);
  });
});
