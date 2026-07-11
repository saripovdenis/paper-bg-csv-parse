import { normalizeCsvDelimiter } from './document';
import type {
  CsvParseOptions,
  CsvRecordChunk,
  CsvWorkerParseRuntime,
} from './types';

const DEFAULT_CHUNK_SIZE_BYTES = 1024 * 1024;
const SCAN_SLICE_BYTES = 64 * 1024;
const CARRIAGE_RETURN = 13;
const LINE_FEED = 10;
const QUOTE = 34;

export function getCsvTargetChunkSizeBytes(
  fileSize: number,
  runtime: CsvWorkerParseRuntime = {},
) {
  if (runtime.chunkSizeBytes !== undefined) {
    return normalizePositiveInteger(runtime.chunkSizeBytes, 'chunkSizeBytes');
  }

  if (runtime.chunksPerWorker === undefined) {
    return DEFAULT_CHUNK_SIZE_BYTES;
  }

  const workerCount = normalizePositiveInteger(
    runtime.workerCount ?? 2,
    'workerCount',
  );
  const chunksPerWorker = normalizePositiveInteger(
    runtime.chunksPerWorker,
    'chunksPerWorker',
  );

  return Math.max(1, Math.ceil(fileSize / (workerCount * chunksPerWorker)));
}

export async function findCsvRecordChunks(
  file: File,
  options: CsvParseOptions = {},
  runtime: CsvWorkerParseRuntime = {},
): Promise<CsvRecordChunk[]> {
  const delimiter = normalizeCsvDelimiter(options.delimiter);
  const delimiterByte = getAsciiByte(delimiter);

  if (delimiterByte === null) {
    return createWholeFileChunks(file, options);
  }

  if (file.size === 0) {
    return options.skipEmptyLines === false ? [createEmptyChunk()] : [];
  }

  const chunkSizeBytes = getCsvTargetChunkSizeBytes(file.size, runtime);
  const chunks: CsvRecordChunk[] = [];
  let chunkStartByte = 0;
  let chunkStartRow = 1;
  let currentRow = 1;
  let inQuotes = false;
  let atCellStart = true;
  let skippedByteOffset = -1;
  let lastRecordEndByte = -1;
  let offset = 0;

  while (offset < file.size) {
    const scanEnd = Math.min(offset + SCAN_SLICE_BYTES, file.size);
    const readEnd = Math.min(scanEnd + 1, file.size);
    const bytes = new Uint8Array(
      await file.slice(offset, readEnd).arrayBuffer(),
    );

    for (let byteOffset = offset; byteOffset < scanEnd; byteOffset += 1) {
      if (byteOffset === skippedByteOffset) continue;

      const byte = bytes[byteOffset - offset];
      const nextByte = bytes[byteOffset + 1 - offset];

      if (inQuotes) {
        if (byte !== QUOTE) continue;

        if (nextByte === QUOTE) {
          skippedByteOffset = byteOffset + 1;
          continue;
        }

        inQuotes = false;
        continue;
      }

      if (atCellStart && byte === QUOTE) {
        inQuotes = true;
        atCellStart = false;
        continue;
      }

      if (byte === delimiterByte) {
        atCellStart = true;
        continue;
      }

      if (byte === CARRIAGE_RETURN || byte === LINE_FEED) {
        const isCarriageReturnLineFeed =
          byte === CARRIAGE_RETURN && nextByte === LINE_FEED;
        const recordEndByte = byteOffset + (isCarriageReturnLineFeed ? 2 : 1);
        const recordEndRow = currentRow;

        if (isCarriageReturnLineFeed) {
          skippedByteOffset = byteOffset + 1;
        }

        lastRecordEndByte = recordEndByte;
        currentRow += 1;
        atCellStart = true;

        if (recordEndByte - chunkStartByte >= chunkSizeBytes) {
          chunks.push({
            index: chunks.length,
            startByte: chunkStartByte,
            endByte: recordEndByte,
            startRow: chunkStartRow,
            endRow: recordEndRow,
          });

          chunkStartByte = recordEndByte;
          chunkStartRow = currentRow;
        }

        continue;
      }

      atCellStart = false;
    }

    offset = scanEnd;
  }

  if (chunkStartByte < file.size) {
    chunks.push({
      index: chunks.length,
      startByte: chunkStartByte,
      endByte: file.size,
      startRow: chunkStartRow,
      endRow: currentRow,
    });
  } else if (
    options.skipEmptyLines === false &&
    lastRecordEndByte === file.size
  ) {
    chunks.push({
      index: chunks.length,
      startByte: file.size,
      endByte: file.size,
      startRow: currentRow,
      endRow: currentRow,
    });
  }

  return chunks;
}

function getAsciiByte(value: string) {
  const byte = value.charCodeAt(0);
  return byte <= 0x7f ? byte : null;
}

function createWholeFileChunks(
  file: File,
  options: CsvParseOptions,
): CsvRecordChunk[] {
  if (file.size > 0) {
    return [
      {
        index: 0,
        startByte: 0,
        endByte: file.size,
        startRow: 1,
        endRow: 1,
      },
    ];
  }

  return options.skipEmptyLines === false ? [createEmptyChunk()] : [];
}

function createEmptyChunk(): CsvRecordChunk {
  return {
    index: 0,
    startByte: 0,
    endByte: 0,
    startRow: 1,
    endRow: 1,
  };
}

function normalizePositiveInteger(value: number, name: string) {
  if (!Number.isFinite(value) || value < 1) {
    throw new RangeError(`${name} must be a positive number`);
  }

  return Math.floor(value);
}
