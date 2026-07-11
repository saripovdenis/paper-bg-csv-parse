import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  CircleAlert,
  Download,
  Play,
  RotateCcw,
  Square,
  UploadCloud,
} from 'lucide-react';

import largeCsvUrl from '../assets/03-large-100mib.csv?url';
import mediumCsvUrl from '../assets/02-medium-10mib.csv?url';
import smallCsvUrl from '../assets/01-small-1mib.csv?url';

import { Spokes } from '@/components/loading-ui/spokes';
import { Button } from '@/components/ui/button';
import {
  FileUpload,
  FileUploadDropzone,
  FileUploadItem,
  FileUploadItemDelete,
  FileUploadItemMetadata,
  FileUploadItemPreview,
  FileUploadList,
  FileUploadTrigger,
  useFileUpload,
} from '@/components/ui/file-upload';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { parseCsvFileInMainThread, parseCsvFileInWorker } from '@/lib/csv';
import {
  logParseStats,
  measureBrowserWork,
  type ParseMode,
} from '@/lib/measurements';
import {
  deriveResearchProgress,
  getCurrentTask,
  loggerService,
  probeResearchPersistence,
  researchRunnerService,
  researchStateService,
  type ResearchFile,
  type ResearchFileId,
  type ResearchRunnerStage,
  type ResearchTask,
} from '@/lib/research';

type Language = 'en' | 'ru';

const assetUrls: Record<ResearchFileId, string> = {
  '1-mib': smallCsvUrl,
  '10-mib': mediumCsvUrl,
  '100-mib': largeCsvUrl,
};

const fileCache = new Map<ResearchFileId, Promise<File>>();

async function loadResearchFile(file: ResearchFile, signal: AbortSignal) {
  let promise = fileCache.get(file.id);
  if (!promise) {
    promise = fetch(assetUrls[file.id]).then(async (response) => {
      if (!response.ok) throw new Error(`Failed to load ${file.name}`);
      return new File([await response.blob()], file.name, {
        type: 'text/csv',
        lastModified: 0,
      });
    });
    fileCache.set(file.id, promise);
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
    browse: 'Browse files',
    clear: 'Clear',
    configuration: 'Configuration',
    confirmClear: 'Clear research state and every saved log?',
    confirmRerun: 'Replace the completed research and its saved logs?',
    constraint: 'Up to 3 files, 100MB each',
    currentTask: 'Current task',
    drop: 'Drag & drop files here',
    export: 'Export JSON',
    file: 'File',
    mainThread: 'Main Thread Parsing',
    measuredRuns: 'Measured runs',
    overall: 'Overall',
    remove: 'Remove',
    requirements: 'Required browser capabilities are unavailable.',
    responsiveness: 'Interface responsiveness marker',
    resume: 'Resume',
    runAgain: 'Run again',
    start: 'Start research',
    stop: 'Stop',
    switchMainThread: 'Switch to Main Thread',
    switchWorker: 'Switch to Worker',
    uiHeartbeat: 'UI heartbeat',
    uploadLabel: 'File upload',
    warmup: 'Warm-up',
    worker: 'Worker Based Parsing',
  },
  ru: {
    browse: 'Выбрать файлы',
    clear: 'Сбросить',
    configuration: 'Конфигурация',
    confirmClear: 'Удалить состояние исследования и все логи?',
    confirmRerun: 'Заменить завершённое исследование и его логи?',
    constraint: 'До 3 файлов, 100 МБ каждый',
    currentTask: 'Текущая задача',
    drop: 'Перетащите файлы сюда',
    export: 'Экспорт JSON',
    file: 'Файл',
    mainThread: 'Чтение в основном потоке',
    measuredRuns: 'Замеры',
    overall: 'Всего',
    remove: 'Удалить',
    requirements: 'Требуемые возможности браузера недоступны.',
    responsiveness: 'Маркер отклика интерфейса',
    resume: 'Продолжить',
    runAgain: 'Запустить снова',
    start: 'Начать',
    stop: 'Стоп',
    switchMainThread: 'Переключить на основной поток',
    switchWorker: 'Переключить на Worker',
    uiHeartbeat: 'Отклик UI',
    uploadLabel: 'Загрузка файла',
    warmup: 'Прогрев',
    worker: 'Чтение через Worker',
  },
} satisfies Record<Language, Record<string, string>>;

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

function formatTransfer(value: ResearchTask['transferType']) {
  if (value === 'string') return 'Clone';
  if (value === 'array-buffer') return 'ArrayBuffer';
  if (value === 'shared-array-buffer') return 'SharedArrayBuffer';
  return '';
}

function formatTask(task: ResearchTask | null) {
  if (!task) return 'Research complete';
  const prefix = `${task.file.sizeMiB} MiB · `;
  if (task.approach === 'main-thread') return `${prefix}Main thread`;
  return `${prefix}${task.workerCount}w · ${formatTransfer(task.transferType)} · ${task.chunksPerWorker}×/w`;
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      className="h-2 overflow-hidden rounded-full bg-white/10"
    >
      <div
        className="h-full rounded-full bg-emerald-400 transition-transform duration-200 [transform-origin:left]"
        style={{ transform: `scaleX(${Math.min(1, Math.max(0, value))})` }}
      />
    </div>
  );
}

function UploadedFiles({ removeLabel }: { removeLabel: string }) {
  const files = useFileUpload((state) => Array.from(state.files.keys()));

  return (
    <FileUploadList className="mx-auto mt-4 w-[420px] max-w-full">
      {files.map((file) => (
        <FileUploadItem
          key={`${file.name}-${file.lastModified}`}
          value={file}
          className="border-neutral-800 bg-neutral-950 text-neutral-100"
        >
          <FileUploadItemPreview className="border-neutral-800 bg-neutral-900 text-neutral-400" />
          <FileUploadItemMetadata className="[&_[data-slot=file-upload-metadata]>span]:text-neutral-100" />
          <FileUploadItemDelete className="rounded-md px-2 text-xs text-neutral-500 hover:text-neutral-100">
            {removeLabel}
          </FileUploadItemDelete>
        </FileUploadItem>
      ))}
    </FileUploadList>
  );
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

function App() {
  const [language, setLanguage] = useState<Language>('ru');
  const [workerParsing, setWorkerParsing] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [persistentStorage, setPersistentStorage] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
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
  const task = getCurrentTask(state);
  const progress = deriveResearchProgress(state);
  const environmentReady =
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes.includes('longtask') &&
    typeof navigator.locks !== 'undefined' &&
    persistentStorage;

  useEffect(() => {
    let active = true;
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
      .finally(() => {
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

  const primaryLabel =
    state.status === 'done'
      ? text.runAgain
      : state.sessionId
        ? text.resume
        : text.start;
  const phaseLabel =
    state.phase === 'warmup'
      ? `${text.warmup} ${state.runIndex + 1}/${state.plan.warmupRuns}`
      : `${text.measuredRuns} ${state.runIndex}/${state.plan.measuredRuns}`;

  const startOrResume = async () => {
    if (state.status === 'done' && !window.confirm(text.confirmRerun)) return;

    if (state.status === 'done' || !state.sessionId) {
      await researchRunnerService.startNew(
        loadResearchFile,
        state.status === 'done' ? state.sessionId : null,
      );
    } else {
      await researchRunnerService.resume(loadResearchFile);
    }
  };

  return (
    <main className="relative min-h-svh bg-white p-6">
      <div className="absolute right-6 top-6 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        <span className={language === 'en' ? 'text-neutral-950' : undefined}>
          en
        </span>
        <Switch
          size="sm"
          checked={language === 'ru'}
          aria-label="Switch language"
          className="cursor-pointer data-checked:bg-neutral-950 data-unchecked:bg-neutral-300"
          onCheckedChange={(checked) => setLanguage(checked ? 'ru' : 'en')}
        />
        <span className={language === 'ru' ? 'text-neutral-950' : undefined}>
          ru
        </span>
      </div>

      <div className="mx-auto flex min-h-[calc(100svh-3rem)] w-full max-w-[760px] flex-col items-center justify-center gap-6 pt-12">
        <section className="w-full overflow-hidden rounded-2xl bg-neutral-950 p-5 text-white sm:p-7">
          <div className="flex items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-neutral-500">
                {text.currentTask}
              </p>
              <h2 className="mt-2 break-words text-xl font-medium tracking-[-0.025em] sm:text-2xl">
                {formatTask(task)}
              </h2>
              <p className="mt-2 text-xs text-neutral-400">
                {runner.stage
                  ? `${stageLabels[language][runner.stage]}${runner.detail ? ` · ${runner.detail}` : ''}`
                  : phaseLabel}
              </p>
            </div>
            <div className="flex size-20 shrink-0 flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-center">
              <Spokes
                aria-hidden="true"
                className="size-5 text-emerald-400 [--duration:700ms]"
              />
              <span className="text-[9px] font-medium uppercase tracking-[0.1em] text-neutral-500">
                {text.uiHeartbeat}
              </span>
            </div>
          </div>

          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between text-xs tabular-nums">
              <span className="text-neutral-400">{text.overall}</span>
              <span>
                {progress.completedMeasuredRuns.toLocaleString()} /{' '}
                {progress.totalMeasuredRuns.toLocaleString()}
              </span>
            </div>
            <ProgressBar value={progress.fraction} label={text.overall} />
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2 border-t border-white/10 pt-5 text-xs tabular-nums">
            <div>
              <p className="text-neutral-500">{text.file}</p>
              <p className="mt-1 font-medium">
                {progress.fileNumber} / {progress.fileCount}
              </p>
            </div>
            <div>
              <p className="text-neutral-500">{text.configuration}</p>
              <p className="mt-1 font-medium">
                {progress.fileTaskNumber} / {progress.fileTaskCount}
              </p>
            </div>
            <div>
              <p className="text-neutral-500">{text.measuredRuns}</p>
              <p className="mt-1 font-medium">
                {state.phase === 'measured' ? state.runIndex : 0} /{' '}
                {state.plan.measuredRuns}
              </p>
            </div>
          </div>

          {(runner.error || hydrationError) && (
            <div
              role="alert"
              className="mt-5 flex gap-2 rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-200"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" />{' '}
              {runner.error ?? hydrationError}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-2">
            {state.status === 'running' ? (
              <Button
                variant="outline"
                className="h-9 border-white/15 bg-white/5 px-4 text-white hover:bg-white/10 hover:text-white"
                disabled={Boolean(runner.error) && !runner.active}
                onClick={() => void researchRunnerService.stop()}
              >
                <Square data-icon="inline-start" className="fill-current" />{' '}
                {text.stop}
              </Button>
            ) : (
              <Button
                className="h-9 bg-white px-4 text-neutral-950 hover:bg-neutral-200"
                disabled={!hydrated || !environmentReady}
                onClick={() => void startOrResume()}
              >
                <Play data-icon="inline-start" className="fill-current" />{' '}
                {primaryLabel}
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-9 px-3 text-neutral-400 hover:bg-white/10 hover:text-white"
              disabled={state.status === 'running'}
              onClick={() => {
                if (window.confirm(text.confirmClear)) {
                  void researchRunnerService.reset();
                }
              }}
            >
              <RotateCcw data-icon="inline-start" /> {text.clear}
            </Button>
            <Button
              variant="ghost"
              className="h-9 px-3 text-neutral-400 hover:bg-white/10 hover:text-white"
              disabled={logs.every((log) => log.sessionId !== state.sessionId)}
              onClick={downloadResearchData}
            >
              <Download data-icon="inline-start" /> {text.export}
            </Button>
          </div>
          {!environmentReady && (
            <p className="mt-3 text-xs text-amber-300">{text.requirements}</p>
          )}
        </section>

        <div className="flex w-[420px] max-w-full flex-col items-center gap-3">
          <FileUpload
            accept=".csv,text/csv"
            label={text.uploadLabel}
            maxFiles={3}
            maxSize={100 * 1024 * 1024}
            multiple
            onUpload={async (files, { onError, onProgress, onSuccess }) => {
              const mode: ParseMode = workerParsing ? 'worker' : 'main-thread';
              const parseFile = workerParsing
                ? parseCsvFileInWorker
                : parseCsvFileInMainThread;

              await Promise.all(
                files.map(async (file) => {
                  try {
                    const measurement = await measureBrowserWork(() =>
                      parseFile(file),
                    );
                    logParseStats(mode, measurement);
                    onProgress(file, 100);
                    onSuccess(file);
                  } catch (error) {
                    onError(
                      file,
                      error instanceof Error
                        ? error
                        : new Error('CSV parsing failed'),
                    );
                  }
                }),
              );
            }}
            className="w-full rounded-xl border border-neutral-800 bg-neutral-950 p-3 subpixel-antialiased [font-family:ui-sans-serif,system-ui,sans-serif]"
          >
            <div
              data-parsing-mode
              className="mb-3 flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-500"
            >
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Switch
                      checked={workerParsing}
                      aria-label={text.worker}
                      className="cursor-pointer data-checked:bg-neutral-100 data-unchecked:bg-neutral-800 data-checked:[&_[data-slot=switch-thumb]]:bg-neutral-950 data-unchecked:[&_[data-slot=switch-thumb]]:bg-white"
                      onCheckedChange={setWorkerParsing}
                    />
                  </TooltipTrigger>
                  <TooltipContent>
                    {workerParsing ? text.switchMainThread : text.switchWorker}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <span className="block min-w-0 flex-1 truncate text-left font-medium text-neutral-100">
                {text.worker}
              </span>
            </div>

            <FileUploadDropzone className="h-[168px] w-full gap-2 border-neutral-800 bg-neutral-950 p-6 text-center hover:bg-neutral-950 data-dragging:border-neutral-500 data-dragging:bg-neutral-900">
              <div
                data-upload-icon
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-neutral-950 text-neutral-300"
              >
                <UploadCloud className="h-5 w-5 shrink-0" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold leading-5 text-neutral-100">
                  {text.drop}
                </p>
                <p className="text-xs font-medium leading-4 text-neutral-500">
                  {text.constraint}
                </p>
              </div>
              <FileUploadTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-2 h-8 cursor-pointer rounded-md border-neutral-800 bg-neutral-900 px-3 text-[13px] font-medium leading-none text-neutral-200 shadow-none hover:bg-neutral-800 hover:text-white"
                >
                  {text.browse}
                </Button>
              </FileUploadTrigger>
            </FileUploadDropzone>

            <UploadedFiles removeLabel={text.remove} />
          </FileUpload>
        </div>
      </div>
    </main>
  );
}

export default App;
