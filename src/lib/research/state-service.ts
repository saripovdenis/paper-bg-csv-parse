import {
  createInitialResearchState,
  deriveResearchProgress,
  getCurrentTask,
  researchPlan,
} from './plan';
import { loadResearchState, saveResearchState } from './storage';
import type {
  ResearchPlan,
  ResearchProgress,
  ResearchState,
  ResearchStateUpdater,
  ResearchTask,
} from './types';

type Listener = () => void;
type StateWriter = (state: ResearchState) => Promise<void>;

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function validStoredState(value: ResearchState | null): value is ResearchState {
  if (!value || value.version !== 1 || value.plan?.version !== 1) return false;
  if (
    !Array.isArray(value.plan.files) ||
    !value.plan.files.every(
      (file) =>
        Number.isInteger(file.sizeBytes) &&
        Number.isInteger(file.rowCount) &&
        Number.isInteger(file.columnCount) &&
        file.errorCount === 0,
    )
  ) {
    return false;
  }
  if (!['idle', 'running', 'done'].includes(value.status)) return false;
  if (!['warmup', 'measured'].includes(value.phase)) return false;
  if (!Number.isInteger(value.taskIndex) || !Number.isInteger(value.runIndex)) {
    return false;
  }

  if (value.status === 'done') {
    return (
      value.taskIndex === value.plan.tasks.length &&
      value.phase === 'measured' &&
      value.runIndex === value.plan.measuredRuns
    );
  }

  const runCount =
    value.phase === 'warmup' ? value.plan.warmupRuns : value.plan.measuredRuns;
  return (
    value.taskIndex >= 0 &&
    value.taskIndex < value.plan.tasks.length &&
    value.runIndex >= 0 &&
    value.runIndex < runCount
  );
}

function stampState(state: ResearchState): ResearchState {
  const now = new Date().toISOString();
  return {
    ...state,
    sessionId:
      state.status === 'idle'
        ? state.sessionId
        : (state.sessionId ?? createSessionId()),
    startedAt:
      state.status === 'idle' ? state.startedAt : (state.startedAt ?? now),
    updatedAt: now,
    completedAt: state.status === 'done' ? (state.completedAt ?? now) : null,
  };
}

export class ResearchStateService {
  private snapshot: ResearchState = createInitialResearchState();
  private readonly listeners = new Set<Listener>();
  private hydratePromise: Promise<void> | null = null;
  private mutationQueue: Promise<void> = Promise.resolve();

  readonly getSnapshot = (): ResearchState => this.snapshot;
  readonly getCurrentTask = (): ResearchTask | null =>
    getCurrentTask(this.snapshot);
  readonly getProgress = (): ResearchProgress =>
    deriveResearchProgress(this.snapshot);

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  hydrate(): Promise<ResearchState> {
    this.hydratePromise ??= loadResearchState().then((storedState) => {
      if (validStoredState(storedState)) this.publish(storedState);
    });
    return this.hydratePromise.then(() => this.snapshot);
  }

  refresh(): Promise<ResearchState> {
    return this.enqueue(async () => {
      const storedState = await loadResearchState();
      const state = validStoredState(storedState)
        ? storedState
        : createInitialResearchState(researchPlan);
      this.publish(state);
      return state;
    });
  }

  async start(plan: ResearchPlan = researchPlan): Promise<ResearchState> {
    await this.hydrate();
    return this.enqueue(async () => {
      if (this.snapshot.status === 'running') return this.snapshot;

      const now = new Date().toISOString();
      const state: ResearchState = {
        ...createInitialResearchState(plan),
        sessionId: createSessionId(),
        status: 'running',
        startedAt: now,
        updatedAt: now,
      };
      await saveResearchState(state);
      this.publish(state);
      return state;
    });
  }

  async update(update: ResearchStateUpdater): Promise<ResearchState> {
    await this.hydrate();
    return this.enqueue(async () => {
      const candidate =
        typeof update === 'function'
          ? update(this.snapshot)
          : { ...this.snapshot, ...update };
      const committed = stampState(candidate);
      await saveResearchState(committed);
      this.publish(committed);
      return committed;
    });
  }

  async commit(
    state: ResearchState,
    writer: StateWriter = saveResearchState,
  ): Promise<ResearchState> {
    await this.hydrate();
    return this.enqueue(async () => {
      const committed = stampState(state);
      await writer(committed);
      this.publish(committed);
      return committed;
    });
  }

  async reset(
    plan: ResearchPlan = researchPlan,
    writer: StateWriter = saveResearchState,
  ): Promise<ResearchState> {
    await this.hydrate();
    const state = createInitialResearchState(plan);
    return this.enqueue(async () => {
      await writer(state);
      this.publish(state);
      return state;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private publish(state: ResearchState) {
    if (this.snapshot === state) return;
    this.snapshot = state;
    for (const listener of this.listeners) listener();
  }
}

export const researchStateService = new ResearchStateService();
