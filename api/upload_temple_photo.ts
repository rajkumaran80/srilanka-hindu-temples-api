// api/upload-photo.ts
// Vercel Serverless handler (TypeScript)
// Deploy this to /api/upload-photo on Vercel
//
// Request JSON:
// { "templeId": "string", "photo": "data:<mime>;base64,<data>" | "<base64>", "filename?" }
//
// Response JSON:
// { ok: true, url: "<cdn url>", path: "<repo path>" } on success
// { ok: false, error: "message" } on error
//
// Env required:
// - GITHUB_TOKEN
// - GITHUB_OWNER (default 'rajkumaran80')
// - GITHUB_REPO (default 'srilanka-hindu-temples-photos')
// - GITHUB_BRANCH (default 'main')
// - GITHUB_IMAGES_DIR (default 'temple_photos')
// - CDN_BASE (default computed from owner/repo/branch)
// - MAX_PHOTOS_PER_TEMPLE (default 5)

// Removed external dependencies to match project structure

interface StatusResponse {
  json: (data: any) => void;
  end: () => void;
}

interface VercelResponse {
  status: (code: number) => StatusResponse;
  json: (data: any) => void;
  headersSent?: boolean;
  setHeader: (name: string, value: string) => void;
}

interface VercelRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string | any;
  query: Record<string, string | any>;
  url: string;
}

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'rajkumaran80';
const GITHUB_REPO = process.env.GITHUB_REPO || 'srilanka-hindu-temples-photos';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_IMAGES_DIR = process.env.GITHUB_IMAGES_DIR || 'temple_photos';
const CDN_BASE =
  process.env.CDN_BASE ||
  `https://cdn.jsdelivr.net/gh/${GITHUB_OWNER}/${GITHUB_REPO}@${GITHUB_BRANCH}/`;
const MAX_PHOTOS_PER_TEMPLE = parseInt(process.env.MAX_PHOTOS_PER_TEMPLE || '5', 10);

const USER_AGENT = 'TemplePhotoUploader/1.0 (vercel)';

if (!GITHUB_TOKEN) {
  // When running locally this will throw at import time; Vercel will have env set.
  // But to be safe, we still allow import; we'll error at runtime if missing.
}

function slugify(name: string) {
  return name
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniqueFileName(base: string, ext = 'jpg') {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${ts}-${rand}.${ext}`;
}

async function githubListFolder(path: string) {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
    path
  )}?ref=${encodeURIComponent(GITHUB_BRANCH)}`;
  const res = await fetch(url, {
    headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': USER_AGENT },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GitHub list folder failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function githubUploadFile(path: string, contentBase64: string, message = 'Add temple photo') {
  const api = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodeURIComponent(
    path
  )}`;
  const payload: any = {
    message,
    content: contentBase64,
    branch: GITHUB_BRANCH,
  };

  // Try create/update in one step (PUT). If conflict/422, attempt to fetch sha and retry.
  let res = await fetch(api, {
    method: 'PUT',
    headers: {
      Authorization: `token ${GITHUB_TOKEN}`,
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (res.ok) {
    const j = await res.json();
    return j.content?.path;
  }

  // handle possible conflict/update
  if (res.status === 422 || res.status === 409) {
    const getRes = await fetch(api + `?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
      headers: { Authorization: `token ${GITHUB_TOKEN}`, 'User-Agent': USER_AGENT },
    });
    if (getRes.ok) {
      const body = await getRes.json();
      const sha = body.sha;
      payload.sha = sha;
      const upd = await fetch(api, {
        method: 'PUT',
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      if (!upd.ok) {
        const t = await upd.text().catch(() => '');
        throw new Error(`GitHub update failed: ${upd.status} ${t}`);
      }
      const j2 = await upd.json();
      return j2.content?.path;
    }
  }

  const txt = await res.text().catch(() => '');
  throw new Error(`GitHub upload failed: ${res.status} ${txt}`);
}

function extractBase64AndMime(input: string) {
  // Accept either data:<mime>;base64,<data> OR plain base64
  const dataUrlMatch = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (dataUrlMatch) {
    return { mime: dataUrlMatch[1], base64: dataUrlMatch[2] };
  }
  // assume plain base64; we cannot detect mime reliably — default to jpeg
  // Basic sanity check (short)
  const sample = input.slice(0, 80);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(sample)) {
    throw new Error('photo must be a base64 string or data URL');
  }
  return { mime: 'image/jpeg', base64: input.replace(/\r?\n/g, '') };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      res.status(405).json({ ok: false, error: 'Method not allowed, use POST' });
      return;
    }

    if (!GITHUB_TOKEN) {
      res.status(500).json({ ok: false, error: 'Server misconfigured: GITHUB_TOKEN missing' });
      return;
    }

    const body = req.body ?? {};
    const templeId = body.templeId || body.temple_id || body.temple; // accept some variants
    const photoRaw = body.photo;
    const filenameProvided = body.filename || body.name;

    if (!templeId) {
      res.status(400).json({ ok: false, error: 'templeId is required' });
      return;
    }
    if (!photoRaw) {
      res.status(400).json({ ok: false, error: 'photo (base64 or data URL) is required' });
      return;
    }

    // parse base64 and mime
    let mime: string;
    let base64: string;
    try {
      const parsed = extractBase64AndMime(photoRaw);
      mime = parsed.mime;
      base64 = parsed.base64;
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message || 'Invalid photo data' });
      return;
    }

    // decide extension
    const ext = mime.split('/').pop()?.replace('jpeg', 'jpg') || 'jpg';

    // slugify folder and filename base
    const folder = slugify(String(templeId));
    const repoFolder = `${GITHUB_IMAGES_DIR}/${folder}`;

    // ensure not exceeding configured max
    const list = await githubListFolder(repoFolder);
    const existingCount = Array.isArray(list) ? list.filter((f: any) => f.type === 'file').length : 0;
    if (existingCount >= MAX_PHOTOS_PER_TEMPLE) {
      res.status(400).json({ ok: false, error: `Max photos limit reached (${MAX_PHOTOS_PER_TEMPLE}) for this temple` });
      return;
    }

    const baseName = filenameProvided
      ? slugify(String(filenameProvided).replace(/\.[^/.]+$/, ''))
      : slugify(`${templeId}-photo`);
    const finalName = uniqueFileName(baseName, ext);
    const pathInRepo = `${repoFolder}/${finalName}`;

    // Upload to GitHub (content must be base64 without data URL header)
    const uploadedPath = await githubUploadFile(pathInRepo, base64, `Add photo for temple ${templeId} - ${finalName}`);
    if (!uploadedPath) throw new Error('Upload returned no path');

    const cdnUrl = `${CDN_BASE}${uploadedPath}`;

    res.status(200).json({ ok: true, path: uploadedPath, url: cdnUrl });
  } catch (err: any) {
    console.error('upload-photo error:', err);
    const msg = err?.message || 'internal error';
    res.status(500).json({ ok: false, error: msg });
  }
}
