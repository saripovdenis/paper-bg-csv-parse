import {
  parseCsvFileInMainThread,
  parseCsvFileInWorker,
  prewarmCsvParserPool,
  terminateCsvParserPool,
  type CsvParseResult,
} from '@/lib/csv';
import { measureBrowserWork } from '@/lib/measurements';

import { loggerService } from './logger-service';
import {
  advanceAfterMeasurement,
  advanceAfterWarmup,
  getCurrentTask,
} from './plan';
import { researchStateService } from './state-service';
import type { ResearchFile, ResearchTask } from './types';

export type ResearchRunnerStage =
  | 'loading-file'
  | 'prewarming'
  | 'recovering'
  | 'warming-up'
  | 'measuring'
  | 'saving'
  | 'reloading'
  | null;

export interface ResearchRunnerSnapshot {
  active: boolean;
  stage: ResearchRunnerStage;
  detail: string | null;
  error: string | null;
}

export type ResearchFileLoader = (
  file: ResearchFile,
  signal: AbortSignal,
) => Promise<File>;

type Listener = () => void;

const RUNNER_LOCK = 'paper-bg-csv-research-runner';
const IDLE_SNAPSHOT: ResearchRunnerSnapshot = {
  active: false,
  stage: null,
  detail: null,
  error: null,
};

function abortError() {
  return new DOMException('Research stopped', 'AbortError');
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function nextFrame(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const frame = requestAnimationFrame(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    });
    const onAbort = () => {
      cancelAnimationFrame(frame);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function assertVisible() {
  if (document.visibilityState !== 'visible') {
    throw new Error('Research paused because this tab was hidden');
  }
}

async function parseTask(file: File, task: ResearchTask) {
  if (task.approach === 'main-thread') {
    return parseCsvFileInMainThread(file);
  }

  return parseCsvFileInWorker(
    file,
    {},
    {
      workerCount: task.workerCount,
      chunksPerWorker: task.chunksPerWorker,
      transferType: task.transferType,
    },
  );
}

function assertExpectedResult(task: ResearchTask, result: CsvParseResult) {
  if (
    result.rowCount !== task.file.rowCount ||
    result.columnCount !== task.file.columnCount ||
    result.errors.length !== task.file.errorCount
  ) {
    throw new Error(
      `Unexpected parse result for ${task.file.name}: ${result.rowCount} rows, ${result.columnCount} columns, ${result.errors.length} errors`,
    );
  }
}

export class ResearchRunnerService {
  private snapshot: ResearchRunnerSnapshot = IDLE_SNAPSHOT;
  private readonly listeners = new Set<Listener>();
  private runPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;

  readonly getSnapshot = () => this.snapshot;

  readonly subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  startNew(
    loadFile: ResearchFileLoader,
    confirmedSessionId: string | null = null,
  ) {
    if (this.runPromise) return;
    this.begin(loadFile, false, async () => {
      const persistedState = await researchStateService.refresh();
      if (
        persistedState.status === 'running' ||
        (persistedState.sessionId !== null &&
          persistedState.sessionId !== confirmedSessionId)
      ) {
        this.publish({
          ...IDLE_SNAPSHOT,
          error: 'Saved research changed in another tab; reload this page',
        });
        return false;
      }
      await loggerService.resetAll();
      await researchStateService.start();
      return true;
    });
  }

  resume(loadFile: ResearchFileLoader) {
    if (this.runPromise) return;
    this.begin(loadFile, true, async () => {
      const state = await researchStateService.refresh();
      if (state.status === 'done') return false;
      if (state.status === 'idle') {
        if (state.sessionId) {
          await researchStateService.update({ status: 'running' });
        } else {
          await researchStateService.start();
        }
      }
      return true;
    });
  }

  autoResume(loadFile: ResearchFileLoader) {
    if (researchStateService.getSnapshot().status === 'running') {
      this.begin(loadFile, true);
    }
  }

  async stop() {
    if (!this.runPromise && this.snapshot.error && !this.snapshot.active)
      return;
    const activeRun = this.runPromise;
    this.abortController?.abort();
    if (researchStateService.getSnapshot().status === 'running') {
      await researchStateService.update((state) =>
        state.status === 'running' ? { ...state, status: 'idle' } : state,
      );
    }
    await activeRun;
    await terminateCsvParserPool(true);
    if (researchStateService.getSnapshot().status === 'running') {
      await researchStateService.update((state) =>
        state.status === 'running' ? { ...state, status: 'idle' } : state,
      );
    }
    this.publish({ ...IDLE_SNAPSHOT });
  }

  async reset() {
    if (this.runPromise) return;

    if (typeof navigator.locks === 'undefined') {
      await loggerService.resetAll();
      this.publish({ ...IDLE_SNAPSHOT });
      return;
    }

    await navigator.locks.request(
      RUNNER_LOCK,
      { ifAvailable: true },
      async (lock) => {
        if (!lock) {
          this.publish({
            ...IDLE_SNAPSHOT,
            error: 'Research is running in another tab',
          });
          return;
        }
        const persistedState = await researchStateService.refresh();
        if (persistedState.status === 'running') {
          this.publish({
            ...IDLE_SNAPSHOT,
            error: 'Research is running in another tab',
          });
          return;
        }
        await loggerService.resetAll();
        this.publish({ ...IDLE_SNAPSHOT });
      },
    );
  }

  clearError() {
    if (this.snapshot.error) this.publish({ ...this.snapshot, error: null });
  }

  private begin(
    loadFile: ResearchFileLoader,
    recoverMeasuredPhase: boolean,
    prepare?: () => Promise<boolean | void>,
  ) {
    if (this.runPromise) return;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const execute = async () => {
      const shouldRun = await prepare?.();
      if (shouldRun === false) return;
      if (signal.aborted) throw abortError();
      await this.runConfiguration(loadFile, signal, recoverMeasuredPhase);
    };

    const run = async () => {
      if (typeof navigator.locks === 'undefined') {
        await execute();
        return;
      }

      await navigator.locks.request(
        RUNNER_LOCK,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            this.publish({
              ...IDLE_SNAPSHOT,
              error: 'Research is running in another tab',
            });
            return;
          }
          await execute();
        },
      );
    };

    this.runPromise = run()
      .catch(async (error: unknown) => {
        if (isAbortError(error) || signal.aborted) return;
        if (researchStateService.getSnapshot().status === 'running') {
          await researchStateService.update({ status: 'idle' });
        }
        this.publish({
          ...IDLE_SNAPSHOT,
          error: error instanceof Error ? error.message : 'Research failed',
        });
      })
      .finally(() => {
        this.runPromise = null;
        this.abortController = null;
        if (!this.snapshot.error && this.snapshot.stage !== 'reloading') {
          this.publish({ ...IDLE_SNAPSHOT });
        }
      });
  }

  private async runConfiguration(
    loadFile: ResearchFileLoader,
    signal: AbortSignal,
    recoverMeasuredPhase: boolean,
  ) {
    assertVisible();
    const initialState = researchStateService.getSnapshot();
    const task = getCurrentTask(initialState);
    if (!task || initialState.status !== 'running') return;

    this.publish({
      active: true,
      stage: 'loading-file',
      detail: task.file.name,
      error: null,
    });
    const file = await loadFile(task.file, signal);
    if (signal.aborted) throw abortError();
    if (file.name !== task.file.name || file.size !== task.file.sizeBytes) {
      throw new Error(`Unexpected research asset: ${file.name}`);
    }
    loggerService.setupFile(task.file);

    const resumedState = researchStateService.getSnapshot();
    if (
      recoverMeasuredPhase &&
      resumedState.phase === 'warmup' &&
      resumedState.runIndex > 0
    ) {
      await researchStateService.update({ runIndex: 0 });
    }

    if (task.approach === 'workers') {
      this.publish({
        active: true,
        stage: 'prewarming',
        detail: `${task.workerCount} workers`,
        error: null,
      });
      await prewarmCsvParserPool(task.workerCount);
    }

    if (
      recoverMeasuredPhase &&
      researchStateService.getSnapshot().phase === 'measured'
    ) {
      await this.runRecoveryWarmups(file, task, signal);
    }

    while (!signal.aborted) {
      assertVisible();
      const state = researchStateService.getSnapshot();
      const currentTask = getCurrentTask(state);
      if (state.status !== 'running' || currentTask?.id !== task.id) return;

      if (state.phase === 'warmup') {
        this.publish({
          active: true,
          stage: 'warming-up',
          detail: `${state.runIndex + 1} / ${state.plan.warmupRuns}`,
          error: null,
        });
        await nextFrame(signal);
        const warmupResult = await parseTask(file, task);
        assertExpectedResult(task, warmupResult);
        const transition = advanceAfterWarmup(state);
        await researchStateService.commit(transition.state);
        continue;
      }

      this.publish({
        active: true,
        stage: 'measuring',
        detail: `${state.runIndex + 1} / ${state.plan.measuredRuns}`,
        error: null,
      });
      await nextFrame(signal);
      const measurement = await measureBrowserWork(() => parseTask(file, task));
      assertExpectedResult(task, measurement.result);
      assertVisible();
      if (signal.aborted) throw abortError();

      const transition = advanceAfterMeasurement(state);
      this.publish({
        active: true,
        stage: 'saving',
        detail: `${state.runIndex + 1} / ${state.plan.measuredRuns}`,
        error: null,
      });
      await loggerService.log(
        this.createLogInput(task, state.runIndex, file, measurement),
        transition.state,
      );
      const committedState = researchStateService.getSnapshot();
      if (
        signal.aborted ||
        (transition.researchCompleted
          ? committedState.status !== 'done'
          : committedState.status !== 'running')
      ) {
        throw abortError();
      }

      if (!transition.taskCompleted) continue;
      if (transition.fileCompleted) loggerService.calculate(task.file);
      await terminateCsvParserPool(true);

      if (transition.researchCompleted) {
        this.publish({ ...IDLE_SNAPSHOT });
        return;
      }

      this.publish({
        active: true,
        stage: 'reloading',
        detail: 'Fresh page for the next configuration',
        error: null,
      });
      window.location.reload();
      return;
    }

    throw abortError();
  }

  private async runRecoveryWarmups(
    file: File,
    task: ResearchTask,
    signal: AbortSignal,
  ) {
    const count = researchStateService.getSnapshot().plan.warmupRuns;
    for (let index = 0; index < count; index += 1) {
      this.publish({
        active: true,
        stage: 'recovering',
        detail: `${index + 1} / ${count}`,
        error: null,
      });
      await nextFrame(signal);
      const recoveryResult = await parseTask(file, task);
      assertExpectedResult(task, recoveryResult);
    }
  }

  private createLogInput(
    task: ResearchTask,
    runIndex: number,
    file: File,
    measurement: Awaited<ReturnType<typeof measureBrowserWork<CsvParseResult>>>,
  ) {
    const { result, extra } = measurement;
    const durationSeconds = extra.durationMs / 1000;

    return {
      task,
      runIndex,
      fileName: file.name,
      fileSizeBytes: file.size,
      metrics: {
        durationMs: extra.durationMs,
        longestMainThreadBlockMs: extra.longestMainThreadBlockMs,
        totalBlockingTimeMs: extra.totalBlockingTimeMs,
        longTaskCount: extra.longTaskCount,
        parseDurationMs: result.durationMs,
        frameUiFrozenMs: extra.frameUiFrozenMs,
        throughputMiBPerSecond:
          durationSeconds === 0 ? 0 : file.size / 1024 ** 2 / durationSeconds,
        rowCount: result.rowCount,
        columnCount: result.columnCount,
        errorCount: result.errors.length,
        ...(result.workerStats
          ? {
              custom: {
                targetChunkSizeBytes: result.workerStats.targetChunkSizeBytes,
              },
            }
          : {}),
      },
      workerPool:
        task.approach === 'workers' && result.workerStats
          ? {
              isPoolPrewarmed: true,
              workerPoolSize: task.workerCount,
              chunksPerWorker: task.chunksPerWorker,
              actualChunkCount: result.workerStats.chunkCount,
              chunkSizesBytes: result.workerStats.chunkSizesBytes,
              transferType: task.transferType,
            }
          : null,
    };
  }

  private publish(snapshot: ResearchRunnerSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}

export const researchRunnerService = new ResearchRunnerService();
