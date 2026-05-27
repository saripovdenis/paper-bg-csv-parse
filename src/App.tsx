import { useState } from 'react';
import { UploadCloud } from 'lucide-react';

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

type Language = 'en' | 'ru';

const copy = {
  en: {
    browse: 'Browse files',
    constraint: 'Up to 3 files, 100MB each',
    drop: 'Drag & drop files here',
    mainThread: 'Main Thread Parsing',
    remove: 'Remove',
    responsiveness: 'Interface responsiveness marker',
    switchMainThread: 'Switch to Main Thread',
    switchWorker: 'Switch to Worker',
    uploadLabel: 'File upload',
    worker: 'Worker Based Parsing',
  },
  ru: {
    browse: 'Выбрать файлы',
    constraint: 'До 3 файлов, 100 МБ каждый',
    drop: 'Перетащите файлы сюда',
    mainThread: 'Чтение в основном потоке',
    remove: 'Удалить',
    responsiveness: 'Маркер отклика интерфейса',
    switchMainThread: 'Переключить на основной поток',
    switchWorker: 'Переключить на Worker',
    uploadLabel: 'Загрузка файла',
    worker: 'Чтение через Worker',
  },
} satisfies Record<Language, Record<string, string>>;

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

function App() {
  const [language, setLanguage] = useState<Language>('ru');
  const [workerParsing, setWorkerParsing] = useState(false);
  const text = copy[language];

  return (
    <main className="relative flex min-h-svh items-center justify-center bg-white p-6">
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

      <div className="flex w-[420px] max-w-full flex-col items-center gap-3">
        <div
          data-responsiveness-marker
          className="flex size-28 flex-col items-center justify-center gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-center subpixel-antialiased [font-family:ui-sans-serif,system-ui,sans-serif]"
        >
          <Spokes
            aria-hidden="true"
            className="h-6 w-6 text-neutral-100 [--duration:900ms]"
          />
          <p className="text-[11px] font-medium leading-3 text-neutral-300">
            {text.responsiveness}
          </p>
        </div>

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
    </main>
  );
}

export default App;
