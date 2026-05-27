import type { CsvParseResult } from '@/lib/csv';

export type ParseMode = 'main-thread' | 'worker';

const FRAME_BUDGET_MS = 16.7;

export interface BrowserWorkMeasurement<T> {
  result: T;
  extra: {
    durationMs: number;
    frameUiFrozenMs: number;
  };
}

function nextAnimationFrame() {
  return new Promise<number>((resolve) => {
    window.requestAnimationFrame(() => resolve(performance.now()));
  });
}

export async function measureBrowserWork<T>(
  run: () => Promise<T>,
): Promise<BrowserWorkMeasurement<T>> {
  let frameId = 0;
  let lastFrameAt = performance.now();
  const startedAtMs = lastFrameAt;
  let maxFrameGapMs = 0;

  function trackFrame() {
    const now = performance.now();
    const frameGapMs = now - lastFrameAt;
    maxFrameGapMs = Math.max(maxFrameGapMs, frameGapMs);
    lastFrameAt = now;
    frameId = window.requestAnimationFrame(trackFrame);
  }

  frameId = window.requestAnimationFrame(trackFrame);

  try {
    const result = await run();
    const endedAtMs = performance.now();
    const durationMs = endedAtMs - startedAtMs;
    const postRunGapMs = performance.now() - lastFrameAt;
    maxFrameGapMs = Math.max(maxFrameGapMs, postRunGapMs);
    const frameUiFrozenMs = Math.max(0, maxFrameGapMs - FRAME_BUDGET_MS);

    await nextAnimationFrame();

    return {
      result,
      extra: {
        durationMs,
        frameUiFrozenMs,
      },
    };
  } finally {
    window.cancelAnimationFrame(frameId);
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
