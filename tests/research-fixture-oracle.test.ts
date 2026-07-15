import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertResearchFixtureContent,
  expectedResearchFixtureRow,
} from '../src/lib/research/fixture-oracle.ts';
import type { CsvParseResult } from '../src/lib/csv/parse/types.ts';
import type { ResearchFile } from '../src/lib/research/types.ts';

const headers = [
  'id',
  'account_id',
  'created_at',
  'amount',
  'quantity',
  'status',
  'region',
  'channel',
  'score',
  'note',
];

function resultWithRows(rows: string[][]): CsvParseResult {
  return {
    fileName: 'fixture.csv',
    fileSize: 0,
    durationMs: 0,
    delimiter: ',',
    headers: [...headers],
    rows,
    rowCount: rows.length,
    columnCount: headers.length,
    errors: [],
    contentDigest: '0000000000000000-0',
  };
}

function fileWithRows(rowCount: number): ResearchFile {
  return {
    id: '1-mib',
    name: 'fixture.csv',
    sizeMiB: 1,
    sizeBytes: 0,
    maxChunksPerWorker: 1,
    rowCount,
    columnCount: headers.length,
    errorCount: 0,
  };
}

test('reproduces every generated fixture value type', () => {
  assert.deepEqual(expectedResearchFixtureRow(4), [
    '5',
    'acct_5',
    '2026-05-05T12:04:00Z',
    '53.48',
    '5',
    'archived',
    'mea',
    'web',
    '2.8',
    'unicode café 東京',
  ]);
  assert.equal(expectedResearchFixtureRow(2).at(-1), 'line one\nline two');
  assert.equal(expectedResearchFixtureRow(3).at(-1), 'escaped "quote"');
});

test('checks every parsed cell against the independent fixture formula', () => {
  const rows = [
    [...expectedResearchFixtureRow(0)],
    [...expectedResearchFixtureRow(1)],
  ];
  const file = fileWithRows(rows.length);

  assert.doesNotThrow(() =>
    assertResearchFixtureContent(file, resultWithRows(rows)),
  );

  rows[1][5] = 'corrupt';
  assert.throws(
    () => assertResearchFixtureContent(file, resultWithRows(rows)),
    /row 2, column 6/,
  );
});
