import {
  advanceAfterMeasurement,
  findResearchFile,
  getCurrentTask,
  researchPlan,
} from './plan';
import { researchStateService } from './state-service';
import {
  clearResearchLogs,
  clearResearchData,
  commitMeasuredLogAndState,
  loadResearchLogs,
} from './storage';
import type {
  MetricSummary,
  ResearchEnvironment,
  ResearchExport,
  ResearchFile,
  ResearchFileId,
  ResearchRunLog,
  ResearchRunLogInput,
  ResearchState,
  ResearchSummary,
  ResearchTask,
  ResearchTaskSummary,
} from './types';

type Listener = () => void;

const EMPTY_LOGS: readonly ResearchRunLog[] = [];

function percentile(sorted: readonly number[], fraction: number) {
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  return lower + (upper - lower) * (position - lowerIndex);
}

export function summarizeMetric(values: readonly number[]): MetricSummary {
  const sorted = values
    .filter(Number.isFinite)
    .toSorted((left, right) => left - right);
  if (sorted.length === 0) {
    return {
      count: 0,
      min: null,
      median: null,
      p10: null,
      p90: null,
      max: null,
      relativeSpread: null,
    };
  }

  const median = percentile(sorted, 0.5);
  const p10 = percentile(sorted, 0.1);
  const p90 = percentile(sorted, 0.9);

  return {
    count: sorted.length,
    min: sorted[0],
    median,
    p10,
    p90,
    max: sorted.at(-1) ?? null,
    relativeSpread:
      median === null || median === 0 || p10 === null || p90 === null
        ? null
        : (p90 - p10) / Math.abs(median),
  };
}

function browserEnvironment(): ResearchEnvironment {
  if (typeof navigator === 'undefined') {
    return {
      crossOriginIsolated: false,
      hardwareConcurrency: 1,
      deviceMemoryGb: null,
      userAgent: 'unknown',
    };
  }

  const navigatorWithMemory = navigator as Navigator & {
    deviceMemory?: number;
  };
  return {
    crossOriginIsolated:
      typeof crossOriginIsolated === 'boolean' && crossOriginIsolated,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: navigatorWithMemory.deviceMemory ?? null,
    userAgent: navigator.userAgent,
  };
}

function createRunLog(
  input: ResearchRunLogInput,
  state: ResearchState,
): ResearchRunLog {
  const sessionId = input.sessionId ?? state.sessionId;
  if (!sessionId) throw new Error('Start the research before logging runs');
  if (!Number.isInteger(input.runIndex) || input.runIndex < 0) {
    throw new Error('runIndex must be a zero-based integer');
  }
  if (input.runIndex >= state.plan.measuredRuns) {
    throw new Error(`runIndex must be below ${state.plan.measuredRuns}`);
  }
  if (input.sessionId && input.sessionId !== state.sessionId) {
    throw new Error('Run session does not match the active research session');
  }
  if (input.task.approach === 'workers' && !input.workerPool) {
    throw new Error('Worker runs require workerPool details');
  }
  if (input.task.approach === 'main-thread' && input.workerPool) {
    throw new Error('Main-thread runs cannot include workerPool details');
  }
  if (
    input.task.approach === 'workers' &&
    input.workerPool &&
    (input.workerPool.workerPoolSize !== input.task.workerCount ||
      input.workerPool.chunksPerWorker !== input.task.chunksPerWorker ||
      input.workerPool.transferType !== input.task.transferType)
  ) {
    throw new Error('workerPool details do not match the research task');
  }

  const requiredMetrics = [
    input.metrics.durationMs,
    input.metrics.longestMainThreadBlockMs,
    input.metrics.totalBlockingTimeMs,
    input.metrics.longTaskCount,
  ];
  if (!requiredMetrics.every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error('Required metrics must be finite, non-negative numbers');
  }

  return {
    ...input,
    id: `${sessionId}__${input.task.id}__run-${String(input.runIndex + 1).padStart(2, '0')}`,
    sessionId,
    fileName: input.fileName ?? input.task.file.name,
    fileSizeBytes: input.fileSizeBytes ?? input.task.file.sizeBytes,
    workerPool:
      input.task.approach === 'main-thread' ? null : (input.workerPool ?? null),
    env: input.env ?? browserEnvironment(),
    measuredAt: input.measuredAt ?? new Date().toISOString(),
  };
}

function compareLogs(left: ResearchRunLog, right: ResearchRunLog) {
  return (
    left.task.taskIndex - right.task.taskIndex ||
    left.runIndex - right.runIndex ||
    left.measuredAt.localeCompare(right.measuredAt)
  );
}

function taskSummary(
  task: ResearchTask,
  logs: readonly ResearchRunLog[],
  expectedRuns: number,
): ResearchTaskSummary {
  const taskLogs = logs.filter((log) => log.task.id === task.id);
  const runIndexes = new Set(taskLogs.map((log) => log.runIndex));
  const warnings: string[] = [];

  if (taskLogs.length > 0 && runIndexes.size !== expectedRuns) {
    warnings.push(
      `Expected ${expectedRuns} measured runs; found ${runIndexes.size}`,
    );
  }
  const missingRuns = Array.from({ length: expectedRuns }, (_, index) => index)
    .filter((index) => !runIndexes.has(index))
    .map((index) => index + 1);
  if (
    taskLogs.length > 0 &&
    missingRuns.length > 0 &&
    missingRuns.length <= 8
  ) {
    warnings.push(`Missing runs: ${missingRuns.join(', ')}`);
  }

  const rowCounts = new Set(
    taskLogs.flatMap((log) =>
      log.metrics.rowCount === undefined ? [] : [log.metrics.rowCount],
    ),
  );
  const columnCounts = new Set(
    taskLogs.flatMap((log) =>
      log.metrics.columnCount === undefined ? [] : [log.metrics.columnCount],
    ),
  );
  if (rowCounts.size > 1) warnings.push('Row count changed between runs');
  if (columnCounts.size > 1) warnings.push('Column count changed between runs');
  if (
    taskLogs.some(
      (log) =>
        log.metrics.rowCount !== task.file.rowCount ||
        log.metrics.columnCount !== task.file.columnCount ||
        log.metrics.errorCount !== task.file.errorCount,
    )
  ) {
    warnings.push('Result does not match the fixture baseline');
  }
  if (taskLogs.some((log) => (log.metrics.errorCount ?? 0) > 0)) {
    warnings.push('Parser errors were recorded');
  }

  if (task.approach === 'workers') {
    const expectedChunks = task.workerCount * task.chunksPerWorker;
    if (
      taskLogs.some(
        (log) =>
          log.workerPool?.actualChunkCount !== expectedChunks ||
          log.workerPool.workerPoolSize !== task.workerCount ||
          log.workerPool.transferType !== task.transferType,
      )
    ) {
      warnings.push('Worker configuration or chunk count changed');
    }
  }

  const longestBlocks = taskLogs.map(
    (log) => log.metrics.longestMainThreadBlockMs,
  );
  const blockingTimes = taskLogs.map((log) => log.metrics.totalBlockingTimeMs);

  return {
    task,
    expectedRuns,
    measuredRuns: runIndexes.size,
    complete: runIndexes.size === expectedRuns,
    durationMs: summarizeMetric(taskLogs.map((log) => log.metrics.durationMs)),
    longestMainThreadBlockMs: summarizeMetric(longestBlocks),
    totalBlockingTimeMs: summarizeMetric(blockingTimes),
    parseDurationMs: summarizeMetric(
      taskLogs.flatMap((log) =>
        log.metrics.parseDurationMs === undefined
          ? []
          : [log.metrics.parseDurationMs],
      ),
    ),
    throughputMiBPerSecond: summarizeMetric(
      taskLogs.flatMap((log) =>
        log.metrics.throughputMiBPerSecond === undefined
          ? []
          : [log.metrics.throughputMiBPerSecond],
      ),
    ),
    maxLongestMainThreadBlockMs:
      longestBlocks.length === 0 ? null : Math.max(...longestBlocks),
    maxTotalBlockingTimeMs:
      blockingTimes.length === 0 ? null : Math.max(...blockingTimes),
    warnings,
  };
}

export class LoggerService {
  private snapshot: readonly ResearchRunLog[] = EMPTY_LOGS;
  private readonly listeners = new Set<Listener>();
  private hydratePromise: Promise<void> | null = null;
  private currentFileId: ResearchFileId | null = null;

  readonly getSnapshot = (): readonly ResearchRunLog[] => this.snapshot;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hydrate(): Promise<readonly ResearchRunLog[]> {
    this.hydratePromise ??= loadResearchLogs().then((logs) => {
      this.publish(logs.toSorted(compareLogs));
    });
    return this.hydratePromise.then(() => this.snapshot);
  }

  setupFile(file: ResearchFile | ResearchFileId | 1 | 10 | 100): ResearchFile {
    const resolved = findResearchFile(
      file,
      researchStateService.getSnapshot().plan,
    );
    this.currentFileId = resolved.id;
    return resolved;
  }

  async log(
    input: ResearchRunLogInput,
    nextState: ResearchState,
  ): Promise<ResearchRunLog> {
    await Promise.all([this.hydrate(), researchStateService.hydrate()]);
    const currentState = researchStateService.getSnapshot();
    const currentTask = getCurrentTask(currentState);

    if (
      currentState.status !== 'running' ||
      currentState.phase !== 'measured' ||
      currentTask?.id !== input.task.id ||
      currentState.runIndex !== input.runIndex
    ) {
      throw new Error('Only the current measured run can be logged');
    }
    if (this.currentFileId && this.currentFileId !== input.task.file.id) {
      throw new Error(`Logger is set up for ${this.currentFileId}`);
    }

    const expectedNextState = advanceAfterMeasurement(currentState).state;
    if (
      nextState.sessionId !== currentState.sessionId ||
      nextState.status !== expectedNextState.status ||
      nextState.taskIndex !== expectedNextState.taskIndex ||
      nextState.phase !== expectedNextState.phase ||
      nextState.runIndex !== expectedNextState.runIndex
    ) {
      throw new Error('nextState must advance exactly one measured run');
    }

    const log = createRunLog(input, currentState);
    await researchStateService.commit(nextState, (committedState) =>
      commitMeasuredLogAndState(log, committedState),
    );
    this.upsert(log);
    return log;
  }

  getLogs(
    file?: ResearchFile | ResearchFileId | 1 | 10 | 100,
    sessionId?: string | null,
  ): readonly ResearchRunLog[] {
    if (file === undefined && sessionId === undefined) return this.snapshot;
    const fileId = file === undefined ? null : findResearchFile(file).id;
    return this.snapshot.filter(
      (log) =>
        (fileId === null || log.task.file.id === fileId) &&
        (sessionId === undefined || log.sessionId === sessionId),
    );
  }

  calculate(
    file: ResearchFile | ResearchFileId | 1 | 10 | 100,
    sessionId = researchStateService.getSnapshot().sessionId,
  ): ResearchSummary {
    const state = researchStateService.getSnapshot();
    const resolvedFile = findResearchFile(file, state.plan);
    const tasks = state.plan.tasks.filter(
      (task) => task.file.id === resolvedFile.id,
    );
    const logs = this.getLogs(resolvedFile, sessionId);
    const taskSummaries = tasks.map((task) =>
      taskSummary(task, logs, state.plan.measuredRuns),
    );
    const measuredRuns = taskSummaries.reduce(
      (total, summary) => total + summary.measuredRuns,
      0,
    );
    const completedTasks = taskSummaries.filter(
      (summary) => summary.complete,
    ).length;
    const warnings = taskSummaries.flatMap((summary) =>
      summary.warnings.map((warning) => `${summary.task.id}: ${warning}`),
    );
    const rowCounts = new Set(
      logs.flatMap((log) =>
        log.metrics.rowCount === undefined ? [] : [log.metrics.rowCount],
      ),
    );
    const columnCounts = new Set(
      logs.flatMap((log) =>
        log.metrics.columnCount === undefined ? [] : [log.metrics.columnCount],
      ),
    );
    const fileSizes = new Set(logs.map((log) => log.fileSizeBytes));
    if (rowCounts.size > 1) warnings.push('Row count differs across setups');
    if (columnCounts.size > 1) {
      warnings.push('Column count differs across setups');
    }
    if (
      fileSizes.size > 1 ||
      (fileSizes.size === 1 && !fileSizes.has(resolvedFile.sizeBytes))
    ) {
      warnings.push('File size differs from the research fixture');
    }
    if (logs.some((log) => !log.env.crossOriginIsolated)) {
      warnings.push('A run was recorded without cross-origin isolation');
    }
    const longestBlocks = logs.map(
      (log) => log.metrics.longestMainThreadBlockMs,
    );
    const blockingTimes = logs.map((log) => log.metrics.totalBlockingTimeMs);

    return {
      file: resolvedFile,
      expectedTasks: tasks.length,
      completedTasks,
      expectedRuns: tasks.length * state.plan.measuredRuns,
      measuredRuns,
      complete: completedTasks === tasks.length,
      tasks: taskSummaries,
      maxLongestMainThreadBlockMs:
        longestBlocks.length === 0 ? null : Math.max(...longestBlocks),
      maxTotalBlockingTimeMs:
        blockingTimes.length === 0 ? null : Math.max(...blockingTimes),
      warnings,
    };
  }

  calculateAll(
    sessionId = researchStateService.getSnapshot().sessionId,
  ): readonly ResearchSummary[] {
    return researchStateService
      .getSnapshot()
      .plan.files.map((file) => this.calculate(file, sessionId));
  }

  exportData(): ResearchExport {
    const state = researchStateService.getSnapshot();
    const logs = this.getLogs(undefined, state.sessionId);
    return {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      state,
      logs,
      summaries: this.calculateAll(state.sessionId),
    };
  }

  async reset(): Promise<void> {
    await this.hydrate();
    await clearResearchLogs();
    this.currentFileId = null;
    this.publish(EMPTY_LOGS);
  }

  async resetAll(): Promise<ResearchState> {
    await this.hydrate();
    const state = await researchStateService.reset(researchPlan, async () =>
      clearResearchData(),
    );
    this.currentFileId = null;
    this.publish(EMPTY_LOGS);
    return state;
  }

  private upsert(log: ResearchRunLog) {
    const logs = this.snapshot.filter((candidate) => candidate.id !== log.id);
    logs.push(log);
    this.publish(logs.toSorted(compareLogs));
  }

  private publish(logs: readonly ResearchRunLog[]) {
    if (this.snapshot === logs) return;
    this.snapshot = logs;
    for (const listener of this.listeners) listener();
  }
}

export const loggerService = new LoggerService();
