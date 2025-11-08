import { MongoClient, Db } from "mongodb";

// Define interfaces for the API
interface TempleDocument {
  _id?: {
    $oid: string;
  };
  id?: string;
  osm_id?: number;
  name?: string;
  temple_name?: string;
  unapproved_photos?: string[];
  updated_at?: Date;
  [key: string]: any;
}

interface StatusResponse {
  json: (data: any) => void;
  end: () => void;
}

interface VercelResponse {
  status: (code: number) => StatusResponse;
  json: (data: any) => void;
  headersSent?: boolean;
}

interface VercelRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string | any;
  query: Record<string, string | any>;
  url: string;
}

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'rajkumaran80';
const GITHUB_REPO = process.env.GITHUB_REPO || 'srilanka-hindu-temples-photos';
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const GITHUB_IMAGES_DIR = process.env.GITHUB_IMAGES_DIR || 'temples_photos';
const CDN_BASE = process.env.CDN_BASE || 'https://cdn.jsdelivr.net/gh/rajkumaran80/srilanka-hindu-temples-photos@main/';
const MAX_PHOTOS_PER_TEMPLE = parseInt(process.env.MAX_PHOTOS_PER_TEMPLE || '5');

if (!GITHUB_TOKEN) {
  throw new Error('GITHUB_TOKEN environment variable is required for photo uploads');
}

// Global variable to cache the MongoDB client for reuse between function calls
const MONGODB_URI: string = process.env.MONGODB_URI!;
const DATABASE: string = process.env.DATABASE!;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGO_URI or MONGODB_URI environment variable inside .env or Vercel environment variables');
}

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

async function connectToDatabase() {
  console.log('Connecting to database...');

  if (cachedClient && cachedDb) {
    console.log('Using cached MongoDB connection');
    return { client: cachedClient, db: cachedDb };
  }

  console.log('Creating new MongoDB connection');

  const client = new MongoClient(MONGODB_URI, {
    maxPoolSize: 10, // Maintain up to 10 connections
    serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  });

  console.log('Attempting to connect to MongoDB...');
  await client.connect();
  console.log('MongoDB connection established');

  const db = client.db(DATABASE);
  console.log(`Using database: ${DATABASE}`);

  cachedClient = client;
  cachedDb = db;

  console.log('Connection cached for reuse');
  return { client, db };
}

// Helper function to upload file to GitHub
async function uploadToGitHub(fileBuffer: Buffer, fileName: string, folderName: string): Promise<boolean> {
  try {
    const path = `${GITHUB_IMAGES_DIR}/${folderName}/${fileName}`;

    // First, get the current file (if it exists) to get its SHA
    let sha = '';
    try {
      const getResponse = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
        headers: {
          'Authorization': `token ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (getResponse.ok) {
        const fileData = await getResponse.json();
        sha = fileData.sha;
      }
    } catch (error) {
      // File doesn't exist, which is fine for new uploads
      console.log(`File ${path} doesn't exist, will create new`);
    }

    // Convert buffer to base64
    const content = fileBuffer.toString('base64');

    // Prepare the request body
    const requestBody: any = {
      message: `Upload temple photo: ${fileName}`,
      content: content,
      branch: GITHUB_BRANCH,
    };

    if (sha) {
      requestBody.sha = sha; // Include SHA if updating existing file
    }

    // Upload/create the file
    const response = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('GitHub upload failed:', errorData);
      return false;
    }

    console.log(`Successfully uploaded ${fileName} to ${path}`);
    return true;
  } catch (error) {
    console.error('Error uploading to GitHub:', error);
    return false;
  }
}

// Helper function to sanitize filename
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  console.log('Upload Temple Photo API handler called');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);

  // Set CORS headers for Vercel deployment
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request');
    return res.status(200).json({});
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    console.log('Method not allowed:', req.method);
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  try {
    console.log('Checking environment variables...');
    // Check if environment variable is defined
    const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!MONGO_URI) {
      console.error('MONGO_URI environment variable is not defined');
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    console.log('Environment variable check passed');
    console.log('Connecting to database...');
    const { db } = await connectToDatabase();

    // For Vercel, we need to handle multipart form data differently
    // This is a simplified version - in production, you'd use a proper multipart parser
    console.log('Processing file upload request...');

    // In a real implementation, you'd parse the multipart form data here
    // For now, we'll expect the data to be passed in a specific format
    let requestBody: any = {};

    try {
      if (typeof req.body === 'string') {
        requestBody = JSON.parse(req.body);
      } else {
        requestBody = req.body || {};
      }
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return res.status(400).json({ error: 'Invalid request format. Expected JSON with templeId and photo data.' });
    }

    const { templeId, photo } = requestBody;

    // Validate required fields
    if (!templeId) {
      console.log('Missing templeId');
      return res.status(400).json({ error: 'templeId is required' });
    }

    if (!photo || !photo.data || !photo.filename) {
      console.log('Missing or invalid photo data');
      return res.status(400).json({ error: 'photo object with data and filename is required' });
    }

    console.log(`Processing 1 photo for temple: ${templeId}`);

    // Find the temple
    const temple = await db.collection<TempleDocument>("temples").findOne({
      $or: [
        { id: templeId },
        { osm_id: isNaN(parseInt(templeId)) ? undefined : parseInt(templeId) }
      ].filter(condition => condition !== undefined)
    });

    if (!temple) {
      console.log(`Temple not found: ${templeId}`);
      return res.status(404).json({ error: 'Temple not found' });
    }

    // Get temple name for folder creation
    const templeName = temple.temple_name || temple.name || `temple_${templeId}`;
    const sanitizedTempleName = sanitizeFileName(templeName.replace(/\s+/g, '_'));

    // Check current unapproved photos count
    const currentUnapprovedCount = temple.unapproved_photos ? temple.unapproved_photos.length : 0;
    if (currentUnapprovedCount >= MAX_PHOTOS_PER_TEMPLE) {
      console.log(`Temple already has max photos. Current: ${currentUnapprovedCount}, Max: ${MAX_PHOTOS_PER_TEMPLE}`);
      return res.status(400).json({
        error: `Temple already has ${currentUnapprovedCount} unapproved photos. Maximum ${MAX_PHOTOS_PER_TEMPLE} photos allowed.`
      });
    }

    const uploadedFiles: string[] = [];
    const failedUploads: string[] = [];

    // Process the single photo
    try {
      // Convert base64 to buffer if needed
      let fileBuffer: Buffer;
      if (typeof photo.data === 'string' && photo.data.startsWith('data:')) {
        // Handle base64 data URL
        const base64Data = photo.data.split(',')[1];
        fileBuffer = Buffer.from(base64Data, 'base64');
      } else if (typeof photo.data === 'string') {
        // Assume base64
        fileBuffer = Buffer.from(photo.data, 'base64');
      } else {
        // Assume it's already a buffer
        fileBuffer = Buffer.from(photo.data);
      }

      // Generate filename: templeName_001.jpg, templeName_002.jpg, etc.
      const fileExt = photo.filename.split('.').pop() || 'jpg';
      const sequenceNumber = String(currentUnapprovedCount + 1).padStart(3, '0');
      const fileName = `${sanitizedTempleName}_${sequenceNumber}.${fileExt}`;

      // Upload to GitHub
      const uploadSuccess = await uploadToGitHub(fileBuffer, fileName, sanitizedTempleName);

      if (uploadSuccess) {
        uploadedFiles.push(fileName);
        console.log(`Uploaded photo: ${fileName}`);
      } else {
        failedUploads.push('photo: upload failed');
        console.log(`Failed to upload photo: ${fileName}`);
      }

    } catch (error) {
      console.error('Error processing photo:', error);
      failedUploads.push('photo: processing error');
    }

    if (uploadedFiles.length === 0) {
      console.log('No photos were successfully uploaded');
      return res.status(500).json({
        error: 'Failed to upload any photos',
        failedUploads
      });
    }

    // Update temple document with uploaded filenames
    const updateResult = await (db.collection("temples") as any).updateOne(
      {
        $or: [
          { id: templeId },
          { osm_id: isNaN(parseInt(templeId)) ? undefined : parseInt(templeId) }
        ].filter(condition => condition !== undefined)
      },
      {
        $push: { unapproved_photos: { $each: uploadedFiles } },
        $set: { updated_at: new Date() }
      }
    );

    if (updateResult.modifiedCount === 0) {
      console.log(`Failed to update temple with uploaded photos: ${templeId}`);
      return res.status(500).json({ error: 'Failed to update temple record' });
    }

    console.log(`Successfully uploaded ${uploadedFiles.length} photos for temple: ${templeId}`);
    console.log('Sending successful response');

    res.status(201).json({
      success: true,
      message: `Successfully uploaded ${uploadedFiles.length} photos`,
      uploadedFiles,
      failedUploads: failedUploads.length > 0 ? failedUploads : undefined,
      templeId,
      templeName: templeName
    });

  } catch (err: unknown) {
    console.error('==================== ERROR IN UPLOAD TEMPLE PHOTO API ====================');
    const error = err as any; // Type assertion for error handling
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    console.error('Error code:', error?.code);
    console.error('MONGO_URI exists:', !!process.env.MONGO_URI);
    console.error('MONGODB_URI exists:', !!process.env.MONGODB_URI);
    console.error('===================================================================');

    // Make sure we always return a proper HTTP response
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
