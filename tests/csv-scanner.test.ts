import assert from 'node:assert/strict';
import test from 'node:test';

import { BoundedQueue } from '../src/lib/csv/parse/bounded-queue.ts';
import { readCsvRows } from '../src/lib/csv/parse/reader.ts';
import { CsvRecordBoundaryScanner } from '../src/lib/csv/parse/scanner.ts';
import type { CsvRecordChunk } from '../src/lib/csv/parse/types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function scanText(
  text: string,
  targetChunkSizeBytes: number,
  segmentSizes: readonly number[],
  emitEmptyFile = false,
) {
  const bytes = encoder.encode(text);
  const scanner = new CsvRecordBoundaryScanner({
    delimiterByte: ','.charCodeAt(0),
    emitEmptyFile,
    fileSize: bytes.byteLength,
    targetChunkSizeBytes,
  });
  const chunks: CsvRecordChunk[] = [];
  let segmentStart = 0;
  let segmentIndex = 0;

  while (segmentStart < bytes.length) {
    const segmentSize = segmentSizes[segmentIndex % segmentSizes.length];
    const segment = bytes.subarray(
      segmentStart,
      Math.min(bytes.length, segmentStart + segmentSize),
    );

    for (let index = 0; index < segment.length; ) {
      const step = scanner.scan(segment, segmentStart, index);
      index = step.nextIndex;
      if (step.chunk) chunks.push(step.chunk);
    }

    segmentStart += segment.length;
    segmentIndex += 1;
  }

  const finalChunk = scanner.finish();
  if (finalChunk) chunks.push(finalChunk);
  return { bytes, chunks };
}

function parseChunks(
  bytes: Uint8Array,
  chunks: readonly CsvRecordChunk[],
  skipEmptyLines: boolean,
) {
  return chunks.flatMap(
    (chunk) =>
      readCsvRows(
        decoder.decode(bytes.subarray(chunk.startByte, chunk.endByte)),
        ',',
        {
          allowFinalEmptyRow: chunk.endByte === bytes.length,
          skipEmptyLines,
        },
      ).rawRows,
  );
}

function assertExactCoverage(
  chunks: readonly CsvRecordChunk[],
  byteLength: number,
) {
  let expectedStart = 0;
  chunks.forEach((chunk, index) => {
    assert.equal(chunk.index, index);
    assert.equal(chunk.startByte, expectedStart);
    assert.ok(chunk.endByte >= chunk.startByte);
    expectedStart = chunk.endByte;
  });
  assert.equal(expectedStart, byteLength);
}

test('finds safe boundaries across every byte split', () => {
  const text = 'a,b\n1,"line\none"\n2,"a""b"\n3,café 東京\n';
  const { bytes, chunks } = scanText(text, 8, [1]);

  assertExactCoverage(chunks, bytes.length);
  assert.deepEqual(
    parseChunks(bytes, chunks, true),
    readCsvRows(text, ',', { skipEmptyLines: true }).rawRows,
  );
});

test('keeps CRLF and escaped quotes intact across uneven segments', () => {
  const text = 'a,b\r\n1,"x""y"\r\n2,"line\r\ninside"\r\n3,z\r\n';
  const { bytes, chunks } = scanText(text, 7, [2, 3, 1, 5]);

  assertExactCoverage(chunks, bytes.length);
  assert.deepEqual(
    parseChunks(bytes, chunks, true),
    readCsvRows(text, ',', { skipEmptyLines: true }).rawRows,
  );
});

test('allows a quoted multiline record to exceed the target', () => {
  const text = 'a,b\n1,"12345\n67890"\n2,z\n';
  const { bytes, chunks } = scanText(text, 5, [4]);

  assert.ok(chunks.some((chunk) => chunk.endByte - chunk.startByte > 5));
  assert.deepEqual(
    parseChunks(bytes, chunks, true),
    readCsvRows(text, ',', { skipEmptyLines: true }).rawRows,
  );
});

test('does not add a second empty row after a trailing newline', () => {
  const text = 'a\n';
  const { bytes, chunks } = scanText(text, 1, [1], true);

  assert.equal(chunks.length, 1);
  assert.deepEqual(
    parseChunks(bytes, chunks, false),
    readCsvRows(text, ',', { skipEmptyLines: false }).rawRows,
  );
});

test('emits an empty chunk only when empty lines are retained', () => {
  assert.deepEqual(scanText('', 1, [1], false).chunks, []);
  assert.deepEqual(scanText('', 1, [1], true).chunks, [
    {
      index: 0,
      startByte: 0,
      endByte: 0,
      startRow: 1,
      endRow: 1,
    },
  ]);
});

test('leaves an unclosed quoted record in the final chunk', () => {
  const text = 'a,b\n1,"open\nstill open';
  const { bytes, chunks } = scanText(text, 4, [3, 2]);
  const chunkResults = chunks.map((chunk) =>
    readCsvRows(
      decoder.decode(bytes.subarray(chunk.startByte, chunk.endByte)),
      ',',
      {
        allowFinalEmptyRow: chunk.endByte === bytes.length,
        skipEmptyLines: true,
      },
    ),
  );

  assertExactCoverage(chunks, bytes.length);
  assert.equal(
    chunkResults.flatMap((result) => result.errors).at(-1)?.message,
    'Unclosed quoted cell',
  );
});

test('bounded queue hands work to consumers and never exceeds capacity', async () => {
  const queue = new BoundedQueue<number>(1);
  const waitingConsumer = queue.take();

  queue.push(1);
  queue.push(2);
  assert.throws(() => queue.push(3), /exceeded its capacity/);
  queue.close();

  assert.equal(await waitingConsumer, 1);
  assert.equal(await queue.take(), 2);
  assert.equal(await queue.take(), null);
  assert.equal(queue.maxSize, 1);
});

test('bounded queue propagates producer failure to waiting consumers', async () => {
  const queue = new BoundedQueue<number>(1);
  const waitingConsumer = queue.take();
  const failure = new Error('scanner failed');

  queue.fail(failure);

  await assert.rejects(waitingConsumer, failure);
  await assert.rejects(queue.take(), failure);
});
