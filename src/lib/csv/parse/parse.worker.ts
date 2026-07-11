import * as workerpool from 'workerpool';

import { findCsvRecordChunks } from './chunker';
import { normalizeCsvDelimiter } from './document';
import { readCsvRows } from './reader';
import type {
  CsvParseOptions,
  CsvRecordChunk,
  CsvRecordChunkPayload,
  CsvRecordChunkParseResult,
} from './types';

function readCsvRecordChunk(
  payload: CsvRecordChunkPayload,
  chunk: CsvRecordChunk,
  fileSize: number,
  options: CsvParseOptions = {},
): CsvRecordChunkParseResult {
  const delimiter = normalizeCsvDelimiter(options.delimiter);
  const text = readPayloadText(payload);
  const { rawRows, errors } = readCsvRows(text, delimiter, {
    allowFinalEmptyRow: chunk.endByte === fileSize,
    skipEmptyLines: options.skipEmptyLines ?? true,
  });

  return {
    chunk,
    rawRows,
    errors,
  };
}

function readPayloadText(payload: CsvRecordChunkPayload) {
  if (payload.transferType === 'string') return payload.text;

  const bytes =
    payload.transferType === 'array-buffer'
      ? new Uint8Array(payload.buffer)
      : // Chrome rejects SharedArrayBuffer-backed views in TextDecoder.
        new Uint8Array(
          new Uint8Array(
            payload.buffer,
            payload.byteOffset,
            payload.byteLength,
          ),
        );

  return new TextDecoder().decode(bytes);
}

function prewarmCsvParserWorker() {
  return true;
}

async function createSharedCsvFileBuffer(file: File) {
  const source = await file.arrayBuffer();
  const shared = new SharedArrayBuffer(source.byteLength);
  new Uint8Array(shared).set(new Uint8Array(source));
  return shared;
}

workerpool.worker({
  createSharedCsvFileBuffer,
  findCsvRecordChunks,
  prewarmCsvParserWorker,
  readCsvRecordChunk,
});
