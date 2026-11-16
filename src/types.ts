export interface BreadcrumbSegment {
  id: string;
  name: string;
}

export interface TargetFolder {
  id: string;
  name: string;
  pathSegments: BreadcrumbSegment[];
}

export interface QueuedPhoto {
  id: string;
  filename: string;
  blob: Blob;
  size: number;
  capturedAt: number;
  folderId: string;
  folderPath: string;
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
  jpegQuality: number;
}
