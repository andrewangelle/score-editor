type PermissionDescriptor = { mode: 'read' | 'readwrite' };

export type PdfFileHandle = FileSystemFileHandle & {
  queryPermission?: (
    descriptor: PermissionDescriptor,
  ) => Promise<PermissionState>;
  requestPermission?: (
    descriptor: PermissionDescriptor,
  ) => Promise<PermissionState>;
};

type FilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<PdfFileHandle[]>;
};

type FileSystemDataTransferItem = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

const PDF_TYPES = [
  { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
];

export function supportsInPlaceSave(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as FilePickerWindow).showOpenFilePicker === 'function'
  );
}

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === 'AbortError';
}

export async function pickPdfFile(): Promise<{
  file: File;
  handle: PdfFileHandle;
} | null> {
  const picker = (window as FilePickerWindow).showOpenFilePicker;
  if (!picker) return null;

  try {
    const [handle] = await picker.call(window, {
      multiple: false,
      types: PDF_TYPES,
    });
    return handle ? { file: await handle.getFile(), handle } : null;
  } catch (cause) {
    /** The user closing the picker is a decision, not a failure. */
    if (isAbort(cause)) return null;
    throw cause;
  }
}

export async function droppedFileHandle(
  item: DataTransferItem | null | undefined,
): Promise<PdfFileHandle | null> {
  const getHandle = (item as FileSystemDataTransferItem | null | undefined)
    ?.getAsFileSystemHandle;
  if (!getHandle) return null;

  try {
    const handle = await getHandle.call(item);
    return handle?.kind === 'file' ? (handle as PdfFileHandle) : null;
  } catch {
    // A handle is a bonus here; failing to get one must not fail the drop.
    return null;
  }
}

async function ensureWritePermission(handle: PdfFileHandle): Promise<boolean> {
  const descriptor: PermissionDescriptor = { mode: 'readwrite' };

  if (await handle.queryPermission?.(descriptor).then((s) => s === 'granted')) {
    return true;
  }
  if (!handle.requestPermission) return true;

  return (await handle.requestPermission(descriptor)) === 'granted';
}

export class FileWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileWriteError';
  }
}

/** Replaces the file's contents. The handle must be one this app opened. */
export async function writePdfFile(
  handle: PdfFileHandle,
  bytes: Uint8Array,
): Promise<void> {
  if (!(await ensureWritePermission(handle))) {
    throw new FileWriteError(
      `Permission to change "${handle.name}" was not granted.`,
    );
  }

  let writable: FileSystemWritableFileStream;
  try {
    writable = await handle.createWritable();
  } catch (cause) {
    throw new FileWriteError(
      cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? `Permission to change "${handle.name}" was not granted.`
        : `"${handle.name}" could not be opened for writing: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  try {
    // A Blob rather than the array itself, so the stream never aliases a buffer
    // the editor still holds. `createWritable` truncates, so this is a replace.
    await writable.write(
      new Blob([bytes.slice().buffer as ArrayBuffer], {
        type: 'application/pdf',
      }),
    );
    await writable.close();
  } catch (cause) {
    // Leaving the stream open would hold a lock on the file, and on some
    // platforms a half-written temp file alongside it.
    await writable.abort().catch(() => {});
    throw new FileWriteError(
      `"${handle.name}" could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}
