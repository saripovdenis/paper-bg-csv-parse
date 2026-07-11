import {
  type ComponentProps,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Check,
  ChevronDown,
  Circle,
  CircleAlert,
  Download,
  Info,
  Play,
  RotateCcw,
  Square,
} from 'lucide-react';

import largeCsvUrl from '../../assets/03-large-100mib.csv?url';
import mediumCsvUrl from '../../assets/02-medium-10mib.csv?url';
import smallCsvUrl from '../../assets/01-small-1mib.csv?url';
import { Spokes } from '@/components/loading-ui/spokes';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  deriveResearchProgress,
  loggerService,
  probeResearchPersistence,
  researchRunnerService,
  researchStateService,
  type ResearchFile,
  type ResearchFileId,
  type ResearchProgress,
  type ResearchRunnerSnapshot,
  type ResearchRunnerStage,
  type ResearchState,
  type ResearchTask,
} from '@/lib/research';
import { cn } from '@/lib/utils';

type Language = 'en' | 'ru';
type TaskStatus = 'done' | 'running' | 'paused' | 'next';

const MIN_HYDRATION_MS = 200;

const assetUrls: Record<ResearchFileId, string> = {
  '1-mib': smallCsvUrl,
  '10-mib': mediumCsvUrl,
  '100-mib': largeCsvUrl,
};

const fileCache = new Map<ResearchFileId, Promise<File>>();

function Skeleton({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block animate-[dashboard-skeleton-pulse_800ms_cubic-bezier(0.4,0,0.6,1)_infinite] rounded bg-neutral-200 motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  );
}

async function loadResearchFile(file: ResearchFile, signal: AbortSignal) {
  let promise = fileCache.get(file.id);
  if (!promise) {
    const pending = fetch(assetUrls[file.id]).then(async (response) => {
      if (!response.ok) throw new Error(`Failed to load ${file.name}`);
      return new File([await response.blob()], file.name, {
        type: 'text/csv',
        lastModified: 0,
      });
    });
    fileCache.set(file.id, pending);
    void pending.catch(() => {
      if (fileCache.get(file.id) === pending) fileCache.delete(file.id);
    });
    promise = pending;
  }

  if (signal.aborted) throw new DOMException('Research stopped', 'AbortError');
  return new Promise<File>((resolve, reject) => {
    const onAbort = () =>
      reject(new DOMException('Research stopped', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

const copy = {
  en: {
    browser: 'Browser',
    chip: 'Chip',
    completed: 'complete',
    configured: 'configured',
    configurations: 'configurations',
    confirmReset: 'Clear research state and every saved log?',
    confirmRerun: 'Replace the completed research and its saved logs?',
    crossOrigin: 'Cross-origin isolated',
    displayRefresh: 'Display refresh rate',
    done: 'Done',
    downloadFile: 'Download',
    englishLanguage: 'English',
    environment: 'Env',
    experimentProgress: 'Experiment progress',
    export: 'Export JSON',
    exportShort: 'Export',
    files: 'Files',
    inProgress: 'In progress',
    languageLabel: 'Switch language',
    loading: 'Loading',
    mainThread: 'Main thread',
    maxThreads: 'Logical processors',
    measuredRunsHelp: 'Fixed recorded iterations per configuration.',
    measuredRuns: 'Measured runs',
    memory: 'RAM',
    next: 'Next',
    no: 'No',
    operatingSystem: 'OS',
    paused: 'Paused',
    queued: 'Queued',
    ready: 'Ready',
    reset: 'Reset',
    requirements: 'Required browser capabilities are unavailable.',
    resume: 'Resume',
    rows: 'rows',
    runAgain: 'Run again',
    russianLanguage: 'Russian',
    running: 'Running',
    settings: 'Experiment settings',
    start: 'Start',
    stop: 'Stop',
    stopping: 'Stopping',
    taskQueue: 'Tasks',
    uiHeartbeat: 'UI heartbeat',
    unavailable: 'Unavailable',
    warmupRunsHelp: 'Fixed warm-up iterations before measurements.',
    warmupRuns: 'Warm-up runs',
    yes: 'Yes',
  },
  ru: {
    browser: 'Браузер',
    chip: 'Чип',
    completed: 'завершено',
    configured: 'настроено',
    configurations: 'конфигураций',
    confirmReset: 'Удалить состояние исследования и все логи?',
    confirmRerun: 'Заменить завершённое исследование и его логи?',
    crossOrigin: 'Cross-origin isolation',
    displayRefresh: 'Частота экрана',
    done: 'Готово',
    downloadFile: 'Скачать',
    englishLanguage: 'Английский',
    environment: 'Среда',
    experimentProgress: 'Прогресс эксперимента',
    export: 'Экспорт JSON',
    exportShort: 'Экспорт',
    files: 'Файлы',
    inProgress: 'Выполняется',
    languageLabel: 'Переключить язык',
    loading: 'Загрузка',
    mainThread: 'Основной поток',
    maxThreads: 'Логические потоки',
    measuredRunsHelp: 'Фиксированное число замеров на конфигурацию.',
    measuredRuns: 'Замеры',
    memory: 'ОЗУ',
    next: 'Далее',
    no: 'Нет',
    operatingSystem: 'ОС',
    paused: 'Приостановлено',
    queued: 'В очереди',
    ready: 'Готово',
    reset: 'Сбросить',
    requirements: 'Требуемые возможности браузера недоступны.',
    resume: 'Продолжить',
    rows: 'строк',
    runAgain: 'Запустить снова',
    russianLanguage: 'Русский',
    running: 'Выполняется',
    settings: 'Настройки эксперимента',
    start: 'Начать',
    stop: 'Стоп',
    stopping: 'Остановка',
    taskQueue: 'Задачи',
    uiHeartbeat: 'Пульс UI',
    unavailable: 'Недоступно',
    warmupRunsHelp: 'Фиксированное число прогревов до замеров.',
    warmupRuns: 'Прогревочные запуски',
    yes: 'Да',
  },
} as const;

const stageLabels: Record<
  Language,
  Record<Exclude<ResearchRunnerStage, null>, string>
> = {
  en: {
    'loading-file': 'Loading file',
    prewarming: 'Prewarming pool',
    recovering: 'Recovery warm-up',
    'warming-up': 'Warm-up',
    measuring: 'Measuring',
    saving: 'Saving',
    reloading: 'Reloading',
  },
  ru: {
    'loading-file': 'Загрузка файла',
    prewarming: 'Прогрев пула',
    recovering: 'Повторный прогрев',
    'warming-up': 'Прогрев',
    measuring: 'Замер',
    saving: 'Сохранение',
    reloading: 'Перезагрузка',
  },
};

function formatTransfer(task: ResearchTask) {
  if (task.transferType === 'string') return 'String clone';
  if (task.transferType === 'array-buffer') return 'ArrayBuffer';
  if (task.transferType === 'shared-array-buffer') return 'SharedArrayBuffer';
  return '';
}

function formatWorkers(count: number, language: Language) {
  if (language === 'en')
    return `${count} ${count === 1 ? 'worker' : 'workers'}`;

  const lastTwo = count % 100;
  const last = count % 10;
  const noun =
    last === 1 && lastTwo !== 11
      ? 'воркер'
      : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)
        ? 'воркера'
        : 'воркеров';
  return `${count} ${noun}`;
}

function formatTask(task: ResearchTask, language: Language) {
  if (task.approach === 'main-thread') return copy[language].mainThread;
  return `${formatWorkers(task.workerCount, language)} · ${formatTransfer(task)} · ${task.chunksPerWorker}×W`;
}

function downloadResearchData() {
  const data = loggerService.exportData();
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `csv-research-${data.state.sessionId ?? 'empty'}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function NumberField({
  description,
  hydrated,
  label,
  value,
}: {
  description: string;
  hydrated: boolean;
  label: string;
  value: number;
}) {
  const inputId = useId();
  const helpId = useId();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <label
          htmlFor={inputId}
          className="min-w-0 text-xs font-medium text-neutral-500"
        >
          {label}
        </label>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={description}
              className="flex size-5 items-center justify-center rounded-full text-neutral-400 outline-none transition-colors duration-150 hover:text-neutral-700 focus-visible:bg-neutral-100 focus-visible:text-neutral-950"
            >
              <Info aria-hidden="true" className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-64 leading-4">
            {description}
          </TooltipContent>
        </Tooltip>
      </div>
      <output
        id={inputId}
        aria-describedby={helpId}
        aria-busy={!hydrated || undefined}
        className="flex h-8 w-14 cursor-default items-center justify-end justify-self-end rounded-lg bg-white px-2 text-right text-sm font-semibold tabular-nums text-neutral-950"
      >
        {hydrated ? value : <Skeleton className="h-3.5 w-5" />}
      </output>
      <span id={helpId} className="sr-only">
        {description}
      </span>
    </div>
  );
}

function FilesCard({
  files,
  language,
}: {
  files: readonly ResearchFile[];
  language: Language;
}) {
  const text = copy[language];
  const contentId = useId();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="rounded-xl bg-neutral-50 p-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={isOpen}
          aria-label={`${text.files}, ${files.length} ${text.configured}`}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left outline-none transition-transform duration-150 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-neutral-300"
          onClick={() => setIsOpen((open) => !open)}
        >
          <span
            role="heading"
            aria-level={2}
            className="min-w-0 flex-1 text-base font-semibold tracking-[-0.02em] text-neutral-950"
          >
            {text.files}
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 text-xs font-medium tabular-nums text-neutral-500"
          >
            {files.length}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-neutral-400 transition-transform duration-200 [transition-timing-function:cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none',
              isOpen && 'rotate-180',
            )}
          />
        </button>
      </div>

      <div
        id={contentId}
        hidden={!isOpen}
        className="mt-3 divide-y divide-neutral-200/80"
      >
        {files.map((file) => (
          <div
            key={file.name}
            className="flex min-w-0 items-center gap-2.5 py-2.5 first:pt-0 last:pb-0"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-neutral-900">
                {file.name}
              </span>
              <span className="mt-0.5 block text-[11px] tabular-nums text-neutral-500">
                {file.sizeMiB} MiB · {file.rowCount.toLocaleString(language)}{' '}
                {text.rows}
              </span>
            </span>
            <a
              href={assetUrls[file.id]}
              download={file.name}
              aria-label={`${text.downloadFile} ${file.name}`}
              title={`${text.downloadFile} ${file.name}`}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 outline-none transition-[background-color,color,transform] duration-150 hover:bg-neutral-100 hover:text-neutral-950 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-neutral-300"
            >
              <Download aria-hidden="true" className="size-4" />
            </a>
          </div>
        ))}
      </div>
    </section>
  );
}

function SettingsCard({
  hydrated,
  language,
  measuredRuns,
  warmupRuns,
}: {
  hydrated: boolean;
  language: Language;
  measuredRuns: number;
  warmupRuns: number;
}) {
  const text = copy[language];

  return (
    <section className="rounded-xl bg-neutral-50 p-5">
      <h2 className="text-base font-semibold tracking-[-0.02em] text-neutral-950">
        {text.settings}
      </h2>

      <TooltipProvider delayDuration={250}>
        <div className="mt-4 divide-y divide-neutral-200/80">
          <NumberField
            label={text.warmupRuns}
            description={text.warmupRunsHelp}
            hydrated={hydrated}
            value={warmupRuns}
          />
          <NumberField
            label={text.measuredRuns}
            description={text.measuredRunsHelp}
            hydrated={hydrated}
            value={measuredRuns}
          />
        </div>
      </TooltipProvider>
    </section>
  );
}

function EnvironmentCard({ language }: { language: Language }) {
  const text = copy[language];
  const browserNavigator = navigator as Navigator & {
    deviceMemory?: number;
    userAgentData?: {
      brands: readonly { brand: string; version: string }[];
      platform: string;
    };
  };
  const browserBrands = browserNavigator.userAgentData?.brands ?? [];
  const browserBrand =
    browserBrands.find(
      ({ brand }) => !brand.includes('Not') && brand !== 'Chromium',
    ) ?? browserBrands.find(({ brand }) => !brand.includes('Not'));
  const browser = browserBrand
    ? `${browserBrand.brand} ${browserBrand.version}`
    : browserNavigator.userAgent;
  const platform =
    browserNavigator.userAgentData?.platform ||
    browserNavigator.platform ||
    text.unavailable;
  const memory = browserNavigator.deviceMemory;
  const rows = [
    {
      label: text.crossOrigin,
      value: globalThis.crossOriginIsolated ? text.yes : text.no,
    },
    {
      label: text.displayRefresh,
      value: text.unavailable,
    },
    { label: text.operatingSystem, value: platform },
    { label: text.browser, value: browser },
    { label: text.chip, value: text.unavailable },
    {
      label: text.memory,
      value:
        memory === undefined
          ? text.unavailable
          : `${memory} ${language === 'ru' ? 'ГБ' : 'GB'}`,
    },
    {
      label: text.maxThreads,
      value: browserNavigator.hardwareConcurrency
        ? String(browserNavigator.hardwareConcurrency)
        : text.unavailable,
    },
  ];

  return (
    <section className="rounded-xl bg-neutral-50 p-5">
      <h2 className="text-base font-semibold tracking-[-0.02em] text-neutral-950">
        {text.environment}
      </h2>

      <dl className="mt-4 divide-y divide-neutral-200/80">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-xs first:pt-0 last:pb-0"
          >
            <dt className="min-w-0 text-neutral-500">{row.label}</dt>
            <dd
              title={row.value}
              className="max-w-40 truncate text-right font-medium tabular-nums text-neutral-900"
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CurrentProgressCard({
  environmentReady,
  hasLogs,
  hydrated,
  hydrationError,
  language,
  onExport,
  onPrimary,
  onReset,
  progress,
  runner,
  state,
  stopPending,
}: {
  environmentReady: boolean;
  hasLogs: boolean;
  hydrated: boolean;
  hydrationError: string | null;
  language: Language;
  onExport: () => void;
  onPrimary: () => void;
  onReset: () => void;
  progress: ResearchProgress;
  runner: ResearchRunnerSnapshot;
  state: ResearchState;
  stopPending: boolean;
}) {
  const text = copy[language];
  const percentage = Math.floor(
    Math.min(1, Math.max(0, progress.fraction)) * 100,
  );
  const stopping = stopPending || (runner.active && state.status !== 'running');
  const paused =
    !stopping && state.status === 'idle' && state.sessionId !== null;
  const statusLabel = !hydrated
    ? text.loading
    : stopping
      ? text.stopping
      : runner.stage
        ? stageLabels[language][runner.stage]
        : state.status === 'running'
          ? text.running
          : state.status === 'done'
            ? text.done
            : state.sessionId
              ? text.paused
              : text.ready;
  const primaryLabel =
    state.status === 'done'
      ? text.runAgain
      : state.sessionId
        ? text.resume
        : text.start;
  const error = runner.error ?? hydrationError;

  return (
    <section className="overflow-hidden rounded-xl bg-neutral-950 p-5 text-white sm:p-6">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 tabular-nums">
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-xs text-neutral-400 sm:text-sm">
              {text.experimentProgress}
            </span>
            <span
              role="status"
              title={
                runner.detail && !stopping
                  ? `${statusLabel} · ${runner.detail}`
                  : statusLabel
              }
              className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium text-neutral-200"
            >
              {statusLabel}
              {runner.detail && !stopping && (
                <>
                  <span className="hidden sm:inline"> · {runner.detail}</span>
                  <span className="sr-only sm:hidden">: {runner.detail}</span>
                </>
              )}
            </span>
          </span>
          <span className="flex h-4 w-9 items-center justify-end text-xs font-medium sm:text-sm">
            {hydrated ? (
              `${percentage}%`
            ) : (
              <Skeleton className="h-4 w-9 bg-white/15" />
            )}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={text.experimentProgress}
          aria-valuemin={hydrated ? 0 : undefined}
          aria-valuemax={hydrated ? progress.totalMeasuredRuns : undefined}
          aria-valuenow={hydrated ? progress.completedMeasuredRuns : undefined}
          aria-valuetext={hydrated ? `${percentage}%` : text.loading}
          className="h-2.5 overflow-hidden rounded-full bg-white/10"
        >
          {hydrated ? (
            <div
              className={cn(
                'h-full min-w-3 rounded-full transition-transform duration-200 [transform-origin:left] motion-reduce:transition-none',
                paused ? 'bg-yellow-500' : 'bg-emerald-400',
              )}
              style={{ transform: `scaleX(${progress.fraction})` }}
            />
          ) : (
            <Skeleton className="block h-full w-full rounded-full bg-white/15" />
          )}
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-0.5">
        <Button
          type="button"
          className="h-8 gap-1 rounded-lg bg-white pl-2 pr-2.5 text-xs text-neutral-950 transition-transform duration-150 hover:bg-neutral-200 active:scale-[0.97] sm:gap-1.5 sm:pr-3 [&_svg]:size-3.5"
          disabled={
            stopping ||
            (state.status === 'running'
              ? Boolean(runner.error) && !runner.active
              : !hydrated || !environmentReady)
          }
          aria-busy={!hydrated || stopping || undefined}
          onClick={onPrimary}
        >
          {!hydrated || stopping ? (
            <Spokes
              data-icon="inline-start"
              className="[--duration:700ms] motion-reduce:[animation:none]"
            />
          ) : state.status === 'running' ? (
            <Square data-icon="inline-start" className="fill-current" />
          ) : (
            <Play data-icon="inline-start" className="fill-current" />
          )}
          {stopping
            ? text.stopping
            : state.status === 'running'
              ? text.stop
              : primaryLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 gap-1 rounded-lg px-2 text-xs text-neutral-300 transition-transform duration-150 hover:bg-white/10 hover:text-white active:scale-[0.97] sm:gap-1.5 sm:px-2.5 [&_svg]:size-3.5"
          disabled={!hydrated || state.status === 'running' || runner.active}
          onClick={onReset}
        >
          <RotateCcw data-icon="inline-start" className="hidden sm:block" />
          {text.reset}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 gap-1 rounded-lg px-2 text-xs text-neutral-300 transition-transform duration-150 hover:bg-white/10 hover:text-white active:scale-[0.97] sm:gap-1.5 sm:px-2.5 [&_svg]:size-3.5"
          disabled={!hasLogs}
          onClick={onExport}
        >
          <Download data-icon="inline-start" className="hidden sm:block" />
          <span className="sm:hidden">{text.exportShort}</span>
          <span className="hidden sm:inline">{text.export}</span>
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200"
        >
          <CircleAlert className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {hydrated && !environmentReady && (
        <p className="mt-3 text-xs text-amber-300">{text.requirements}</p>
      )}
    </section>
  );
}

function TaskRow({
  label,
  language,
  status,
}: {
  label: string;
  language: Language;
  status: TaskStatus;
}) {
  const text = copy[language];
  const statusLabel =
    status === 'done'
      ? text.done
      : status === 'running'
        ? text.inProgress
        : status === 'paused'
          ? text.paused
          : text.next;

  return (
    <li
      aria-current={
        status === 'running' || status === 'paused' ? 'step' : undefined
      }
      className={cn(
        'flex min-h-11 items-center gap-3 px-1 py-1 sm:px-2',
        status === 'done' && 'text-neutral-500',
        status === 'next' && 'text-neutral-400',
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center">
        {status === 'done' ? (
          <Check aria-hidden="true" className="size-4 text-emerald-500" />
        ) : status === 'running' ? (
          <Spokes
            aria-hidden="true"
            className="size-4 text-yellow-500 [--duration:700ms] motion-reduce:[animation:none]"
          />
        ) : status === 'paused' ? (
          <Circle
            aria-hidden="true"
            className="size-3.5 fill-yellow-500/20 text-yellow-500"
          />
        ) : (
          <Circle aria-hidden="true" className="size-3.5 text-neutral-300" />
        )}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-sm sm:text-[15px]',
          status === 'running' || status === 'paused'
            ? 'font-semibold text-neutral-950'
            : 'font-medium',
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          'shrink-0 text-xs font-medium',
          status === 'done'
            ? 'text-emerald-600'
            : status === 'running' || status === 'paused'
              ? 'text-yellow-600'
              : 'text-neutral-400',
        )}
      >
        {statusLabel}
      </span>
    </li>
  );
}

function FileTaskSummary({
  complete,
  file,
  language,
  taskCount,
}: {
  complete: boolean;
  file: ResearchFile;
  language: Language;
  taskCount: number;
}) {
  const text = copy[language];

  return (
    <article className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-5">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-neutral-900">
          {file.name}
        </h3>
        <p className="mt-1 text-xs text-neutral-500">{file.sizeMiB} MiB</p>
      </div>
      <span
        className={cn(
          'flex shrink-0 items-center gap-1.5 text-sm font-medium',
          complete ? 'text-emerald-600' : 'text-neutral-500',
        )}
      >
        <span className="sr-only">
          {taskCount} {text.configurations},{' '}
        </span>
        <span
          aria-hidden="true"
          className="text-xs tabular-nums text-neutral-400"
        >
          {taskCount}
        </span>
        <span aria-hidden="true" className="text-neutral-300">
          ·
        </span>
        <span>{complete ? text.done : text.queued}</span>
      </span>
    </article>
  );
}

function TaskBoardSkeleton({ language }: { language: Language }) {
  const text = copy[language];

  return (
    <section
      aria-labelledby="file-progress-heading"
      aria-busy="true"
      className="rounded-xl bg-neutral-50 p-6 sm:p-8"
    >
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2
          id="file-progress-heading"
          className="text-xl font-semibold tracking-[-0.035em] text-neutral-950"
        >
          {text.taskQueue}
        </h2>
        <Skeleton className="h-4 w-16" />
      </div>

      <article aria-hidden="true">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <Skeleton className="h-4 w-44 max-w-[70%]" />
            <Skeleton className="mt-2 block h-3 w-12" />
          </div>
          <Skeleton className="h-3 w-24" />
        </div>

        <ol className="mt-5">
          {Array.from({ length: 5 }, (_, index) => (
            <li
              key={index}
              className="flex min-h-11 items-center gap-3 px-1 py-1 sm:px-2"
            >
              <span className="flex size-7 shrink-0 items-center justify-center">
                <Skeleton className="size-4 rounded-full" />
              </span>
              <Skeleton
                className={cn(
                  'h-4 max-w-[65%] flex-1',
                  index % 2 === 1 && 'max-w-[52%]',
                )}
              />
              <Skeleton className="h-3 w-14 shrink-0" />
            </li>
          ))}
          <li className="flex min-h-9 items-center px-1 sm:px-2">
            <Skeleton className="ml-10 h-3 w-24" />
          </li>
        </ol>
      </article>

      <div
        aria-hidden="true"
        className="mt-6 divide-y divide-neutral-200 border-t border-neutral-200"
      >
        {Array.from({ length: 2 }, (_, index) => (
          <div
            key={index}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-5"
          >
            <div className="min-w-0">
              <Skeleton className="h-4 w-40 max-w-[70%]" />
              <Skeleton className="mt-2 block h-3 w-12" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </section>
  );
}

function TaskBoard({
  hydrated,
  language,
  progress,
  runnerActive,
  state,
}: {
  hydrated: boolean;
  language: Language;
  progress: ResearchProgress;
  runnerActive: boolean;
  state: ResearchState;
}) {
  const text = copy[language];
  if (!hydrated) return <TaskBoardSkeleton language={language} />;

  const activeFile =
    state.plan.files[progress.fileIndex] ?? state.plan.files[0];
  if (!activeFile) return null;

  const tasksForFile = (file: ResearchFile) =>
    state.plan.tasks.filter((task) => task.file.id === file.id);
  const activeTasks = tasksForFile(activeFile);
  const currentTaskIndex =
    state.status === 'done'
      ? activeTasks.length - 1
      : activeTasks.findIndex((task) => task.taskIndex === state.taskIndex);
  const visibleTaskCount = 5;
  const windowStart = Math.min(
    Math.max(0, activeTasks.length - visibleTaskCount),
    Math.max(0, currentTaskIndex - 2),
  );
  const visibleTasks = activeTasks.slice(
    windowStart,
    windowStart + visibleTaskCount,
  );
  const remainingTaskCount = Math.max(
    0,
    activeTasks.length - (windowStart + visibleTasks.length),
  );
  const completedTaskCount =
    state.status === 'done' ? progress.taskCount : state.taskIndex;
  const completedActiveTasks = activeTasks.filter(
    (task) => state.status === 'done' || task.taskIndex < state.taskIndex,
  ).length;
  const completedFiles = state.plan.files.slice(0, progress.fileIndex);
  const queuedFiles = state.plan.files.slice(progress.fileIndex + 1);

  const getTaskStatus = (task: ResearchTask): TaskStatus => {
    if (state.status === 'done' || task.taskIndex < state.taskIndex) {
      return 'done';
    }
    if (task.taskIndex !== state.taskIndex) return 'next';
    if (state.status === 'running' || runnerActive) return 'running';
    return state.sessionId ? 'paused' : 'next';
  };

  return (
    <section
      aria-labelledby="file-progress-heading"
      className="rounded-xl bg-neutral-50 p-6 sm:p-8"
    >
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2
          id="file-progress-heading"
          className="text-xl font-semibold tracking-[-0.035em] text-neutral-950"
        >
          {text.taskQueue}
        </h2>
        <span className="text-sm tabular-nums text-neutral-500">
          {completedTaskCount} / {progress.taskCount}
        </span>
      </div>

      {completedFiles.length > 0 && (
        <div className="mb-6 divide-y divide-neutral-200 border-b border-neutral-200">
          {completedFiles.map((file) => (
            <FileTaskSummary
              key={file.id}
              complete
              file={file}
              language={language}
              taskCount={tasksForFile(file).length}
            />
          ))}
        </div>
      )}

      <article>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-neutral-900">
              {activeFile.name}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">
              {activeFile.sizeMiB} MiB
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500">
            {completedActiveTasks} / {activeTasks.length} {text.completed}
          </span>
        </div>

        <ol className="mt-5" aria-label={activeFile.name}>
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              label={formatTask(task, language)}
              language={language}
              status={getTaskStatus(task)}
            />
          ))}
          {remainingTaskCount > 0 && (
            <li className="flex min-h-9 items-center px-1 sm:px-2">
              <span className="ml-10 text-xs font-medium text-neutral-400">
                {language === 'ru'
                  ? `+ ещё ${remainingTaskCount} задач`
                  : `+ ${remainingTaskCount} more tasks`}
              </span>
            </li>
          )}
        </ol>
      </article>

      {queuedFiles.length > 0 && (
        <div className="mt-6 divide-y divide-neutral-200 border-t border-neutral-200">
          {queuedFiles.map((file) => (
            <FileTaskSummary
              key={file.id}
              complete={false}
              file={file}
              language={language}
              taskCount={tasksForFile(file).length}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function LanguagePicker({
  language,
  onChange,
}: {
  language: Language;
  onChange: (language: Language) => void;
}) {
  const text = copy[language];

  return (
    <fieldset className="relative grid h-8 w-[76px] grid-cols-2 rounded-full bg-neutral-950 p-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-neutral-400 ring-1 ring-black/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neutral-400 has-[:focus-visible]:ring-offset-2">
      <legend className="sr-only">{text.languageLabel}</legend>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-full bg-white transition-transform duration-200 [transition-timing-function:cubic-bezier(0.77,0,0.175,1)] motion-reduce:transition-none',
          language === 'ru' && 'translate-x-full',
        )}
      />
      <label className="relative z-10 flex cursor-pointer items-center justify-center transition-transform duration-150 active:scale-[0.96]">
        <input
          type="radio"
          name="language"
          value="en"
          checked={language === 'en'}
          aria-label={text.englishLanguage}
          className="sr-only"
          onChange={() => onChange('en')}
        />
        <span className={language === 'en' ? 'text-neutral-950' : undefined}>
          EN
        </span>
      </label>
      <label className="relative z-10 flex cursor-pointer items-center justify-center transition-transform duration-150 active:scale-[0.96]">
        <input
          type="radio"
          name="language"
          value="ru"
          checked={language === 'ru'}
          aria-label={text.russianLanguage}
          className="sr-only"
          onChange={() => onChange('ru')}
        />
        <span className={language === 'ru' ? 'text-neutral-950' : undefined}>
          RU
        </span>
      </label>
    </fieldset>
  );
}

function ResearchDashboard() {
  const [language, setLanguage] = useState<Language>('en');
  const [hydrated, setHydrated] = useState(false);
  const [persistentStorage, setPersistentStorage] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const state = useSyncExternalStore(
    researchStateService.subscribe,
    researchStateService.getSnapshot,
  );
  const logs = useSyncExternalStore(
    loggerService.subscribe,
    loggerService.getSnapshot,
  );
  const runner = useSyncExternalStore(
    researchRunnerService.subscribe,
    researchRunnerService.getSnapshot,
  );
  const text = copy[language];
  const progress = deriveResearchProgress(state);
  const environmentReady =
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('longtask') === true &&
    typeof navigator.locks !== 'undefined' &&
    persistentStorage;
  const hasLogs = logs.some((log) => log.sessionId === state.sessionId);

  useEffect(() => {
    let active = true;
    const minimumDelay = new Promise<void>((resolve) => {
      setTimeout(resolve, MIN_HYDRATION_MS);
    });

    void Promise.all([
      researchStateService.hydrate(),
      loggerService.hydrate(),
      probeResearchPersistence(),
    ])
      .then(([, , persistenceAvailable]) => {
        if (active) setPersistentStorage(persistenceAvailable);
      })
      .catch((error: unknown) => {
        if (active) {
          setHydrationError(
            error instanceof Error ? error.message : 'Persistence failed',
          );
        }
      })
      .finally(async () => {
        await minimumDelay;
        if (active) setHydrated(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated && environmentReady) {
      researchRunnerService.autoResume(loadResearchFile);
    }
  }, [environmentReady, hydrated, state.status]);

  const handlePrimary = async () => {
    if (state.status === 'running') {
      setStopPending(true);
      try {
        await researchRunnerService.stop();
      } finally {
        setStopPending(false);
      }
      return;
    }
    if (state.status === 'done' && !window.confirm(text.confirmRerun)) return;

    if (state.status === 'done' || !state.sessionId) {
      researchRunnerService.startNew(
        loadResearchFile,
        state.status === 'done' ? state.sessionId : null,
      );
      return;
    }
    researchRunnerService.resume(loadResearchFile);
  };

  const handleReset = () => {
    if (window.confirm(text.confirmReset)) {
      void researchRunnerService.reset();
    }
  };

  return (
    <main
      lang={language}
      className="relative min-h-svh bg-white px-4 pb-16 pt-20 sm:px-6 lg:px-8 lg:pb-24"
    >
      <div className="absolute right-4 top-5 flex items-center gap-2 sm:right-6 lg:right-8">
        <div
          role="status"
          className="flex h-8 items-center gap-2 rounded-full bg-neutral-950 px-3 text-[11px] font-medium text-neutral-200"
        >
          <Spokes
            aria-hidden="true"
            className="size-3.5 text-emerald-400 [--duration:900ms] motion-reduce:[animation:none]"
          />
          <span>{text.uiHeartbeat}</span>
        </div>
        <LanguagePicker language={language} onChange={setLanguage} />
      </div>

      <div className="mx-auto grid w-full max-w-[1400px] items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="order-2 space-y-3 lg:order-none lg:sticky lg:top-6">
          <EnvironmentCard language={language} />
          <FilesCard files={state.plan.files} language={language} />
          <SettingsCard
            hydrated={hydrated}
            language={language}
            measuredRuns={state.plan.measuredRuns}
            warmupRuns={state.plan.warmupRuns}
          />
        </aside>

        <div className="order-1 min-w-0 space-y-9 lg:order-none">
          <CurrentProgressCard
            environmentReady={environmentReady}
            hasLogs={hasLogs}
            hydrated={hydrated}
            hydrationError={hydrationError}
            language={language}
            onExport={downloadResearchData}
            onPrimary={handlePrimary}
            onReset={handleReset}
            progress={progress}
            runner={runner}
            state={state}
            stopPending={stopPending}
          />
          <TaskBoard
            hydrated={hydrated}
            language={language}
            progress={progress}
            runnerActive={runner.active || stopPending}
            state={state}
          />
        </div>
      </div>
    </main>
  );
}

export { ResearchDashboard };
