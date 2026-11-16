import 'dotenv/config';
import express, { Request, Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

interface TransferPhoto {
  id: string;
  filename: string;
  folderPath: string;
  contentType: string;
  size: number;
  buffer: Buffer;
  uploadedAt: number;
}

interface TransferRoom {
  code: string;
  createdAt: number;
  expiresAt: number;
  received: boolean;
  photos: TransferPhoto[];
}

const transferRooms = new Map<string, TransferRoom>();

function pruneTransferRooms() {
  const now = Date.now();
  for (const [code, room] of transferRooms.entries()) {
    if (room.expiresAt < now) {
      transferRooms.delete(code);
    }
  }
}

function sanitizePathSegments(rawPath: string): string[] {
  return rawPath
    .split('/')
    .map((seg) => seg.trim().replace(/[\\:*?"<>|]/g, '-'))
    .filter(
      (seg) =>
        seg.length > 0 &&
        seg !== '.' &&
        seg !== '..' &&
        seg !== 'Mes chantiers' &&
        seg !== 'Chantiers locaux'
    );
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  // --- Direct Phone -> Work PC Transfer Bridge ---

  app.post('/api/transfer/create', (_req: Request, res: Response) => {
    pruneTransferRooms();
    let code = '';
    for (let i = 0; i < 10; i++) {
      const candidate = String(crypto.randomInt(100000, 999999));
      if (!transferRooms.has(candidate)) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      return res.status(503).json({ error: 'NO_CODE_AVAILABLE' });
    }

    const now = Date.now();
    const room: TransferRoom = {
      code,
      createdAt: now,
      expiresAt: now + 30 * 60_000,
      received: false,
      photos: [],
    };
    transferRooms.set(code, room);
    return res.status(201).json({ code, expiresAt: room.expiresAt });
  });

  app.get('/api/transfer/:code/status', (req: Request, res: Response) => {
    pruneTransferRooms();
    const code = String(req.params.code || '').replace(/\D/g, '');
    const room = transferRooms.get(code);
    if (!room) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    }
    const totalBytes = room.photos.reduce((sum, p) => sum + p.size, 0);
    return res.json({
      code: room.code,
      expiresAt: room.expiresAt,
      received: room.received,
      photoCount: room.photos.length,
      totalBytes,
      items: room.photos.map((p) => ({
        id: p.id,
        filename: p.filename,
        folderPath: p.folderPath,
        size: p.size,
        uploadedAt: p.uploadedAt,
      })),
    });
  });

  app.post(
    '/api/transfer/:code/upload',
    express.raw({ type: 'application/octet-stream', limit: '25mb' }),
    (req: Request, res: Response) => {
      pruneTransferRooms();
      const code = String(req.params.code || '').replace(/\D/g, '');
      const room = transferRooms.get(code);
      if (!room) {
        return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
      }

      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return res.status(400).json({ error: 'EMPTY_FILE' });
      }

      const photoId = decodeURIComponent(String(req.header('X-Photo-Id') || crypto.randomUUID()));
      const rawFilename = decodeURIComponent(
        String(req.header('X-File-Name') || `photo_${Date.now()}.jpg`)
      );
      const safeFilename = rawFilename.replace(/[\\/:*?"<>|]/g, '_');
      const rawFolderPath = decodeURIComponent(String(req.header('X-Folder-Path') || 'Chantier'));
      const cleanPath = sanitizePathSegments(rawFolderPath).join('/') || 'Chantier';
      const contentType = String(req.header('X-Content-Type') || 'image/jpeg');

      if (!room.photos.some((p) => p.id === photoId)) {
        room.photos.push({
          id: photoId,
          filename: safeFilename,
          folderPath: cleanPath,
          contentType,
          size: buffer.length,
          buffer,
          uploadedAt: Date.now(),
        });
      }

      return res.status(201).json({ ok: true, photoCount: room.photos.length });
    }
  );

  app.get('/api/transfer/:code/file/:photoId', (req: Request, res: Response) => {
    const code = String(req.params.code || '').replace(/\D/g, '');
    const room = transferRooms.get(code);
    if (!room) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });

    const photo = room.photos.find((p) => p.id === req.params.photoId);
    if (!photo) return res.status(404).json({ error: 'PHOTO_NOT_FOUND' });

    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${photo.filename}"`);
    return res.send(photo.buffer);
  });

  app.get('/api/transfer/:code/zip', async (req: Request, res: Response) => {
    const code = String(req.params.code || '').replace(/\D/g, '');
    const room = transferRooms.get(code);
    if (!room) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    if (room.photos.length === 0) return res.status(400).json({ error: 'NO_PHOTOS' });

    const zip = new JSZip();
    for (const photo of room.photos) {
      const segments = sanitizePathSegments(photo.folderPath);
      const zipPath = [...segments, photo.filename].join('/');
      zip.file(zipPath, photo.buffer, { compression: 'STORE' });
    }

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Chantiers_${stamp}.zip"`);
    return res.send(zipBuffer);
  });

  app.post('/api/transfer/:code/ack', (req: Request, res: Response) => {
    const code = String(req.params.code || '').replace(/\D/g, '');
    const room = transferRooms.get(code);
    if (!room) return res.status(404).json({ error: 'SESSION_NOT_FOUND' });

    room.received = true;
    setTimeout(() => {
      const current = transferRooms.get(code);
      if (current) {
        current.photos = [];
        current.expiresAt = Date.now() + 5 * 60_000;
      }
    }, 15_000);

    return res.json({ ok: true });
  });

  // Vite middleware in dev, static serving in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ChantierShot server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
