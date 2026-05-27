# CSV

Browser-only CSV module with a main-thread parser path and a worker parser path.

## Flow

1. Upload UI receives a `File`.
2. Caller chooses `parseCsvFileInMainThread` or `parseCsvFileInWorker`.
3. Main-thread mode reads `File.text()` and parses directly.
4. Worker mode finds quote-aware record chunks through `chunker.ts`.
5. Worker mode parses chunks through `parse.worker.ts`.
6. Both modes build the final result through `document.ts`.

Worker chunks target byte size, but they only cut at CSV record boundaries outside
quotes. A single quoted multiline row can grow past the target size.

## Limits

- comma delimiter by default
- quoted cells and escaped quotes supported
- CRLF and LF supported
- no type inference
- no delimiter detection
- no streaming or encoding options
- no UI progress in v1
