/** Saves bytes to the user's machine via a transient object URL. */
export function downloadBytes(
  bytes: Uint8Array,
  fileName: string,
  type: string,
): void {
  // Copy into a standalone buffer so the Blob never aliases memory we still use.
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();

  URL.revokeObjectURL(url);
}
