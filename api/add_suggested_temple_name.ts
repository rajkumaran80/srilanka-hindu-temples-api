import { MongoClient, Db } from "mongodb";

// Define interfaces for the API
interface SuggestedNameData {
  templeId: string;
  suggestedName: string;
  created_at?: Date;
}

interface TempleDocument {
  _id?: {
    $oid: string;
  };
  id?: string;
  osm_id?: number;
  suggestedNames?: SuggestedNameData[];
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  console.log('Add Suggested Temple Name API handler called');
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
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }

    const { templeId, suggestedName } = requestBody;

    // Validate required fields
    if (!templeId) {
      console.log('Missing templeId');
      return res.status(400).json({ error: 'templeId is required' });
    }

    if (!suggestedName || suggestedName.trim() === '') {
      console.log('Missing or empty suggestedName');
      return res.status(400).json({ error: 'suggestedName is required and cannot be empty' });
    }

    console.log(`Adding suggested name for temple: ${templeId}`);

    // Create suggested name object
    const newSuggestedName: SuggestedNameData = {
      templeId,
      suggestedName: suggestedName.trim(),
      created_at: new Date(),
    };

    // Add suggested name to temple document
    const updateResult = await (db.collection("temples") as any).updateOne(
      {
        $or: [
          { id: templeId },
          { osm_id: isNaN(parseInt(templeId)) ? undefined : parseInt(templeId) }
        ].filter(condition => condition !== undefined)
      },
      {
        $push: { suggestedNames: newSuggestedName },
        $set: { updated_at: new Date() }
      }
    );

    if (updateResult.matchedCount === 0) {
      console.log(`Temple not found: ${templeId}`);
      return res.status(404).json({ error: 'Temple not found' });
    }

    if (updateResult.modifiedCount === 0) {
      console.log(`Failed to add suggested name for temple: ${templeId}`);
      return res.status(500).json({ error: 'Failed to add suggested name' });
    }

    console.log(`Suggested name added successfully for temple: ${templeId}`);
    console.log('Sending successful response');
    res.status(201).json({
      success: true,
      message: 'Suggested name added successfully',
      suggestedName: newSuggestedName
    });

  } catch (err: unknown) {
    console.error('==================== ERROR IN ADD SUGGESTED TEMPLE NAME API ====================');
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
