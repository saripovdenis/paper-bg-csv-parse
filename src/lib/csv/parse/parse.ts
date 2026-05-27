import * as workerpool from 'workerpool';
import workerUrl from './parse.worker.ts?worker&url';

import { buildCsvDocument, parseCsvText } from './document';
import type {
  CsvParseOptions,
  CsvParseResult,
  CsvParserPoolStats,
  CsvRecordChunk,
  CsvRecordChunkParseResult,
  CsvWorkerParseRuntime,
} from './types';

type CsvParserPool = ReturnType<typeof workerpool.pool>;
const WORKER_COUNT = 2;

let csvParserPool: CsvParserPool | null = null;

function getPool() {
  if (!csvParserPool) {
    csvParserPool = workerpool.pool(workerUrl, {
      maxQueueSize: 4,
      maxWorkers: WORKER_COUNT,
      workerOpts: { type: 'module' },
      workerType: 'web',
    });
  }

  return csvParserPool;
}

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
  const chunks = (await getPool().exec('findCsvRecordChunks', [
    file,
    options,
    runtime,
  ])) as CsvRecordChunk[];
  const chunkResults = await readCsvChunks(file, chunks, options);
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
    },
  };
}

export function getCsvParserPoolStats(): CsvParserPoolStats {
  return getPool().stats();
}

export async function terminateCsvParserPool(force = false): Promise<void> {
  if (!csvParserPool) return;

  const pool = csvParserPool;
  csvParserPool = null;
  await pool.terminate(force);
}

async function readCsvChunks(
  file: File,
  chunks: CsvRecordChunk[],
  options: CsvParseOptions,
) {
  const results: CsvRecordChunkParseResult[] = new Array(chunks.length);
  let nextChunkIndex = 0;

  async function readNextChunk() {
    while (nextChunkIndex < chunks.length) {
      const chunkIndex = nextChunkIndex;
      nextChunkIndex += 1;

      results[chunkIndex] = (await getPool().exec('readCsvRecordChunk', [
        file,
        chunks[chunkIndex],
        options,
      ])) as CsvRecordChunkParseResult;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(WORKER_COUNT, chunks.length) }, () =>
      readNextChunk(),
    ),
  );

  return results.sort((left, right) => left.chunk.index - right.chunk.index);
}
