# CSV Benchmark Assets

Generate the fixtures with:

```sh
npm run assets:generate
```

| File                  | Target size |      Rows | Research role                                      |
| --------------------- | ----------: | --------: | -------------------------------------------------- |
| `01-small-1mib.csv`   |       1 MiB |    11,737 | Worker-overhead lower bound                        |
| `02-medium-10mib.csv` |      10 MiB |   115,989 | Main-thread/worker crossover region                |
| `03-large-100mib.csv` |     100 MiB | 1,147,213 | Parallel scaling, memory, and GC-pressure workload |

Each file stops before the next complete CSV record would cross its target.
This keeps the 100 MiB fixture within the application's upload limit.

All fixtures are deterministic prefixes of the same synthetic dataset and use
this schema:

```csv
id,account_id,created_at,amount,quantity,status,region,channel,score,note
```

The `note` column cycles through plain text, commas, escaped quotes, embedded
newlines, and UTF-8 text. Files use UTF-8 without a BOM and LF line endings.
