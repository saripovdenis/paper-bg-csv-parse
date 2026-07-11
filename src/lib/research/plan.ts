import type {
  MainThreadResearchTask,
  ResearchCursorTransition,
  ResearchFile,
  ResearchFileId,
  ResearchPlan,
  ResearchProgress,
  ResearchState,
  ResearchTask,
  ResearchTransferType,
  WorkerResearchTask,
} from './types';

export const RESEARCH_FILES = [
  {
    id: '1-mib',
    name: '01-small-1mib.csv',
    sizeMiB: 1,
    sizeBytes: 1_048_547,
    rowCount: 11_737,
    columnCount: 10,
    errorCount: 0,
  },
  {
    id: '10-mib',
    name: '02-medium-10mib.csv',
    sizeMiB: 10,
    sizeBytes: 10_485_752,
    rowCount: 115_989,
    columnCount: 10,
    errorCount: 0,
  },
  {
    id: '100-mib',
    name: '03-large-100mib.csv',
    sizeMiB: 100,
    sizeBytes: 104_857_514,
    rowCount: 1_147_213,
    columnCount: 10,
    errorCount: 0,
  },
] as const satisfies readonly ResearchFile[];

export const RESEARCH_TRANSFER_TYPES = [
  'string',
  'array-buffer',
  'shared-array-buffer',
] as const satisfies readonly ResearchTransferType[];

export const RESEARCH_CHUNKS_PER_WORKER = [1, 2, 4] as const;
export const RESEARCH_WARMUP_RUNS = 3;
export const RESEARCH_MEASURED_RUNS = 20;

function currentHardwareConcurrency() {
  if (typeof navigator === 'undefined') return 4;
  return navigator.hardwareConcurrency;
}

export function resolveWorkerCounts(
  hardwareConcurrency = currentHardwareConcurrency(),
): number[] {
  const cores = Number.isFinite(hardwareConcurrency)
    ? Math.max(1, Math.floor(hardwareConcurrency))
    : 4;

  return [...new Set([1, 2, 4, Math.max(1, cores - 1)])];
}

function mainThreadTask(
  file: ResearchFile,
  fileIndex: number,
  taskIndex: number,
): MainThreadResearchTask {
  return {
    id: `${file.id}__main-thread`,
    taskIndex,
    fileIndex,
    file,
    approach: 'main-thread',
    workerCount: null,
    transferType: null,
    chunksPerWorker: null,
  };
}

function workerTask(
  file: ResearchFile,
  fileIndex: number,
  taskIndex: number,
  workerCount: number,
  transferType: ResearchTransferType,
  chunksPerWorker: number,
): WorkerResearchTask {
  return {
    id: `${file.id}__workers-${workerCount}__${transferType}__chunks-${chunksPerWorker}`,
    taskIndex,
    fileIndex,
    file,
    approach: 'workers',
    workerCount,
    transferType,
    chunksPerWorker,
  };
}

export function createResearchPlan(
  hardwareConcurrency = currentHardwareConcurrency(),
): ResearchPlan {
  const workerCounts = resolveWorkerCounts(hardwareConcurrency);
  const tasks: ResearchTask[] = [];

  for (const [fileIndex, file] of RESEARCH_FILES.entries()) {
    tasks.push(mainThreadTask(file, fileIndex, tasks.length));

    for (const workerCount of workerCounts) {
      for (const transferType of RESEARCH_TRANSFER_TYPES) {
        for (const chunksPerWorker of RESEARCH_CHUNKS_PER_WORKER) {
          tasks.push(
            workerTask(
              file,
              fileIndex,
              tasks.length,
              workerCount,
              transferType,
              chunksPerWorker,
            ),
          );
        }
      }
    }
  }

  return {
    version: 1,
    files: RESEARCH_FILES,
    workerCounts,
    transferTypes: RESEARCH_TRANSFER_TYPES,
    chunksPerWorker: RESEARCH_CHUNKS_PER_WORKER,
    warmupRuns: RESEARCH_WARMUP_RUNS,
    measuredRuns: RESEARCH_MEASURED_RUNS,
    tasks,
  };
}

export const getResearchPlan = createResearchPlan;

export const researchPlan = createResearchPlan();

export function createInitialResearchState(
  plan: ResearchPlan = researchPlan,
): ResearchState {
  return {
    version: 1,
    sessionId: null,
    status: 'idle',
    plan,
    taskIndex: 0,
    phase: 'warmup',
    runIndex: 0,
    startedAt: null,
    updatedAt: null,
    completedAt: null,
  };
}

export function getCurrentTask(state: ResearchState): ResearchTask | null {
  if (state.status === 'done') return null;
  return state.plan.tasks[state.taskIndex] ?? null;
}

function noTransition(state: ResearchState): ResearchCursorTransition {
  const task = getCurrentTask(state);
  return {
    state,
    taskCompleted: false,
    fileCompleted: false,
    researchCompleted: state.status === 'done',
    previousTask: task,
    nextTask: task,
  };
}

export function advanceAfterWarmup(
  state: ResearchState,
): ResearchCursorTransition {
  if (state.status !== 'running' || state.phase !== 'warmup') {
    return noTransition(state);
  }

  const lastWarmup = state.runIndex + 1 >= state.plan.warmupRuns;
  const nextState: ResearchState = lastWarmup
    ? { ...state, phase: 'measured', runIndex: 0 }
    : { ...state, runIndex: state.runIndex + 1 };

  return {
    state: nextState,
    taskCompleted: false,
    fileCompleted: false,
    researchCompleted: false,
    previousTask: getCurrentTask(state),
    nextTask: getCurrentTask(nextState),
  };
}

export function advanceAfterMeasurement(
  state: ResearchState,
): ResearchCursorTransition {
  if (state.status !== 'running' || state.phase !== 'measured') {
    return noTransition(state);
  }

  if (state.runIndex + 1 < state.plan.measuredRuns) {
    const nextState = { ...state, runIndex: state.runIndex + 1 };
    return {
      state: nextState,
      taskCompleted: false,
      fileCompleted: false,
      researchCompleted: false,
      previousTask: getCurrentTask(state),
      nextTask: getCurrentTask(nextState),
    };
  }

  const previousTask = getCurrentTask(state);
  const nextTaskIndex = state.taskIndex + 1;
  const researchCompleted = nextTaskIndex >= state.plan.tasks.length;
  const nextState: ResearchState = researchCompleted
    ? {
        ...state,
        status: 'done',
        taskIndex: state.plan.tasks.length,
        runIndex: state.plan.measuredRuns,
      }
    : {
        ...state,
        taskIndex: nextTaskIndex,
        phase: 'warmup',
        runIndex: 0,
      };
  const nextTask = getCurrentTask(nextState);

  return {
    state: nextState,
    taskCompleted: true,
    fileCompleted:
      previousTask !== null &&
      (nextTask === null || nextTask.file.id !== previousTask.file.id),
    researchCompleted,
    previousTask,
    nextTask,
  };
}

export function deriveResearchProgress(state: ResearchState): ResearchProgress {
  const task = getCurrentTask(state);
  const done = state.status === 'done';
  const fileIndex = task?.fileIndex ?? Math.max(0, state.plan.files.length - 1);
  const fileTasks = state.plan.tasks.filter(
    (candidate) => candidate.fileIndex === fileIndex,
  );
  const fileTaskIndex = task
    ? fileTasks.findIndex((candidate) => candidate.id === task.id)
    : Math.max(0, fileTasks.length - 1);
  const completedMeasuredRuns = done
    ? state.plan.tasks.length * state.plan.measuredRuns
    : state.taskIndex * state.plan.measuredRuns +
      (state.phase === 'measured' ? state.runIndex : 0);
  const totalMeasuredRuns = state.plan.tasks.length * state.plan.measuredRuns;

  return {
    fileIndex,
    fileNumber: done ? state.plan.files.length : fileIndex + 1,
    fileCount: state.plan.files.length,
    taskIndex: state.taskIndex,
    taskNumber: done ? state.plan.tasks.length : state.taskIndex + 1,
    taskCount: state.plan.tasks.length,
    fileTaskNumber: done ? fileTasks.length : fileTaskIndex + 1,
    fileTaskCount: fileTasks.length,
    phase: state.phase,
    runIndex: state.runIndex,
    runNumber:
      state.phase === 'measured' && !done
        ? state.runIndex + 1
        : done
          ? state.plan.measuredRuns
          : 0,
    runCount: state.plan.measuredRuns,
    completedMeasuredRuns,
    totalMeasuredRuns,
    fraction:
      totalMeasuredRuns === 0 ? 1 : completedMeasuredRuns / totalMeasuredRuns,
  };
}

export function formatCurrentTask(task: ResearchTask | null): string {
  if (!task) return 'Research complete';
  if (task.approach === 'main-thread') {
    return `${task.file.sizeMiB} MiB · main thread`;
  }

  return `${task.file.sizeMiB} MiB · ${task.workerCount} workers · ${task.transferType} · ${task.chunksPerWorker} chunks/worker`;
}

export function findResearchFile(
  file: ResearchFile | ResearchFileId | 1 | 10 | 100,
  plan: ResearchPlan = researchPlan,
): ResearchFile {
  if (typeof file === 'object') return file;

  const match = plan.files.find((candidate) =>
    typeof file === 'number'
      ? candidate.sizeMiB === file
      : candidate.id === file,
  );
  if (!match) throw new Error(`Unknown research file: ${file}`);
  return match;
}
