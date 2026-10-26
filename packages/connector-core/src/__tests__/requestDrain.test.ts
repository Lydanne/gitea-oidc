import { describe, expect, it } from "vitest";
import { createConnectorRequestDrain } from "../requestDrain.js";

const nextTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("connector request drain", () => {
  it("waits for every accepted request and tolerates duplicate tracking and release", async () => {
    const drain = createConnectorRequestDrain();
    const first = {};
    const second = {};
    expect(drain.track(first)).toBe(true);
    expect(drain.track(first)).toBe(true);
    expect(drain.track(second)).toBe(true);

    let closed = false;
    const closing = drain.beginClose().then(() => {
      closed = true;
    });
    await nextTurn();
    expect(closed).toBe(false);

    drain.release(first);
    drain.release(first);
    await nextTurn();
    expect(closed).toBe(false);

    drain.release(second);
    await closing;
    expect(closed).toBe(true);
  });

  it("ignores requests arriving after close starts and keeps beginClose idempotent", async () => {
    const drain = createConnectorRequestDrain();
    const first = drain.beginClose();
    const second = drain.beginClose();
    const lateRequest = {};

    expect(drain.track(lateRequest)).toBe(false);
    drain.release(lateRequest);

    expect(second).toBe(first);
    await expect(first).resolves.toBeUndefined();
  });
});
