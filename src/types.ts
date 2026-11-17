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
  note?: string;
}

export interface LocalFolderRecord {
  id: string;
  parentId: string;
  name: string;
  createdAt: number;
  note?: string;
}

export interface CaptureSettings {
  prefix: string;
  burnStamp: boolean;
  jpegQuality: number;
}

export interface PortableFolderNode {
  name: string;
  note?: string;
  children?: PortableFolderNode[];
}

export interface PortableFolderBundle {
  version: 1;
  exportedAt: number;
  chantiers: PortableFolderNode[];
}

