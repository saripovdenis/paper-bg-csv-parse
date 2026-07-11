import * as workerpool from 'workerpool';
import workerUrl from './parse.worker.ts?worker&url';

import { getCsvTargetChunkSizeBytes } from './chunker';
import { buildCsvDocument, parseCsvText } from './document';
import type {
  CsvParseOptions,
  CsvParseResult,
  CsvParserPoolStats,
  CsvRecordChunk,
  CsvRecordChunkParseResult,
  CsvRecordChunkPayload,
  CsvWorkerParseRuntime,
  CsvWorkerTransferType,
} from './types';

type CsvParserPool = ReturnType<typeof workerpool.pool>;

interface ResolvedCsvWorkerRuntime {
  workerCount: number;
  chunksPerWorker: number;
  transferType: CsvWorkerTransferType;
  targetChunkSizeBytes: number;
}

const DEFAULT_WORKER_COUNT = 2;
const DEFAULT_TRANSFER_TYPE: CsvWorkerTransferType = 'string';

let csvParserPool: CsvParserPool | null = null;
let csvParserPoolWorkerCount: number | null = null;
let activePoolUsers = 0;
let poolIdlePromise: Promise<void> | null = null;
let resolvePoolIdle: (() => void) | null = null;
let poolOperationQueue = Promise.resolve();

export async function parseCsvFileInMainThread(
  file: File,
  options: CsvParseOptions = {},
): Promise<CsvParseResult> {
  const startedAt = performance.now();
  const text = await file.text();
  const parsed = parseCsvText(text, options);

  return {
    ...parsed,
    fileName: file.name,
    fileSize: file.size,
    durationMs: performance.now() - startedAt,
  };
}

export async function parseCsvFileInWorker(
  file: File,
  options: CsvParseOptions = {},
  runtime: CsvWorkerParseRuntime = {},
): Promise<CsvParseResult> {
  const startedAt = performance.now();
  const resolvedRuntime = resolveCsvWorkerRuntime(file.size, runtime);

  assertTransferTypeAvailable(resolvedRuntime.transferType);

  return withCsvParserPool(resolvedRuntime.workerCount, async (pool) => {
    const chunks = (await pool.exec('findCsvRecordChunks', [
      file,
      options,
      { chunkSizeBytes: resolvedRuntime.targetChunkSizeBytes },
    ])) as CsvRecordChunk[];
    const sharedBuffer =
      resolvedRuntime.transferType === 'shared-array-buffer' &&
      chunks.length > 0
        ? ((await pool.exec('createSharedCsvFileBuffer', [
            file,
          ])) as SharedArrayBuffer)
        : undefined;
    const chunkResults = await readCsvChunks(
      pool,
      file,
      chunks,
      options,
      resolvedRuntime,
      sharedBuffer,
    );
    const rawRows = chunkResults.flatMap((result) => result.rawRows);
    const errors = chunkResults.flatMap((result) =>
      result.errors.map((error) => ({
        ...error,
        row:
          typeof error.row === 'number'
            ? result.chunk.startRow + error.row - 1
            : error.row,
      })),
    );
    const parsed = buildCsvDocument(rawRows, errors, options);

    return {
      ...parsed,
      fileName: file.name,
      fileSize: file.size,
      durationMs: performance.now() - startedAt,
      workerStats: {
        chunkCount: chunks.length,
        chunkSizesBytes: chunks.map((chunk) => chunk.endByte - chunk.startByte),
        workerCount: resolvedRuntime.workerCount,
        chunksPerWorker: resolvedRuntime.chunksPerWorker,
        transferType: resolvedRuntime.transferType,
        targetChunkSizeBytes: resolvedRuntime.targetChunkSizeBytes,
      },
    };
  });
}

export async function prewarmCsvParserPool(
  workerCount = DEFAULT_WORKER_COUNT,
): Promise<void> {
  const resolvedWorkerCount = normalizePositiveInteger(
    workerCount,
    'workerCount',
  );

  await withCsvParserPool(resolvedWorkerCount, async (pool) => {
    await Promise.all(
      Array.from({ length: resolvedWorkerCount }, () =>
        pool.exec('prewarmCsvParserWorker'),
      ),
    );
  });
}

export function getCsvParserPoolStats(): CsvParserPoolStats {
  if (!csvParserPool) {
    setCsvParserPool(createCsvParserPool(DEFAULT_WORKER_COUNT));
  }

  return csvParserPool!.stats();
}

export async function terminateCsvParserPool(force = false): Promise<void> {
  await enqueuePoolOperation(async () => {
    if (!csvParserPool) return;
    if (!force && activePoolUsers > 0) await waitForPoolIdle();

    const pool = csvParserPool;

    try {
      await pool.terminate(force);
    } finally {
      if (csvParserPool === pool) clearCsvParserPool();
    }
  });
}

async function readCsvChunks(
  pool: CsvParserPool,
  file: File,
  chunks: CsvRecordChunk[],
  options: CsvParseOptions,
  runtime: ResolvedCsvWorkerRuntime,
  sharedBuffer?: SharedArrayBuffer,
) {
  const results: CsvRecordChunkParseResult[] = new Array(chunks.length);
  let nextChunkIndex = 0;

  async function readNextChunk() {
    while (nextChunkIndex < chunks.length) {
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;
      const chunk = chunks[chunkIndex];

      results[chunkIndex] = await readCsvChunk(
        pool,
        file,
        chunk,
        options,
        runtime.transferType,
        sharedBuffer,
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(runtime.workerCount, chunks.length) },
      readNextChunk,
    ),
  );

  return results.sort((left, right) => left.chunk.index - right.chunk.index);
}

async function readCsvChunk(
  pool: CsvParserPool,
  file: File,
  chunk: CsvRecordChunk,
  options: CsvParseOptions,
  transferType: CsvWorkerTransferType,
  sharedBuffer?: SharedArrayBuffer,
) {
  const blob = file.slice(chunk.startByte, chunk.endByte);

  if (transferType === 'string') {
    const payload: CsvRecordChunkPayload = {
      transferType,
      text: await blob.text(),
    };

    return (await pool.exec('readCsvRecordChunk', [
      payload,
      chunk,
      file.size,
      options,
    ])) as CsvRecordChunkParseResult;
  }

  if (transferType === 'array-buffer') {
    const buffer = await blob.arrayBuffer();
    const payload: CsvRecordChunkPayload = { transferType, buffer };

    return (await pool.exec(
      'readCsvRecordChunk',
      [payload, chunk, file.size, options],
      { transfer: [buffer] },
    )) as CsvRecordChunkParseResult;
  }

  if (!sharedBuffer) {
    throw new Error('Shared CSV buffer was not initialized');
  }

  const payload: CsvRecordChunkPayload = {
    transferType,
    buffer: sharedBuffer,
    byteOffset: chunk.startByte,
    byteLength: chunk.endByte - chunk.startByte,
  };

  return (await pool.exec('readCsvRecordChunk', [
    payload,
    chunk,
    file.size,
    options,
  ])) as CsvRecordChunkParseResult;
}

function resolveCsvWorkerRuntime(
  fileSize: number,
  runtime: CsvWorkerParseRuntime,
): ResolvedCsvWorkerRuntime {
  if (
    runtime.chunkSizeBytes !== undefined &&
    runtime.chunksPerWorker !== undefined
  ) {
    throw new TypeError(
      'chunkSizeBytes and chunksPerWorker cannot be used together',
    );
  }

  const workerCount = normalizePositiveInteger(
    runtime.workerCount ?? DEFAULT_WORKER_COUNT,
    'workerCount',
  );
  const targetChunkSizeBytes = getCsvTargetChunkSizeBytes(fileSize, {
    ...runtime,
    workerCount,
  });
  const chunksPerWorker =
    runtime.chunksPerWorker === undefined
      ? Math.max(1, Math.ceil(fileSize / (workerCount * targetChunkSizeBytes)))
      : normalizePositiveInteger(runtime.chunksPerWorker, 'chunksPerWorker');
  const transferType = runtime.transferType ?? DEFAULT_TRANSFER_TYPE;

  if (!isCsvWorkerTransferType(transferType)) {
    throw new TypeError(`Unsupported worker transfer type: ${transferType}`);
  }

  return {
    workerCount,
    chunksPerWorker,
    transferType,
    targetChunkSizeBytes,
  };
}

function assertTransferTypeAvailable(transferType: CsvWorkerTransferType) {
  if (
    transferType === 'shared-array-buffer' &&
    (typeof SharedArrayBuffer === 'undefined' ||
      globalThis.crossOriginIsolated !== true)
  ) {
    throw new Error(
      'SharedArrayBuffer requires a cross-origin-isolated browser context',
    );
  }
}

function isCsvWorkerTransferType(
  value: string,
): value is CsvWorkerTransferType {
  return (
    value === 'string' ||
    value === 'array-buffer' ||
    value === 'shared-array-buffer'
  );
}

async function withCsvParserPool<T>(
  workerCount: number,
  operation: (pool: CsvParserPool) => Promise<T>,
) {
  const pool = await acquireCsvParserPool(workerCount);

  try {
    return await operation(pool);
  } finally {
    releaseCsvParserPool();
  }
}

function acquireCsvParserPool(workerCount: number) {
  return enqueuePoolOperation(async () => {
    if (csvParserPool && csvParserPoolWorkerCount === workerCount) {
      activePoolUsers += 1;
      return csvParserPool;
    }

    if (activePoolUsers > 0) await waitForPoolIdle();

    if (csvParserPool) {
      const previousPool = csvParserPool;

      try {
        await previousPool.terminate(false);
      } finally {
        if (csvParserPool === previousPool) clearCsvParserPool();
      }
    }

    const pool = createCsvParserPool(workerCount);
    setCsvParserPool(pool, workerCount);
    activePoolUsers += 1;
    return pool;
  });
}

function releaseCsvParserPool() {
  activePoolUsers = Math.max(0, activePoolUsers - 1);

  if (activePoolUsers === 0 && resolvePoolIdle) {
    resolvePoolIdle();
    poolIdlePromise = null;
    resolvePoolIdle = null;
  }
}

function waitForPoolIdle() {
  if (activePoolUsers === 0) return Promise.resolve();

  if (!poolIdlePromise) {
    poolIdlePromise = new Promise<void>((resolve) => {
      resolvePoolIdle = resolve;
    });
  }

  return poolIdlePromise;
}

function enqueuePoolOperation<T>(operation: () => Promise<T> | T) {
  const result = poolOperationQueue.then(operation, operation);
  poolOperationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function createCsvParserPool(workerCount: number) {
  return workerpool.pool(workerUrl, {
    maxQueueSize: Math.max(4, workerCount * 2),
    maxWorkers: workerCount,
    minWorkers: 'max',
    workerOpts: { type: 'module' },
    workerType: 'web',
  });
}

function setCsvParserPool(
  pool: CsvParserPool,
  workerCount = DEFAULT_WORKER_COUNT,
) {
  csvParserPool = pool;
  csvParserPoolWorkerCount = workerCount;
}

function clearCsvParserPool() {
  csvParserPool = null;
  csvParserPoolWorkerCount = null;
}

function normalizePositiveInteger(value: number, name: string) {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${name} must be a positive number`);
  }

  return Math.floor(value);
}
