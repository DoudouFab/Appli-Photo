import 'dotenv/config';
import express, { Request, Response } from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const SESSION_COOKIE = 'chantiershot_sid';

interface SessionTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user?: {
    id: string;
    displayName: string;
    mail?: string;
    userPrincipalName?: string;
  };
}

// Server-side in-memory token store (avoids 4KB browser cookie size limit for MS Graph JWTs)
const sessions = new Map<string, SessionTokens>();
const oauthStates = new Map<string, number>();

function getAppUrl(): string {
  const envUrl = process.env.APP_URL;
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

function getMicrosoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID?.trim() || '';
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET?.trim() || '';
  const tenantId = process.env.MICROSOFT_TENANT_ID?.trim() || 'common';
  return {
    clientId,
    clientSecret,
    tenantId,
    configured: Boolean(clientId && clientSecret),
  };
}

function getRedirectUri(): string {
  return `${getAppUrl()}/auth/callback`;
}

async function fetchMicrosoftUser(accessToken: string) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return undefined;
  return (await res.json()) as SessionTokens['user'];
}

async function getValidAccessToken(req: Request): Promise<{ token: string; sid: string } | null> {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;

  // Refresh 2 minutes before expiry
  if (Date.now() < session.expiresAt - 120_000) {
    return { token: session.accessToken, sid };
  }

  if (!session.refreshToken) {
    sessions.delete(sid);
    return null;
  }

  const { clientId, clientSecret, tenantId, configured } = getMicrosoftConfig();
  if (!configured) return null;

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: session.refreshToken,
      scope: 'User.Read Files.ReadWrite offline_access',
    }),
  });

  if (!tokenRes.ok) {
    sessions.delete(sid);
    return null;
  }

  const data = (await tokenRes.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  session.accessToken = data.access_token;
  if (data.refresh_token) session.refreshToken = data.refresh_token;
  session.expiresAt = Date.now() + data.expires_in * 1000;
  sessions.set(sid, session);

  return { token: session.accessToken, sid };
}

async function startServer() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));

  // Auth status & configuration discovery
  app.get('/api/auth/status', async (req: Request, res: Response) => {
    const config = getMicrosoftConfig();
    const redirectUri = getRedirectUri();
    const valid = await getValidAccessToken(req);

    if (!valid) {
      return res.json({
        configured: config.configured,
        authenticated: false,
        redirectUri,
      });
    }

    const session = sessions.get(valid.sid);
    if (!session?.user) {
      const user = await fetchMicrosoftUser(valid.token);
      if (session && user) {
        session.user = user;
        sessions.set(valid.sid, session);
      }
    }

    return res.json({
      configured: config.configured,
      authenticated: true,
      user: session?.user ?? null,
      redirectUri,
    });
  });

  // Construct Microsoft Entra / OneDrive OAuth URL
  app.get('/api/auth/url', (_req: Request, res: Response) => {
    const { clientId, tenantId, configured } = getMicrosoftConfig();
    if (!configured) {
      return res.status(400).json({
        error: 'MICROSOFT_NOT_CONFIGURED',
        message: 'Identifiants Microsoft OAuth manquants dans les secrets du serveur.',
        redirectUri: getRedirectUri(),
      });
    }

    const state = crypto.randomBytes(24).toString('hex');
    oauthStates.set(state, Date.now() + 10 * 60_000);

    // Prune expired states
    for (const [k, exp] of oauthStates.entries()) {
      if (exp < Date.now()) oauthStates.delete(k);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: getRedirectUri(),
      response_mode: 'query',
      scope: 'User.Read Files.ReadWrite offline_access',
      state,
      prompt: 'select_account',
    });

    const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
    return res.json({ url });
  });

  // OAuth callback handler (handles both /auth/callback and /auth/callback/)
  const callbackHandler = async (req: Request, res: Response) => {
    const { code, state, error, error_description } = req.query as Record<string, string | undefined>;

    if (error) {
      return res.status(400).send(`
        <!doctype html><html lang="fr"><body style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;">
          <h2>Connexion interrompue</h2>
          <p>${String(error_description || error).replace(/</g, '&lt;')}</p>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_ERROR', error: ${JSON.stringify(error_description || error)} }, '*');
            }
          </script>
        </body></html>
      `);
    }

    if (!code || !state || !oauthStates.has(state)) {
      return res.status(400).send(`
        <!doctype html><html lang="fr"><body style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;">
          <h2>Requête invalide ou expirée</h2>
          <p>Veuillez relancer la connexion depuis ChantierShot.</p>
        </body></html>
      `);
    }
    oauthStates.delete(state);

    const { clientId, clientSecret, tenantId, configured } = getMicrosoftConfig();
    if (!configured) {
      return res.status(500).send('Configuration OAuth manquante.');
    }

    try {
      const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: getRedirectUri(),
          grant_type: 'authorization_code',
          scope: 'User.Read Files.ReadWrite offline_access',
        }),
      });

      if (!tokenRes.ok) {
        const errText = await tokenRes.text();
        console.error('Microsoft token exchange failed:', errText);
        return res.status(500).send(`
          <!doctype html><html lang="fr"><body style="font-family:sans-serif;padding:24px;background:#0f172a;color:#f8fafc;">
            <h2>Erreur d'authentification Microsoft</h2>
            <p>Impossible d'échanger le code d'accès. Vérifiez l'URL de redirection dans Azure.</p>
          </body></html>
        `);
      }

      const tokenData = (await tokenRes.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      };

      const user = await fetchMicrosoftUser(tokenData.access_token);
      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        user,
      });

      res.cookie(SESSION_COOKIE, sid, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      });

      return res.send(`
        <!doctype html>
        <html lang="fr">
          <body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#0f172a;color:#f8fafc;margin:0;">
            <div style="text-align:center;padding:24px;">
              <p style="font-size:16px;font-weight:600;">Connexion OneDrive réussie</p>
              <p style="font-size:13px;color:#94a3b8;">Cette fenêtre va se fermer automatiquement...</p>
            </div>
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
          </body>
        </html>
      `);
    } catch (err) {
      console.error('Callback error:', err);
      return res.status(500).send('Erreur interne lors de la connexion Microsoft.');
    }
  };

  app.get(['/auth/callback', '/auth/callback/'], callbackHandler);

  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) sessions.delete(sid);
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });
    res.json({ ok: true });
  });

  // List OneDrive folder contents (folders + recent photos)
  app.get('/api/onedrive/children', async (req: Request, res: Response) => {
    const auth = await getValidAccessToken(req);
    if (!auth) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const folderId = typeof req.query.folderId === 'string' && req.query.folderId ? req.query.folderId : 'root';
    const endpoint =
      folderId === 'root'
        ? 'https://graph.microsoft.com/v1.0/me/drive/root/children?$top=200&$select=id,name,folder,file,size,lastModifiedDateTime,webUrl,parentReference'
        : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(folderId)}/children?$top=200&$select=id,name,folder,file,size,lastModifiedDateTime,webUrl,parentReference`;

    const graphRes = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });

    if (!graphRes.ok) {
      const errBody = await graphRes.text();
      return res.status(graphRes.status).json({ error: 'GRAPH_ERROR', details: errBody });
    }

    const data = (await graphRes.json()) as { value: Array<Record<string, unknown>> };
    const items = (data.value || []).sort((a, b) => {
      const aFolder = Boolean(a.folder);
      const bFolder = Boolean(b.folder);
      if (aFolder !== bFolder) return aFolder ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' });
    });

    return res.json({ items });
  });

  // Create a subfolder inside OneDrive (Chantier / Sous-dossier / Sous-sous-dossier)
  app.post('/api/onedrive/folder', async (req: Request, res: Response) => {
    const auth = await getValidAccessToken(req);
    if (!auth) return res.status(401).json({ error: 'UNAUTHORIZED' });

    const { parentId = 'root', name } = req.body as { parentId?: string; name?: string };
    const cleanName = (name || '').trim().replace(/[\\/:*?"<>|]/g, '-');
    if (!cleanName) {
      return res.status(400).json({ error: 'Nom de dossier invalide.' });
    }

    const endpoint =
      parentId === 'root'
        ? 'https://graph.microsoft.com/v1.0/me/drive/root/children'
        : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}/children`;

    const graphRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: cleanName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      }),
    });

    if (!graphRes.ok) {
      const errBody = await graphRes.text();
      return res.status(graphRes.status).json({ error: 'GRAPH_CREATE_FAILED', details: errBody });
    }

    const created = await graphRes.json();
    return res.status(201).json({ item: created });
  });

  // Direct binary photo upload to OneDrive folder (supports <= 4MB simple PUT & > 4MB upload session)
  app.post(
    '/api/onedrive/upload',
    express.raw({ type: 'application/octet-stream', limit: '25mb' }),
    async (req: Request, res: Response) => {
      const auth = await getValidAccessToken(req);
      if (!auth) return res.status(401).json({ error: 'UNAUTHORIZED' });

      const parentId = decodeURIComponent(String(req.header('X-Parent-Id') || 'root'));
      const rawFilename = decodeURIComponent(String(req.header('X-File-Name') || `photo_${Date.now()}.jpg`));
      const safeFilename = rawFilename.replace(/[\\/:*?"<>|]/g, '_');

      const buffer = req.body as Buffer;
      if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return res.status(400).json({ error: 'EMPTY_FILE' });
      }

      const contentType = String(req.header('X-Content-Type') || 'image/jpeg');

      // Simple upload for files up to 4 MB
      if (buffer.length <= 4 * 1024 * 1024) {
        const uploadUrl =
          parentId === 'root'
            ? `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(safeFilename)}:/content?@microsoft.graph.conflictBehavior=rename`
            : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(safeFilename)}:/content?@microsoft.graph.conflictBehavior=rename`;

        const graphRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${auth.token}`,
            'Content-Type': contentType,
          },
          body: new Uint8Array(buffer),
        });

        if (!graphRes.ok) {
          const errBody = await graphRes.text();
          return res.status(graphRes.status).json({ error: 'UPLOAD_FAILED', details: errBody });
        }

        const item = await graphRes.json();
        return res.status(201).json({ item });
      }

      // Resumable upload session for photos > 4 MB
      const sessionEndpoint =
        parentId === 'root'
          ? `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(safeFilename)}:/createUploadSession`
          : `https://graph.microsoft.com/v1.0/me/drive/items/${encodeURIComponent(parentId)}:/${encodeURIComponent(safeFilename)}:/createUploadSession`;

      const sessionRes = await fetch(sessionEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          item: {
            '@microsoft.graph.conflictBehavior': 'rename',
            name: safeFilename,
          },
        }),
      });

      if (!sessionRes.ok) {
        const errBody = await sessionRes.text();
        return res.status(sessionRes.status).json({ error: 'UPLOAD_SESSION_FAILED', details: errBody });
      }

      const { uploadUrl } = (await sessionRes.json()) as { uploadUrl: string };
      const chunkSize = 320 * 1024 * 10; // ~3.2MB (multiple of 320 KiB as required by MS Graph)
      let offset = 0;
      let finalItem: unknown = null;

      while (offset < buffer.length) {
        const end = Math.min(offset + chunkSize, buffer.length);
        const chunk = buffer.subarray(offset, end);

        const chunkRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Length': String(chunk.length),
            'Content-Range': `bytes ${offset}-${end - 1}/${buffer.length}`,
          },
          body: new Uint8Array(chunk),
        });

        if (!chunkRes.ok && chunkRes.status !== 202) {
          const errBody = await chunkRes.text();
          return res.status(chunkRes.status).json({ error: 'CHUNK_UPLOAD_FAILED', details: errBody });
        }

        if (chunkRes.status === 200 || chunkRes.status === 201) {
          finalItem = await chunkRes.json();
        }
        offset = end;
      }

      return res.status(201).json({ item: finalItem });
    }
  );

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
