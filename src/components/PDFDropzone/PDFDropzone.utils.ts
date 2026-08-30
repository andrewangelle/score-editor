export function getFileOpenErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);
  return `The file picker could not be opened: ${message}`;
}
