export interface CsvParseOptions {
  delimiter?: string;
  hasHeaders?: boolean;
  skipEmptyLines?: boolean;
  trimHeaders?: boolean;
}

export type CsvWorkerTransferType =
  | 'string'
  | 'array-buffer'
  | 'shared-array-buffer';

export interface CsvWorkerParseRuntime {
  chunkSizeBytes?: number;
  workerCount?: number;
  chunksPerWorker?: number;
  transferType?: CsvWorkerTransferType;
}

export interface CsvParseError {
  message: string;
  row?: number;
  column?: number;
}

export interface CsvWorkerParseStats {
  chunkCount: number;
  chunkSizesBytes: number[];
  workerCount: number;
  chunksPerWorker: number;
  transferType: CsvWorkerTransferType;
  targetChunkSizeBytes: number;
}

export interface CsvParseResult {
  fileName: string;
  fileSize: number;
  durationMs: number;
  delimiter: string;
  headers: string[];
  rows: string[][];
  rowCount: number;
  columnCount: number;
  errors: CsvParseError[];
  workerStats?: CsvWorkerParseStats;
}

export interface CsvParserPoolStats {
  totalWorkers: number;
  busyWorkers: number;
  idleWorkers: number;
  pendingTasks: number;
  activeTasks: number;
}

export interface CsvRecordChunk {
  index: number;
  startByte: number;
  endByte: number;
  startRow: number;
  endRow: number;
}

export interface CsvRecordChunkParseResult {
  chunk: CsvRecordChunk;
  rawRows: string[][];
  errors: CsvParseError[];
}

export type CsvRecordChunkPayload =
  | {
      transferType: 'string';
      text: string;
    }
  | {
      transferType: 'array-buffer';
      buffer: ArrayBuffer;
    }
  | {
      transferType: 'shared-array-buffer';
      buffer: SharedArrayBuffer;
      byteOffset: number;
      byteLength: number;
    };
