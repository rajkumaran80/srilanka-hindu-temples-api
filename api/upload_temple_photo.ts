// api/upload-photo.ts
// Vercel Serverless handler (TypeScript)
// Uploads photo into repo under temple folder named from DB (templename slug)

import { MongoClient, ObjectId } from 'mongodb';

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

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGODB_DB = process.env.MONGODB_DB || 'temples';
const MONGODB_COLLECTION = process.env.MONGODB_COLLECTION || 'temples';

const USER_AGENT = 'TemplePhotoUploader/1.0 (vercel)';

// canonical repo name: owner/repo
const REPO_FULL = ((): string => {
  if (!GITHUB_REPO) throw new Error('GITHUB_REPO env missing');
  if (GITHUB_REPO.includes('/')) return GITHUB_REPO;
  if (!GITHUB_OWNER) throw new Error('GITHUB_OWNER env missing while GITHUB_REPO lacks owner');
  return `${GITHUB_OWNER}/${GITHUB_REPO}`;
})();

// --- Mongo client reuse (recommended for serverless)
let cachedClient: MongoClient | null = null;
async function getMongoClient(): Promise<MongoClient> {
  if (!MONGODB_URI) throw new Error('MONGODB_URI env missing');
  if (cachedClient) return cachedClient;
  const c = new MongoClient(MONGODB_URI);
  await c.connect();
  cachedClient = c;
  return c;
}

function slugify(name: string) {
  return name
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniqueFileName(ext = 'jpg') {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}.${ext}`;
}

async function githubListFolder(path: string) {
  const url = `https://api.github.com/repos/${REPO_FULL}/contents/${path}?ref=${encodeURIComponent(
    GITHUB_BRANCH
  )}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GitHub list folder failed: ${res.status} ${txt}`);
  }
  return res.json();
}

async function githubUploadFile(path: string, contentBase64: string, message = 'Add temple photo') {
  const api = `https://api.github.com/repos/${REPO_FULL}/contents/${path}`;
  const payload: any = {
    message: typeof message === 'string' ? message : String(message),
    content: contentBase64,
    branch: GITHUB_BRANCH,
  };

  // Primary attempt: create/update in one PUT
  let res = await fetch(api, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'User-Agent': USER_AGENT,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text().catch(() => '');

  if (res.ok) {
    try {
      const j = JSON.parse(bodyText);
      return j.content?.path;
    } catch (e) {
      return null;
    }
  }

  // If we got conflict or need to update with sha, try GET -> PUT with sha
  if (res.status === 422 || res.status === 409 || res.status === 404) {
    const getRes = await fetch(`${api}?ref=${encodeURIComponent(GITHUB_BRANCH)}`, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    if (getRes.ok) {
      const getJson = await getRes.json();
      const sha = getJson.sha;
      payload.sha = sha;
      const updRes = await fetch(api, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          'User-Agent': USER_AGENT,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const updText = await updRes.text().catch(() => '');
      if (!updRes.ok) {
        throw new Error(`GitHub update failed: ${updRes.status} ${updText}`);
      }
      return JSON.parse(updText).content?.path;
    }
  }

  throw new Error(`GitHub upload failed: ${res.status} ${bodyText}`);
}

function extractBase64AndMime(input: string) {
  const dataUrlMatch = input.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (dataUrlMatch) {
    return { mime: dataUrlMatch[1], base64: dataUrlMatch[2] };
  }
  const sample = input.slice(0, 80);
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(sample)) {
    throw new Error('photo must be a base64 string or data URL');
  }
  return { mime: 'image/jpeg', base64: input.replace(/\r?\n/g, '') };
}

function parsePossibleObjectId(id: string) {
  // If looks like ObjectId hex (24 hex chars), return ObjectId, else return original string
  if (!id) return id;
  if (/^[a-fA-F0-9]{24}$/.test(id)) {
    try {
      return new ObjectId(id);
    } catch {
      return id;
    }
  }
  return id;
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

    if (!MONGODB_URI) {
      res.status(500).json({ ok: false, error: 'Server misconfigured: MONGODB_URI missing' });
      return;
    }

    // Parse request body - handle both string and object formats
    let requestBody: any;
    try {
      if (typeof req.body === 'string') {
        requestBody = req.body ? JSON.parse(req.body) : {};
      } else {
        requestBody = req.body || {};
      }
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      res.status(400).json({ ok: false, error: 'Invalid JSON in request body' });
      return;
    }

    const { templeId, photo } = requestBody;

    if (!templeId) {
      res.status(400).json({ ok: false, error: 'templeId is required' });
      return;
    }
    if (!photo || (typeof photo === 'string' && photo.trim() === '')) {
      res.status(400).json({ ok: false, error: 'photo is required and cannot be empty' });
      return;
    }

    // connect to mongo and fetch temple by id
    const client = await getMongoClient();
    const collection = client.db(MONGODB_DB).collection(MONGODB_COLLECTION);

    const queryId = parsePossibleObjectId(String(templeId));
    let templeDoc;
    if (queryId instanceof ObjectId) {
      templeDoc = await collection.findOne({ _id: queryId });
    } else {
      templeDoc = await collection.findOne({
        $or: [{ osm_id: Number(templeId) }, { 'tags.name': String(templeId) }],
      });
    }

    if (!templeDoc) {
      res.status(404).json({ ok: false, error: 'Temple not found in DB for provided templeId' });
      return;
    }

    // determine folder name from temple name (prefer templeDoc.name, then tags.name)
    const templeNameRaw = templeDoc.name || (templeDoc.tags && templeDoc.tags.name) || String(templeId);
    const folderName = slugify(templeNameRaw);
    const repoFolder = `${GITHUB_IMAGES_DIR}/${folderName}`;

    // parse base64 and mime
    let mime: string;
    let base64: string;
    try {
      const parsed = extractBase64AndMime(photo);
      mime = parsed.mime;
      base64 = parsed.base64;
    } catch (err: any) {
      res.status(400).json({ ok: false, error: err.message || 'Invalid photo data' });
      return;
    }

    const ext = mime.split('/').pop()?.replace('jpeg', 'jpg') || 'jpg';

    // ensure not exceeding configured max
    const list = await githubListFolder(repoFolder);
    const existingCount = Array.isArray(list) ? list.filter((f: any) => f.type === 'file').length : 0;
    if (existingCount >= MAX_PHOTOS_PER_TEMPLE) {
      res.status(400).json({ ok: false, error: `Max photos limit reached (${MAX_PHOTOS_PER_TEMPLE}) for this temple` });
      return;
    }

    const finalName = uniqueFileName(ext);
    const pathInRepo = `${repoFolder}/${finalName}`;

    console.log(`Uploading photo for temple ${templeId} (folder '${folderName}') to ${pathInRepo}...`);

    const uploadedPath = await githubUploadFile(
      pathInRepo,
      base64,
      `Add photo for ${templeNameRaw} (templeId=${templeId}) - ${finalName}`
    );
    if (!uploadedPath) throw new Error('Upload returned no path');

    const cdnUrl = `${CDN_BASE}${uploadedPath}`;

    // Update DB - add photo to unapproved_photos array
    await collection.updateOne({ _id: templeDoc._id }, { $push: { unapproved_photos: { url: cdnUrl, name: finalName, templeName: templeNameRaw } } } as any);

    res.status(200).json({ ok: true, path: uploadedPath, url: cdnUrl, folder: folderName, templeName: templeNameRaw });
  } catch (err: any) {
    console.error('upload-photo error:', err);
    const msg = err?.message || 'internal error';
    res.status(500).json({ ok: false, error: msg });
  }
}
