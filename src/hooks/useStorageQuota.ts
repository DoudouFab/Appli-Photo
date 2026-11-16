import { useCallback, useEffect, useMemo, useState } from 'react';
import { QueuedPhoto } from '../types';

export interface StorageQuotaState {
  photosBytes: number;
  totalUsageBytes: number;
  otherUsageBytes: number;
  quotaBytes: number | null;
  freeBytes: number | null;
  usedPercent: number;
  photosPercent: number;
  otherPercent: number;
  avgPhotoBytes: number;
  isRealAverage: boolean;
  estimatedRemainingPhotos: number | null;
  refresh: () => Promise<void>;
}

const DEFAULT_AVG_PHOTO_BYTES = 2_200_000; // ~2.2 Mo average for 15 MP JPEG

export function useStorageQuota(photos: QueuedPhoto[]): StorageQuotaState {
  const [estimate, setEstimate] = useState<{ usage: number | null; quota: number | null }>({
    usage: null,
    quota: null,
  });

  const photosBytes = useMemo(
    () => photos.reduce((sum, p) => sum + (p.size || 0), 0),
    [photos]
  );

  const refresh = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return;
    }
    try {
      const est = await navigator.storage.estimate();
      setEstimate({
        usage: typeof est.usage === 'number' ? est.usage : null,
        quota: typeof est.quota === 'number' && est.quota > 0 ? est.quota : null,
      });
    } catch {
      // Ignore browser storage estimate restriction
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, photos.length, photosBytes]);

  return useMemo(() => {
    const quotaBytes = estimate.quota;
    const totalUsageBytes =
      estimate.usage !== null ? Math.max(estimate.usage, photosBytes) : photosBytes;
    const otherUsageBytes = Math.max(0, totalUsageBytes - photosBytes);
    const freeBytes =
      quotaBytes !== null ? Math.max(0, quotaBytes - totalUsageBytes) : null;

    const usedPercent =
      quotaBytes && quotaBytes > 0
        ? Math.min(100, (totalUsageBytes / quotaBytes) * 100)
        : 0;
    const photosPercent =
      quotaBytes && quotaBytes > 0
        ? Math.min(100, (photosBytes / quotaBytes) * 100)
        : 0;
    const otherPercent =
      quotaBytes && quotaBytes > 0
        ? Math.max(0, Math.min(100 - photosPercent, (otherUsageBytes / quotaBytes) * 100))
        : 0;

    const isRealAverage = photos.length > 0 && photosBytes > 0;
    const avgPhotoBytes = isRealAverage
      ? Math.max(250_000, Math.round(photosBytes / photos.length))
      : DEFAULT_AVG_PHOTO_BYTES;

    const estimatedRemainingPhotos =
      freeBytes !== null ? Math.floor(freeBytes / avgPhotoBytes) : null;

    return {
      photosBytes,
      totalUsageBytes,
      otherUsageBytes,
      quotaBytes,
      freeBytes,
      usedPercent,
      photosPercent,
      otherPercent,
      avgPhotoBytes,
      isRealAverage,
      estimatedRemainingPhotos,
      refresh,
    };
  }, [estimate.quota, estimate.usage, photos.length, photosBytes, refresh]);
}
