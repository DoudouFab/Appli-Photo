import Peer, { DataConnection } from 'peerjs';
import { PortableFolderBundle, QueuedPhoto } from '../types';

const CHUNK_SIZE = 64 * 1024; // 64 KB safe WebRTC SCTP chunk size
const PEER_PREFIX = 'chantiershot-fp-';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export interface ReceivedPcPhoto {
  id: string;
  filename: string;
  folderPath: string;
  size: number;
  blob: Blob;
  uploadedAt: number;
}

type P2PMessage =
  | {
      type: 'PHOTO_START';
      id: string;
      filename: string;
      folderPath: string;
      mimeType: string;
      size: number;
      totalChunks: number;
    }
  | {
      type: 'PHOTO_CHUNK';
      id: string;
      index: number;
      data: ArrayBuffer;
    }
  | {
      type: 'PHOTO_END';
      id: string;
    }
  | {
      type: 'FOLDER_TREE';
      paths: string[];
    }
  | {
      type: 'TRANSFER_SAVED_ON_PC';
    }
  | {
      type: 'FOLDER_BUNDLE';
      bundle: PortableFolderBundle;
    }
  | {
      type: 'FOLDER_BUNDLE_ACK';
      createdCount: number;
    };

export async function isHttpTransferAvailable(): Promise<boolean> {
  try {
    const res = await fetch('./api/transfer/create', { method: 'POST' });
    // Note: we don't keep this probe room; check content-type to distinguish static HTML 404 from JSON API
    const contentType = res.headers.get('content-type') || '';
    return res.ok && contentType.includes('application/json');
  } catch {
    return false;
  }
}

export interface P2PReceiverSession {
  code: string;
  sendAck: () => void;
  destroy: () => void;
}

export function startP2PReceiver(callbacks: {
  onReady: (code: string) => void;
  onFolderPathsReceived?: (paths: string[]) => void;
  onPhotoReceived: (photo: ReceivedPcPhoto) => void;
  onError: (message: string) => void;
}): P2PReceiverSession {
  const randomCode = String(Math.floor(100000 + Math.random() * 900000));
  const peer = new Peer(`${PEER_PREFIX}${randomCode}`, {
    config: { iceServers: ICE_SERVERS },
  });

  const activeConnections = new Set<DataConnection>();
  const incomingBuffers = new Map<
    string,
    {
      filename: string;
      folderPath: string;
      mimeType: string;
      size: number;
      chunks: ArrayBuffer[];
    }
  >();

  peer.on('open', () => {
    callbacks.onReady(randomCode);
  });

  peer.on('connection', (conn) => {
    activeConnections.add(conn);

    conn.on('data', (raw) => {
      const msg = raw as P2PMessage;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'PHOTO_START') {
        incomingBuffers.set(msg.id, {
          filename: msg.filename,
          folderPath: msg.folderPath,
          mimeType: msg.mimeType || 'image/jpeg',
          size: msg.size,
          chunks: [],
        });
      } else if (msg.type === 'PHOTO_CHUNK') {
        const entry = incomingBuffers.get(msg.id);
        if (entry) {
          entry.chunks[msg.index] = msg.data;
        }
      } else if (msg.type === 'FOLDER_TREE') {
        if (Array.isArray(msg.paths)) {
          callbacks.onFolderPathsReceived?.(msg.paths);
        }
      } else if (msg.type === 'PHOTO_END') {
        const entry = incomingBuffers.get(msg.id);
        if (entry) {
          incomingBuffers.delete(msg.id);
          const blob = new Blob(entry.chunks, { type: entry.mimeType });
          callbacks.onPhotoReceived({
            id: msg.id,
            filename: entry.filename,
            folderPath: entry.folderPath,
            size: blob.size,
            blob,
            uploadedAt: Date.now(),
          });
        }
      }
    });

    conn.on('close', () => {
      activeConnections.delete(conn);
    });
  });

  peer.on('error', (err) => {
    callbacks.onError(
      err?.message?.includes('ID')
        ? 'Collision de code temporaire, générez un nouveau code.'
        : 'Connexion P2P interrompue. Vérifiez le réseau et réessayez.'
    );
  });

  return {
    code: randomCode,
    sendAck: () => {
      for (const conn of activeConnections) {
        if (conn.open) {
          conn.send({ type: 'TRANSFER_SAVED_ON_PC' } satisfies P2PMessage);
        }
      }
    },
    destroy: () => {
      for (const conn of activeConnections) {
        try {
          conn.close();
        } catch {
          // Ignore close error
        }
      }
      peer.destroy();
    },
  };
}

async function waitForBufferDrain(conn: DataConnection): Promise<void> {
  const dc = (conn as unknown as { dataChannel?: RTCDataChannel }).dataChannel;
  if (!dc) return;
  while (dc.bufferedAmount > 512 * 1024 && conn.open) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

export async function sendPhotosViaP2P(
  code: string,
  photos: QueuedPhoto[],
  folderPaths: string[],
  onProgress: (sent: number, total: number) => void,
  onPcConfirmed: () => Promise<void> | void
): Promise<{ disconnect: () => void }> {
  const peer = new Peer({
    config: { iceServers: ICE_SERVERS },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        peer.destroy();
        reject(new Error('Délai dépassé : vérifiez que le code est bien affiché sur le PC.'));
      }
    }, 18_000);

    peer.on('open', () => {
      const conn = peer.connect(`${PEER_PREFIX}${code}`, { reliable: true });

      conn.on('open', async () => {
        clearTimeout(timeout);
        try {
          if (folderPaths.length > 0) {
            conn.send({
              type: 'FOLDER_TREE',
              paths: folderPaths,
            } satisfies P2PMessage);
          }

          for (let i = 0; i < photos.length; i++) {
            const photo = photos[i];
            const buffer = await photo.blob.arrayBuffer();
            const totalChunks = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_SIZE));

            conn.send({
              type: 'PHOTO_START',
              id: photo.id,
              filename: photo.filename,
              folderPath: photo.folderPath,
              mimeType: photo.blob.type || 'image/jpeg',
              size: buffer.byteLength,
              totalChunks,
            } satisfies P2PMessage);

            for (let c = 0; c < totalChunks; c++) {
              const start = c * CHUNK_SIZE;
              const end = Math.min(start + CHUNK_SIZE, buffer.byteLength);
              const slice = buffer.slice(start, end);
              await waitForBufferDrain(conn);
              conn.send({
                type: 'PHOTO_CHUNK',
                id: photo.id,
                index: c,
                data: slice,
              } satisfies P2PMessage);
            }

            conn.send({
              type: 'PHOTO_END',
              id: photo.id,
            } satisfies P2PMessage);

            onProgress(i + 1, photos.length);
          }

          settled = true;
          resolve({
            disconnect: () => {
              try {
                conn.close();
              } catch {
                // ignore
              }
              peer.destroy();
            },
          });
        } catch (err) {
          if (!settled) {
            settled = true;
            peer.destroy();
            reject(err);
          }
        }
      });

      conn.on('data', async (raw) => {
        const msg = raw as P2PMessage;
        if (msg?.type === 'TRANSFER_SAVED_ON_PC') {
          await onPcConfirmed();
          try {
            conn.close();
          } catch {
            // ignore
          }
          peer.destroy();
        }
      });

      conn.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          peer.destroy();
          reject(new Error('Impossible de joindre ce code sur le PC.'));
        }
      });
    });

    peer.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        peer.destroy();
        reject(new Error(err?.message || 'Erreur de connexion P2P.'));
      }
    });
  });
}

export interface FolderReceiverSession {
  code: string;
  destroy: () => void;
}

export function startFolderBundleReceiverP2P(callbacks: {
  onReady: (code: string) => void;
  onBundleReceived: (bundle: PortableFolderBundle) => Promise<number>;
  onError: (message: string) => void;
}): FolderReceiverSession {
  const randomCode = String(Math.floor(100000 + Math.random() * 900000));
  const peer = new Peer(`${PEER_PREFIX}${randomCode}`, {
    config: { iceServers: ICE_SERVERS },
  });
  const activeConnections = new Set<DataConnection>();

  peer.on('open', () => {
    callbacks.onReady(randomCode);
  });

  peer.on('connection', (conn) => {
    activeConnections.add(conn);
    conn.on('data', async (raw) => {
      const msg = raw as P2PMessage;
      if (msg?.type === 'FOLDER_BUNDLE' && msg.bundle) {
        try {
          const createdCount = await callbacks.onBundleReceived(msg.bundle);
          if (conn.open) {
            conn.send({
              type: 'FOLDER_BUNDLE_ACK',
              createdCount,
            } satisfies P2PMessage);
          }
        } catch (err) {
          callbacks.onError(
            err instanceof Error
              ? err.message
              : 'Impossible d’enregistrer les dossiers reçus.'
          );
        }
      }
    });
    conn.on('close', () => {
      activeConnections.delete(conn);
    });
  });

  peer.on('error', (err) => {
    callbacks.onError(
      err?.message?.includes('ID')
        ? 'Collision de code temporaire, générez un nouveau code.'
        : 'Connexion P2P interrompue. Vérifiez le réseau et réessayez.'
    );
  });

  return {
    code: randomCode,
    destroy: () => {
      for (const conn of activeConnections) {
        try {
          conn.close();
        } catch {
          // ignore
        }
      }
      peer.destroy();
    },
  };
}

export async function sendFolderBundleViaP2P(
  code: string,
  bundle: PortableFolderBundle
): Promise<{ createdCount: number }> {
  const peer = new Peer({
    config: { iceServers: ICE_SERVERS },
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        peer.destroy();
        reject(
          new Error('Délai dépassé : vérifiez que le code est bien affiché sur le téléphone.')
        );
      }
    }, 15_000);

    peer.on('open', () => {
      const conn = peer.connect(`${PEER_PREFIX}${code}`, { reliable: true });

      conn.on('open', () => {
        conn.send({
          type: 'FOLDER_BUNDLE',
          bundle,
        } satisfies P2PMessage);
      });

      conn.on('data', (raw) => {
        const msg = raw as P2PMessage;
        if (msg?.type === 'FOLDER_BUNDLE_ACK' && !settled) {
          settled = true;
          clearTimeout(timeout);
          try {
            conn.close();
          } catch {
            // ignore
          }
          peer.destroy();
          resolve({ createdCount: msg.createdCount ?? 0 });
        }
      });

      conn.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          peer.destroy();
          reject(new Error('Impossible de joindre ce code sur le téléphone.'));
        }
      });
    });

    peer.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        peer.destroy();
        reject(new Error(err?.message || 'Erreur de connexion P2P.'));
      }
    });
  });
}
