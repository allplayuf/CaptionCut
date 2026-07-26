/** Font families shared by the browser preview and the server-side ASS export. */
export function captionPreviewFontFamily(fontFamily: string): string {
  const normalized = fontFamily.trim().toLowerCase();
  if (normalized === "arial black") {
    return `'CaptionCut Archivo Black', 'Arial Black', sans-serif`;
  }
  if (normalized === "impact") {
    return `'CaptionCut Anton', Impact, sans-serif`;
  }
  return `'${fontFamily}', sans-serif`;
}
