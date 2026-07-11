import type { CsvParseResult } from '@/lib/csv';

export type ParseMode = 'main-thread' | 'worker';

const FRAME_BUDGET_MS = 16.7;
const LONG_TASK_THRESHOLD_MS = 50;

export interface LongTaskMetrics {
  longestMainThreadBlockMs: number;
  totalBlockingTimeMs: number;
  longTaskCount: number;
}

export interface BrowserWorkMeasurement<T> {
  result: T;
  extra: LongTaskMetrics & {
    durationMs: number;
    frameUiFrozenMs: number;
  };
}

export function aggregateLongTasks(
  entries: ReadonlyArray<Pick<PerformanceEntry, 'duration'>>,
): LongTaskMetrics {
  let longestMainThreadBlockMs = 0;
  let totalBlockingTimeMs = 0;

  for (const entry of entries) {
    longestMainThreadBlockMs = Math.max(
      longestMainThreadBlockMs,
      entry.duration,
    );
    totalBlockingTimeMs += Math.max(0, entry.duration - LONG_TASK_THRESHOLD_MS);
  }

  return {
    longestMainThreadBlockMs,
    totalBlockingTimeMs,
    longTaskCount: entries.length,
  };
}

function clipLongTasksToWindow(
  entries: ReadonlyArray<Pick<PerformanceEntry, 'duration' | 'startTime'>>,
  startedAtMs: number,
  endedAtMs: number,
) {
  const clippedEntries: Array<Pick<PerformanceEntry, 'duration'>> = [];

  for (const entry of entries) {
    const overlapStartedAtMs = Math.max(startedAtMs, entry.startTime);
    const overlapEndedAtMs = Math.min(
      endedAtMs,
      entry.startTime + entry.duration,
    );

    if (overlapEndedAtMs > overlapStartedAtMs) {
      clippedEntries.push({
        duration: overlapEndedAtMs - overlapStartedAtMs,
      });
    }
  }

  return clippedEntries;
}

function observeLongTasks(entries: PerformanceEntry[]) {
  if (
    typeof PerformanceObserver === 'undefined' ||
    !PerformanceObserver.supportedEntryTypes.includes('longtask')
  ) {
    return null;
  }

  const observer = new PerformanceObserver((list) => {
    entries.push(...list.getEntries());
  });

  try {
    observer.observe({ type: 'longtask' });
    return observer;
  } catch {
    observer.disconnect();
    return null;
  }
}

export async function measureBrowserWork<T>(
  run: () => Promise<T>,
): Promise<BrowserWorkMeasurement<T>> {
  const longTaskEntries: PerformanceEntry[] = [];
  const longTaskObserver = observeLongTasks(longTaskEntries);
  const startedAtMs = performance.now();
  let lastFrameAtMs = startedAtMs;
  let maxFrameGapMs = 0;
  let frameId: number;
  let flushFrameId: number | null = null;

  function trackFrame() {
    const now = performance.now();
    const frameGapMs = now - lastFrameAtMs;
    maxFrameGapMs = Math.max(maxFrameGapMs, frameGapMs);
    lastFrameAtMs = now;
    frameId = window.requestAnimationFrame(trackFrame);
  }

  frameId = window.requestAnimationFrame(trackFrame);

  try {
    const result = await run();
    const endedAtMs = performance.now();
    const durationMs = endedAtMs - startedAtMs;
    const postRunGapMs = endedAtMs - lastFrameAtMs;
    maxFrameGapMs = Math.max(maxFrameGapMs, postRunGapMs);
    const frameUiFrozenMs = Math.max(0, maxFrameGapMs - FRAME_BUDGET_MS);

    await new Promise<void>((resolve) => {
      flushFrameId = window.requestAnimationFrame(() => {
        flushFrameId = null;
        resolve();
      });
    });

    if (longTaskObserver) {
      longTaskEntries.push(...longTaskObserver.takeRecords());
    }

    const longTaskMetrics = aggregateLongTasks(
      clipLongTasksToWindow(longTaskEntries, startedAtMs, endedAtMs),
    );

    return {
      result,
      extra: {
        durationMs,
        frameUiFrozenMs,
        ...longTaskMetrics,
      },
    };
  } finally {
    window.cancelAnimationFrame(frameId);
    if (flushFrameId !== null) window.cancelAnimationFrame(flushFrameId);
    longTaskObserver?.disconnect();
  }
}

export function logParseStats(
  mode: ParseMode,
  measurement: BrowserWorkMeasurement<CsvParseResult>,
) {
  const { result, extra } = measurement;
  const stats = {
    mode,
    fileName: result.fileName,
    fileSizeBytes: result.fileSize,
    rows: result.rowCount,
    columns: result.columnCount,
    parseDurationMs: result.durationMs,
    measurementDurationMs: extra.durationMs,
    frameUiFrozenMs: extra.frameUiFrozenMs,
    longestMainThreadBlockMs: extra.longestMainThreadBlockMs,
    totalBlockingTimeMs: extra.totalBlockingTimeMs,
    longTaskCount: extra.longTaskCount,
    ...(mode === 'worker' && result.workerStats
      ? {
          chunks: result.workerStats.chunkCount,
          chunkSizesBytes: result.workerStats.chunkSizesBytes,
          totalDurationMs: result.durationMs,
        }
      : {}),
  };

  console.log('CSV parse stats', stats);
}
