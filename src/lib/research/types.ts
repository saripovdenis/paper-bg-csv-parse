export type ResearchStatus = 'idle' | 'running' | 'done';
export type ResearchPhase = 'warmup' | 'measured';
export type ResearchApproach = 'main-thread' | 'workers';
export type ResearchTransferType =
  | 'string'
  | 'array-buffer'
  | 'shared-array-buffer';
export type ResearchFileId = '1-mib' | '10-mib' | '100-mib';

export interface ResearchFile {
  id: ResearchFileId;
  name: string;
  sizeMiB: 1 | 10 | 100;
  sizeBytes: number;
  rowCount: number;
  columnCount: number;
  errorCount: 0;
}

interface ResearchTaskBase {
  id: string;
  taskIndex: number;
  fileIndex: number;
  file: ResearchFile;
  approach: ResearchApproach;
}

export interface MainThreadResearchTask extends ResearchTaskBase {
  approach: 'main-thread';
  workerCount: null;
  transferType: null;
  chunksPerWorker: null;
}

export interface WorkerResearchTask extends ResearchTaskBase {
  approach: 'workers';
  workerCount: number;
  transferType: ResearchTransferType;
  chunksPerWorker: number;
}

export type ResearchTask = MainThreadResearchTask | WorkerResearchTask;

export interface ResearchPlan {
  version: 1;
  files: readonly ResearchFile[];
  workerCounts: readonly number[];
  transferTypes: readonly ResearchTransferType[];
  chunksPerWorker: readonly number[];
  warmupRuns: number;
  measuredRuns: number;
  tasks: readonly ResearchTask[];
}

export interface ResearchState {
  version: 1;
  sessionId: string | null;
  status: ResearchStatus;
  plan: ResearchPlan;
  taskIndex: number;
  phase: ResearchPhase;
  runIndex: number;
  startedAt: string | null;
  updatedAt: string | null;
  completedAt: string | null;
}

export interface ResearchProgress {
  fileIndex: number;
  fileNumber: number;
  fileCount: number;
  taskIndex: number;
  taskNumber: number;
  taskCount: number;
  fileTaskNumber: number;
  fileTaskCount: number;
  phase: ResearchPhase;
  runIndex: number;
  runNumber: number;
  runCount: number;
  completedMeasuredRuns: number;
  totalMeasuredRuns: number;
  fraction: number;
}

export interface ResearchCursorTransition {
  state: ResearchState;
  taskCompleted: boolean;
  fileCompleted: boolean;
  researchCompleted: boolean;
  previousTask: ResearchTask | null;
  nextTask: ResearchTask | null;
}

export interface ResearchRunMetrics {
  durationMs: number;
  longestMainThreadBlockMs: number;
  totalBlockingTimeMs: number;
  longTaskCount: number;
  parseDurationMs?: number;
  frameUiFrozenMs?: number;
  throughputMiBPerSecond?: number;
  rowCount?: number;
  columnCount?: number;
  errorCount?: number;
  custom?: Readonly<Record<string, number>>;
}

export interface ResearchEnvironment {
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  userAgent: string;
}

export interface ResearchWorkerPoolLog {
  isPoolPrewarmed: boolean;
  workerPoolSize: number;
  chunksPerWorker: number;
  actualChunkCount: number;
  chunkSizesBytes: readonly number[];
  transferType: ResearchTransferType;
}

export interface ResearchRunLogInput {
  task: ResearchTask;
  runIndex: number;
  metrics: ResearchRunMetrics;
  sessionId?: string;
  fileName?: string;
  fileSizeBytes?: number;
  workerPool?: ResearchWorkerPoolLog | null;
  env?: ResearchEnvironment;
  measuredAt?: string;
}

export interface ResearchRunLog extends ResearchRunLogInput {
  id: string;
  sessionId: string;
  fileName: string;
  fileSizeBytes: number;
  workerPool: ResearchWorkerPoolLog | null;
  env: ResearchEnvironment;
  measuredAt: string;
}

export interface MetricSummary {
  count: number;
  min: number | null;
  median: number | null;
  p10: number | null;
  p90: number | null;
  max: number | null;
  relativeSpread: number | null;
}

export interface ResearchTaskSummary {
  task: ResearchTask;
  expectedRuns: number;
  measuredRuns: number;
  complete: boolean;
  durationMs: MetricSummary;
  longestMainThreadBlockMs: MetricSummary;
  totalBlockingTimeMs: MetricSummary;
  parseDurationMs: MetricSummary;
  throughputMiBPerSecond: MetricSummary;
  maxLongestMainThreadBlockMs: number | null;
  maxTotalBlockingTimeMs: number | null;
  warnings: readonly string[];
}

export interface ResearchSummary {
  file: ResearchFile;
  expectedTasks: number;
  completedTasks: number;
  expectedRuns: number;
  measuredRuns: number;
  complete: boolean;
  tasks: readonly ResearchTaskSummary[];
  maxLongestMainThreadBlockMs: number | null;
  maxTotalBlockingTimeMs: number | null;
  warnings: readonly string[];
}

export interface ResearchExport {
  schemaVersion: 1;
  exportedAt: string;
  state: ResearchState;
  logs: readonly ResearchRunLog[];
  summaries: readonly ResearchSummary[];
}

export type ResearchStateUpdater =
  | Partial<ResearchState>
  | ((state: ResearchState) => ResearchState);
