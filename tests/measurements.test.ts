import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateLongTasksInWindow,
  measureBrowserWork,
} from '../src/lib/measurements.ts';

test('counts blocking after the task threshold across the parse-start boundary', () => {
  assert.deepEqual(
    aggregateLongTasksInWindow([{ startTime: 0, duration: 100 }], 75, 125),
    {
      longestLongTaskOverlapMs: 25,
      parseWindowBlockingTimeMs: 25,
      longTaskCount: 1,
    },
  );
});

test('does not count a task initial segment as blocking', () => {
  assert.deepEqual(
    aggregateLongTasksInWindow([{ startTime: 75, duration: 100 }], 50, 100),
    {
      longestLongTaskOverlapMs: 25,
      parseWindowBlockingTimeMs: 0,
      longTaskCount: 1,
    },
  );
});

test('excludes tasks that only touch the parse-window boundaries', () => {
  assert.deepEqual(
    aggregateLongTasksInWindow(
      [
        { startTime: 0, duration: 50 },
        { startTime: 100, duration: 75 },
      ],
      50,
      100,
    ),
    {
      longestLongTaskOverlapMs: 0,
      parseWindowBlockingTimeMs: 0,
      longTaskCount: 0,
    },
  );
});

test('reports unsupported Long Task observation', async (t) => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  const observerDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'PerformanceObserver',
  );
  let nextFrameId = 0;
  const timers = new Map<number, ReturnType<typeof setTimeout>>();

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      requestAnimationFrame(callback: FrameRequestCallback) {
        const frameId = ++nextFrameId;
        const timer = setTimeout(() => {
          timers.delete(frameId);
          callback(performance.now());
        }, 0);
        timers.set(frameId, timer);
        return frameId;
      },
      cancelAnimationFrame(frameId: number) {
        const timer = timers.get(frameId);
        if (timer !== undefined) clearTimeout(timer);
        timers.delete(frameId);
      },
    },
  });
  Object.defineProperty(globalThis, 'PerformanceObserver', {
    configurable: true,
    value: undefined,
  });

  t.after(() => {
    for (const timer of timers.values()) clearTimeout(timer);
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (observerDescriptor) {
      Object.defineProperty(
        globalThis,
        'PerformanceObserver',
        observerDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis, 'PerformanceObserver');
    }
  });

  const measurement = await measureBrowserWork(async () => 'done');

  assert.equal(measurement.extra.longTaskObserverSupported, false);
  assert.equal(measurement.extra.longTaskCount, 0);
  assert.equal(measurement.extra.parseWindowBlockingTimeMs, 0);
});
