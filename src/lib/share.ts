import { QueuedPhoto } from '../types';

export type ShareOutcome =
  | { status: 'shared' }
  | { status: 'cancelled' }
  | { status: 'fallback_downloaded'; count: number };

export function downloadBlobFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function canUseNativeFileShare(files: File[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return false;
  }
  if (typeof navigator.canShare === 'function') {
    try {
      return navigator.canShare({ files });
    } catch {
      return false;
    }
  }
  return true;
}

export async function sharePhotosNativeOrDownload(
  photos: QueuedPhoto[],
  title = 'Photos ChantierShot'
): Promise<ShareOutcome> {
  if (photos.length === 0) {
    return { status: 'cancelled' };
  }

  const files = photos.map(
    (p) =>
      new File([p.blob], p.filename, {
        type: p.blob.type || 'image/jpeg',
        lastModified: p.capturedAt,
      })
  );

  if (canUseNativeFileShare(files)) {
    try {
      await navigator.share({
        files,
        title,
        text:
          photos.length === 1
            ? `Photo chantier (${photos[0].folderPath})`
            : `${photos.length} photos de chantier`,
      });
      return { status: 'shared' };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'cancelled' };
      }
      // Fall through to download fallback if native share rejected file batch
    }
  }

  // Fallback for desktop browsers / unsupported WebViews
  for (const photo of photos) {
    downloadBlobFile(photo.blob, photo.filename);
  }
  return { status: 'fallback_downloaded', count: photos.length };
}

export async function shareZipNativeOrDownload(
  zipBlob: Blob,
  zipFilename: string,
  title = 'Archive ChantierShot'
): Promise<ShareOutcome> {
  const zipFile = new File([zipBlob], zipFilename, {
    type: 'application/zip',
    lastModified: Date.now(),
  });

  if (canUseNativeFileShare([zipFile])) {
    try {
      await navigator.share({
        files: [zipFile],
        title,
        text: `Archive photos chantier (${zipFilename})`,
      });
      return { status: 'shared' };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return { status: 'cancelled' };
      }
    }
  }

  downloadBlobFile(zipBlob, zipFilename);
  return { status: 'fallback_downloaded', count: 1 };
}
