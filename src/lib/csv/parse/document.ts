import { readCsvRows } from './reader';
import type { CsvParseError, CsvParseOptions, CsvParseResult } from './types';
import { validateRowByColumnCount } from './validation';

const DEFAULT_DELIMITER = ',';

type CsvTextParseResult = Omit<
  CsvParseResult,
  'fileName' | 'fileSize' | 'durationMs'
>;

export function normalizeCsvDelimiter(delimiter: string | undefined) {
  if (!delimiter) return DEFAULT_DELIMITER;

  if (delimiter.length !== 1) {
    throw new Error('Delimiter must be one character');
  }

  return delimiter;
}

export function parseCsvText(
  text: string,
  {
    delimiter: rawDelimiter,
    hasHeaders = true,
    skipEmptyLines = true,
    trimHeaders = true,
  }: CsvParseOptions = {},
): CsvTextParseResult {
  const delimiter = normalizeCsvDelimiter(rawDelimiter);
  const { rawRows, errors } = readCsvRows(text, delimiter, {
    skipEmptyLines,
  });

  return buildCsvDocument(rawRows, errors, {
    delimiter,
    hasHeaders,
    skipEmptyLines,
    trimHeaders,
  });
}

export function buildCsvDocument(
  rawRows: string[][],
  parseErrors: CsvParseError[],
  {
    delimiter: rawDelimiter,
    hasHeaders = true,
    trimHeaders = true,
  }: CsvParseOptions = {},
): CsvTextParseResult {
  const delimiter = normalizeCsvDelimiter(rawDelimiter);
  const errors = [...parseErrors];
  const expectedColumnCount = rawRows[0]?.length ?? 0;

  rawRows.forEach((row, index) => {
    try {
      validateRowByColumnCount(row, expectedColumnCount);
    } catch (error) {
      errors.push({
        message: error instanceof Error ? error.message : 'Invalid row',
        row: index + 1,
      });
    }
  });

  const headers =
    hasHeaders && rawRows[0]
      ? rawRows[0].map((header) => (trimHeaders ? header.trim() : header))
      : [];
  const rows = hasHeaders ? rawRows.slice(1) : rawRows;

  return {
    delimiter,
    headers,
    rows,
    rowCount: rows.length,
    columnCount: expectedColumnCount,
    errors,
  };
}
