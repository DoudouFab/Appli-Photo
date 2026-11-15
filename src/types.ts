export type StorageSource = 'onedrive' | 'local';

export interface BreadcrumbSegment {
  id: string;
  name: string;
}

export interface DriveFolderItem {
  id: string;
  name: string;
  isFolder: boolean;
  childCount?: number;
  size?: number;
  lastModifiedDateTime?: string;
  webUrl?: string;
}

export interface TargetFolder {
  id: string;
  name: string;
  source: StorageSource;
  pathSegments: BreadcrumbSegment[];
}

export type PhotoStatus = 'pending' | 'uploading' | 'synced' | 'error';

export interface QueuedPhoto {
  id: string;
  filename: string;
  blob: Blob;
  size: number;
  capturedAt: number;
  folderId: string;
  folderPath: string;
  source: StorageSource;
  status: PhotoStatus;
  errorMessage?: string;
  webUrl?: string;
}

export interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  user?: {
    id: string;
    displayName: string;
    mail?: string;
    userPrincipalName?: string;
  } | null;
  redirectUri: string;
}

export interface LocalFolderRecord {
  id: string;
  parentId: string;
  name: string;
  createdAt: number;
}

export interface CaptureSettings {
  prefix: string;
  burnStamp: boolean;
  autoPurgeAfterSync: boolean;
  jpegQuality: number;
}
