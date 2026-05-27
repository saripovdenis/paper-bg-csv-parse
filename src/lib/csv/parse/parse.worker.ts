import * as workerpool from 'workerpool';

import { findCsvRecordChunks } from './chunker';
import { normalizeCsvDelimiter } from './document';
import { readCsvRows } from './reader';
import type {
  CsvParseOptions,
  CsvRecordChunk,
  CsvRecordChunkParseResult,
} from './types';

async function readCsvRecordChunk(
  file: File,
  chunk: CsvRecordChunk,
  options: CsvParseOptions = {},
): Promise<CsvRecordChunkParseResult> {
  const delimiter = normalizeCsvDelimiter(options.delimiter);
  const text = await file.slice(chunk.startByte, chunk.endByte).text();
  const { rawRows, errors } = readCsvRows(text, delimiter, {
    allowFinalEmptyRow: chunk.endByte === file.size,
    skipEmptyLines: options.skipEmptyLines ?? true,
  });

  return {
    chunk,
    rawRows,
    errors,
  };
}

workerpool.worker({
  findCsvRecordChunks,
  readCsvRecordChunk,
});
