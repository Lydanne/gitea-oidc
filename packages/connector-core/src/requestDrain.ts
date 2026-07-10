export interface ConnectorRequestDrain {
  /** 记录已经进入框架请求链的请求；关闭封口后的新请求返回 false。 */
  track(request: object): boolean;
  /** 在响应完成或请求中止时释放；重复释放是安全的。 */
  release(request: object): void;
  /** 停止接收新的跟踪项，并等待此前接收的请求全部释放。 */
  beginClose(): Promise<void>;
}

/**
 * 框架适配器使用的最小请求排空器。
 *
 * Fastify 的 `preClose` 发生在连接回收之前；在那里等待该排空器，可以确保认证响应先把
 * Session Cookie 写完，再进入底层 HTTP server 的关闭阶段。
 */
export const createConnectorRequestDrain = (): ConnectorRequestDrain => {
  const requestTokens = new WeakMap<object, symbol>();
  const activeTokens = new Set<symbol>();
  let closing = false;
  let closePromise: Promise<void> | undefined;
  let resolveClose: (() => void) | undefined;

  const track = (request: object): boolean => {
    if (requestTokens.has(request)) {
      return true;
    }
    if (closing) {
      return false;
    }
    const token = Symbol("@gitea-oidc/connector-request");
    requestTokens.set(request, token);
    activeTokens.add(token);
    return true;
  };

  const release = (request: object): void => {
    const token = requestTokens.get(request);
    if (!token) {
      return;
    }
    requestTokens.delete(request);
    activeTokens.delete(token);
    if (closing && activeTokens.size === 0) {
      resolveClose?.();
      resolveClose = undefined;
    }
  };

  const beginClose = (): Promise<void> => {
    closing = true;
    closePromise ??=
      activeTokens.size === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            resolveClose = resolve;
          });
    return closePromise;
  };

  return Object.freeze({ track, release, beginClose });
};
