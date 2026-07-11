import { useId, useState } from 'react';
import {
  Check,
  ChevronDown,
  Circle,
  Download,
  Info,
  Play,
  RotateCcw,
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
import { cn } from '@/lib/utils';

type Language = 'en' | 'ru';
type TaskStatus = 'done' | 'running' | 'next';

const files = [
  {
    name: '01-small-1mib.csv',
    size: '1 MiB',
    rows: '11,737',
    url: smallCsvUrl,
  },
  {
    name: '02-medium-10mib.csv',
    size: '10 MiB',
    rows: '115,989',
    url: mediumCsvUrl,
  },
  {
    name: '03-large-100mib.csv',
    size: '100 MiB',
    rows: '1,147,213',
    url: largeCsvUrl,
  },
] as const;

const copy = {
  en: {
    browser: 'Browser',
    chip: 'Chip',
    completed: 'complete',
    configurationCount: '37 configurations',
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
    filesLoaded: '3 of 3 files loaded',
    inProgress: 'In progress',
    languageLabel: 'Switch language',
    mainThread: 'Main thread',
    maxThreads: 'Logical processors',
    moreTasks: '+ 26 more tasks',
    measuredRunsHelp:
      'Recorded iterations per configuration. Whole number from 0 to 100.',
    measuredRuns: 'Measured runs',
    memory: 'RAM',
    fourWorkers: '4 workers',
    oneWorker: '1 worker',
    next: 'Next',
    operatingSystem: 'OS',
    queued: 'Queued',
    reset: 'Reset',
    rows: 'rows',
    russianLanguage: 'Russian',
    running: 'Running',
    settings: 'Experiment settings',
    start: 'Start',
    taskQueue: 'Tasks',
    twoWorkers: '2 workers',
    uiResponsive: 'UI responsive',
    warmupRunsHelp:
      'Warm-up iterations before measurements. Whole number from 0 to 100.',
    warmupRuns: 'Warm-up runs',
    yes: 'Yes',
  },
  ru: {
    browser: 'Браузер',
    chip: 'Чип',
    completed: 'завершено',
    configurationCount: '37 конфигураций',
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
    filesLoaded: 'Загружено 3 из 3 файлов',
    inProgress: 'Выполняется',
    languageLabel: 'Переключить язык',
    mainThread: 'Основной поток',
    maxThreads: 'Логические потоки',
    moreTasks: '+ ещё 26 задач',
    measuredRunsHelp:
      'Число сохраняемых замеров на конфигурацию. Целое число от 0 до 100.',
    measuredRuns: 'Замеры',
    memory: 'ОЗУ',
    fourWorkers: '4 воркера',
    oneWorker: '1 воркер',
    next: 'Далее',
    operatingSystem: 'ОС',
    queued: 'В очереди',
    reset: 'Сбросить',
    rows: 'строк',
    russianLanguage: 'Русский',
    running: 'Выполняется',
    settings: 'Настройки эксперимента',
    start: 'Начать',
    taskQueue: 'Задачи',
    twoWorkers: '2 воркера',
    uiResponsive: 'Интерфейс отвечает',
    warmupRunsHelp:
      'Число прогревочных запусков до замеров. Целое число от 0 до 100.',
    warmupRuns: 'Прогревочные запуски',
    yes: 'Да',
  },
} as const;

function NumberField({
  defaultValue,
  description,
  label,
}: {
  defaultValue: number;
  description: string;
  label: string;
}) {
  const inputId = useId();
  const helpId = useId();
  const [value, setValue] = useState(String(defaultValue));

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
      <input
        id={inputId}
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        value={value}
        aria-describedby={helpId}
        className="h-8 w-14 justify-self-end rounded-lg bg-white px-2 text-right text-sm font-semibold tabular-nums text-neutral-950 outline-none transition-[box-shadow,background-color] duration-150 focus:shadow-[0_0_0_3px_rgba(0,0,0,0.1)]"
        onBlur={() => {
          if (value === '') setValue('0');
        }}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (nextValue === '') {
            setValue('');
            return;
          }

          const parsedValue = Number(nextValue);
          if (!Number.isFinite(parsedValue)) return;
          setValue(String(Math.min(100, Math.max(0, Math.trunc(parsedValue)))));
        }}
      />
      <span id={helpId} className="sr-only">
        {description}
      </span>
    </div>
  );
}

function FilesCard({ language }: { language: Language }) {
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
            3/3
          </span>
          <span className="sr-only">{text.filesLoaded}</span>
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
                {file.size} · {file.rows} {text.rows}
              </span>
            </span>
            <a
              href={file.url}
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

function SettingsCard({ language }: { language: Language }) {
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
            defaultValue={3}
          />
          <NumberField
            label={text.measuredRuns}
            description={text.measuredRunsHelp}
            defaultValue={20}
          />
        </div>
      </TooltipProvider>
    </section>
  );
}

function EnvironmentCard({ language }: { language: Language }) {
  const text = copy[language];
  const rows = [
    { label: text.crossOrigin, value: text.yes },
    {
      label: text.displayRefresh,
      value: language === 'ru' ? '60 Гц' : '60 Hz',
    },
    { label: text.operatingSystem, value: 'macOS 26.3.1' },
    { label: text.browser, value: 'Chrome 145' },
    { label: text.chip, value: 'Apple M4' },
    { label: text.memory, value: language === 'ru' ? '16 ГБ' : '16 GB' },
    { label: text.maxThreads, value: '10' },
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
            <dd className="text-right font-medium tabular-nums text-neutral-900">
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function CurrentProgressCard({ language }: { language: Language }) {
  const text = copy[language];

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
              className="rounded-full bg-white/10 px-2 py-1 text-[10px] font-medium text-neutral-200"
            >
              {text.running}
            </span>
          </span>
          <span className="text-xs font-medium sm:text-sm">7%</span>
        </div>
        <div
          role="progressbar"
          aria-label={text.experimentProgress}
          aria-valuemin={0}
          aria-valuemax={111}
          aria-valuenow={8}
          className="h-2.5 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full w-[7.2%] min-w-3 rounded-full bg-emerald-400" />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-0.5">
        <Button
          type="button"
          className="h-8 gap-1 rounded-lg bg-white pl-2 pr-2.5 text-xs text-neutral-950 transition-transform duration-150 hover:bg-neutral-200 active:scale-[0.97] sm:gap-1.5 sm:pr-3 [&_svg]:size-3.5"
        >
          <Play data-icon="inline-start" className="fill-current" />
          {text.start}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 gap-1 rounded-lg px-2 text-xs text-neutral-300 transition-transform duration-150 hover:bg-white/10 hover:text-white active:scale-[0.97] sm:gap-1.5 sm:px-2.5 [&_svg]:size-3.5"
        >
          <RotateCcw data-icon="inline-start" className="hidden sm:block" />
          {text.reset}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-8 gap-1 rounded-lg px-2 text-xs text-neutral-300 transition-transform duration-150 hover:bg-white/10 hover:text-white active:scale-[0.97] sm:gap-1.5 sm:px-2.5 [&_svg]:size-3.5"
        >
          <Download data-icon="inline-start" className="hidden sm:block" />
          <span className="sm:hidden">{text.exportShort}</span>
          <span className="hidden sm:inline">{text.export}</span>
        </Button>
      </div>
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
        : text.next;

  return (
    <li
      aria-current={status === 'running' ? 'step' : undefined}
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
        ) : (
          <Circle aria-hidden="true" className="size-3.5 text-neutral-300" />
        )}
      </span>
      <span
        className={cn(
          'min-w-0 flex-1 text-sm sm:text-[15px]',
          status === 'running'
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
            : status === 'running'
              ? 'text-yellow-600'
              : 'text-neutral-400',
        )}
      >
        {statusLabel}
      </span>
    </li>
  );
}

function TaskBoard({ language }: { language: Language }) {
  const text = copy[language];
  const tasks: Array<{ label: string; status: TaskStatus }> = [
    { label: text.mainThread, status: 'done' },
    {
      label: `${text.oneWorker} · String clone · 4×W`,
      status: 'done',
    },
    {
      label: `${text.twoWorkers} · ArrayBuffer · 2×W`,
      status: 'running',
    },
    {
      label: `${text.twoWorkers} · ArrayBuffer · 4×W`,
      status: 'next',
    },
    {
      label: `${text.fourWorkers} · ArrayBuffer · 1×W`,
      status: 'next',
    },
  ];

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
        <span className="text-sm tabular-nums text-neutral-500">8 / 111</span>
      </div>

      <article>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-neutral-900">
              {files[0].name}
            </h3>
            <p className="mt-1 text-xs text-neutral-500">{files[0].size}</p>
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-neutral-500">
            8 / 37 {text.completed}
          </span>
        </div>

        <ol className="mt-5" aria-label={files[0].name}>
          {tasks.map((task) => (
            <TaskRow
              key={task.label}
              label={task.label}
              language={language}
              status={task.status}
            />
          ))}
          <li className="flex min-h-9 items-center px-1 sm:px-2">
            <span className="ml-10 text-xs font-medium text-neutral-400">
              {text.moreTasks}
            </span>
          </li>
        </ol>
      </article>

      <div className="mt-6 divide-y divide-neutral-200 border-t border-neutral-200">
        {files.slice(1).map((file) => (
          <article
            key={file.name}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-5"
          >
            <div className="min-w-0">
              <h3 className="truncate text-sm font-semibold tracking-[-0.01em] text-neutral-900">
                {file.name}
              </h3>
              <p className="mt-1 text-xs text-neutral-500">{file.size}</p>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-neutral-500">
              <span className="sr-only">{text.configurationCount}, </span>
              <span
                aria-hidden="true"
                className="text-xs tabular-nums text-neutral-400"
              >
                37
              </span>
              <span aria-hidden="true" className="text-neutral-300">
                ·
              </span>
              <span>{text.queued}</span>
            </span>
          </article>
        ))}
      </div>
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
  const text = copy[language];

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
          <span>{text.uiResponsive}</span>
        </div>
        <LanguagePicker language={language} onChange={setLanguage} />
      </div>

      <div className="mx-auto grid w-full max-w-[1400px] items-start gap-5 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="order-2 space-y-3 lg:order-none lg:sticky lg:top-6">
          <EnvironmentCard language={language} />
          <FilesCard language={language} />
          <SettingsCard language={language} />
        </aside>

        <div className="order-1 min-w-0 space-y-9 lg:order-none">
          <CurrentProgressCard language={language} />
          <TaskBoard language={language} />
        </div>
      </div>
    </main>
  );
}

export { ResearchDashboard };
