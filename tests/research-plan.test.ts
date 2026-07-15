import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESEARCH_CHUNKS_PER_WORKER,
  RESEARCH_FILES,
  RESEARCH_TRANSFER_TYPES,
  RESEARCH_WORKER_COUNTS,
  advanceAfterMeasurement,
  createInitialResearchState,
  createResearchPlan,
  resolveChunksPerWorker,
} from '../src/lib/research/plan.ts';
import {
  ResearchStateService,
  isValidStoredResearchState,
} from '../src/lib/research/state-service.ts';
import {
  clearResearchState,
  saveResearchState,
} from '../src/lib/research/storage.ts';
import type { ResearchState } from '../src/lib/research/types.ts';

test('uses every parser-worker count and caps chunks by file size', () => {
  assert.deepEqual(RESEARCH_WORKER_COUNTS, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.ok(RESEARCH_WORKER_COUNTS.every(Number.isInteger));
  assert.deepEqual(RESEARCH_CHUNKS_PER_WORKER, [1, 2, 4, 8, 16]);
  assert.deepEqual(
    RESEARCH_FILES.map((file) => resolveChunksPerWorker(file)),
    [[1], [1, 2, 4], [1, 2, 4, 8, 16]],
  );
});

test('creates the complete deterministic matrix', () => {
  const plan = createResearchPlan();
  const tasksPerFile = plan.files.map(
    (file) => plan.tasks.filter((task) => task.file.id === file.id).length,
  );

  assert.deepEqual(tasksPerFile, [28, 82, 136]);
  assert.equal(plan.tasks.length, 246);
  assert.equal(
    plan.tasks.length * (plan.warmupRuns + plan.measuredRuns),
    5_658,
  );
  assert.equal(new Set(plan.tasks.map((task) => task.id)).size, 246);
  assert.equal(plan.version, 3);
  assert.equal(plan.orderStrategy, 'deterministic-main-workers-ascending');
  assert.deepEqual(plan.workerCounts, RESEARCH_WORKER_COUNTS);
  assert.deepEqual(
    plan.tasks.map((task) => task.taskIndex),
    Array.from({ length: 246 }, (_, index) => index),
  );

  for (const task of plan.tasks) {
    if (task.approach === 'main-thread') continue;
    assert.ok(task.chunksPerWorker <= task.file.maxChunksPerWorker);
    assert.ok(RESEARCH_CHUNKS_PER_WORKER.includes(task.chunksPerWorker));
  }
});

test('orders each file by main, workers, chunks, then transfer', () => {
  const plan = createResearchPlan();

  for (const file of plan.files) {
    const fileTasks = plan.tasks.filter((task) => task.file.id === file.id);
    assert.equal(fileTasks[0]?.approach, 'main-thread');

    const actual = fileTasks.slice(1).map((task) => {
      assert.equal(task.approach, 'workers');
      if (task.approach !== 'workers') throw new Error('Expected worker task');
      return [task.workerCount, task.chunksPerWorker, task.transferType];
    });
    const expected = RESEARCH_WORKER_COUNTS.flatMap((workerCount) =>
      resolveChunksPerWorker(file).flatMap((chunksPerWorker) =>
        RESEARCH_TRANSFER_TYPES.map((transferType) => [
          workerCount,
          chunksPerWorker,
          transferType,
        ]),
      ),
    );

    assert.deepEqual(actual, expected);
  }
});

test('reload preserves the next task in deterministic order', async (t) => {
  await clearResearchState();
  t.after(clearResearchState);

  const plan = createResearchPlan();
  const completedTaskIndex = 27;
  const runningState: ResearchState = {
    ...createInitialResearchState(plan),
    sessionId: 'test-session',
    status: 'running',
    taskIndex: completedTaskIndex,
    phase: 'measured',
    runIndex: plan.measuredRuns - 1,
  };
  const nextState = advanceAfterMeasurement(runningState).state;
  await saveResearchState(nextState);

  const reloaded = await new ResearchStateService().refresh();
  const expectedTask = plan.tasks[completedTaskIndex + 1];

  assert.equal(reloaded.taskIndex, completedTaskIndex + 1);
  assert.equal(reloaded.plan.tasks[reloaded.taskIndex]?.id, expectedTask.id);
  assert.equal(
    reloaded.plan.tasks[reloaded.taskIndex]?.approach,
    'main-thread',
  );
});

test('accepts the ordered schema and rejects shuffled legacy state', () => {
  const current = createInitialResearchState(createResearchPlan());
  assert.equal(isValidStoredResearchState(current), true);

  const shuffledCurrent: ResearchState = {
    ...structuredClone(current),
    plan: {
      ...structuredClone(current.plan),
      tasks: [...current.plan.tasks].reverse(),
    },
  };
  assert.equal(isValidStoredResearchState(shuffledCurrent), false);

  const legacy = structuredClone(current) as unknown as {
    version: number;
    plan: {
      version: number;
      orderSeed: number;
      orderStrategy: string;
      tasks: unknown[];
    };
  };
  legacy.version = 2;
  legacy.plan.version = 2;
  legacy.plan.orderSeed = 123;
  legacy.plan.orderStrategy = 'seeded-random-within-file';
  legacy.plan.tasks.reverse();

  assert.equal(
    isValidStoredResearchState(legacy as unknown as ResearchState),
    false,
  );
});
