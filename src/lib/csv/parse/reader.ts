import type { CsvParseError } from './types';

interface CsvRowsReaderOptions {
  allowFinalEmptyRow?: boolean;
  skipEmptyLines: boolean;
}

export function readCsvRows(
  text: string,
  delimiter: string,
  options: CsvRowsReaderOptions,
) {
  return new CsvRowsReader(text, delimiter, options).read();
}

class CsvRowsReader {
  private readonly text: string;
  private readonly delimiter: string;
  private readonly options: CsvRowsReaderOptions;
  private readonly rows: string[][] = [];
  private readonly errors: CsvParseError[] = [];
  private row: string[] = [];
  private cell = '';
  private inQuotes = false;
  private quoteStartRow = 1;
  private quoteStartColumn = 1;
  private sourceRow = 1;

  constructor(text: string, delimiter: string, options: CsvRowsReaderOptions) {
    this.text = text;
    this.delimiter = delimiter;
    this.options = options;
  }

  read() {
    for (let index = 0; index < this.text.length; index += 1) {
      if (!this.inQuotes && this.isLineEnd(index)) {
        this.pushRow();
        index = this.skipLineFeedAfterCarriageReturn(index);
        continue;
      }

      index = this.readCellChar(index);
    }

    if (this.inQuotes) {
      this.pushUnclosedQuoteError();
    }

    if (
      this.hasPendingRow() ||
      (!this.options.skipEmptyLines &&
        this.options.allowFinalEmptyRow !== false)
    ) {
      this.pushRow();
    }

    return {
      rawRows: this.rows,
      errors: this.errors,
    };
  }

  private readCellChar(index: number) {
    if (this.inQuotes) {
      return this.readQuotedCellChar(index);
    }

    return this.readUnquotedCellChar(index);
  }

  private readUnquotedCellChar(index: number) {
    const char = this.text[index];

    if (char === '"' && this.cell === '') {
      this.startQuotedCell();
      return index;
    }

    if (char === this.delimiter) {
      this.pushCell();
      return index;
    }

    this.cell += char;
    return index;
  }

  private readQuotedCellChar(index: number) {
    const char = this.text[index];

    if (char !== '"') {
      this.cell += char;
      return index;
    }

    if (this.text[index + 1] === '"') {
      this.cell += '"';
      return index + 1;
    }

    this.inQuotes = false;
    return index;
  }

  private startQuotedCell() {
    this.inQuotes = true;
    this.quoteStartRow = this.sourceRow;
    this.quoteStartColumn = this.row.length + 1;
  }

  private pushCell() {
    this.row.push(this.cell);
    this.cell = '';
  }

  private pushRow() {
    const nextRow = [...this.row, this.cell];
    const isEmptyLine = nextRow.length === 1 && nextRow[0] === '';

    if (!this.options.skipEmptyLines || !isEmptyLine) {
      this.rows.push(nextRow);
    }

    this.row = [];
    this.cell = '';
    this.sourceRow += 1;
  }

  private pushUnclosedQuoteError() {
    this.errors.push({
      message: 'Unclosed quoted cell',
      row: this.quoteStartRow,
      column: this.quoteStartColumn,
    });
  }

  private hasPendingRow() {
    return this.cell !== '' || this.row.length > 0;
  }

  private isLineEnd(index: number) {
    const char = this.text[index];
    return char === '\n' || char === '\r';
  }

  private skipLineFeedAfterCarriageReturn(index: number) {
    if (this.text[index] === '\r' && this.text[index + 1] === '\n') {
      return index + 1;
    }

    return index;
  }
}
