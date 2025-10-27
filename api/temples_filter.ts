import { MongoClient, Db } from "mongodb";

// Define interfaces for the API
interface TempleDocument {
  _id?: string;
  name?: string;
  location?: string;
  district?: string;
  description?: string;
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
  body: string | null;
  query: Record<string, string | any>;
  url: string;
}

// Global variable to cache the MongoDB client for reuse between function calls
const MONGODB_URI: string = process.env.MONGO_URI || process.env.MONGODB_URI || '';

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

  const db = client.db("hindu-temples");
  console.log(`Using database: hindu-temples`);

  cachedClient = client;
  cachedDb = db;

  console.log('Connection cached for reuse');
  return { client, db };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const { district } = req.query as { district?: string };

  console.log('Temples Filter API handler called');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);
  console.log('Request query params:', req.query);

  try {
    console.log('Checking environment variables...');
    // Check if environment variable is defined
    const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!MONGODB_URI) {
      console.error('MONGO_URI environment variable is not defined');
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    console.log('Environment variable check passed');
    console.log('Connecting to database...');
    const { db } = await connectToDatabase();

    console.log(`Querying temples collection with district filter: ${district || 'none'}`);
    const query = district ? { district } : {};
    console.log('MongoDB query:', JSON.stringify(query));

    const temples = await db.collection("temples").find(query).toArray();

    console.log(`Found ${temples.length} temples for district: ${district || 'all'}`);
    console.log('Sending successful response');
    res.status(200).json(temples);
  } catch (err: unknown) {
    console.error('==================== ERROR IN TEMPLE FILTER API ====================');
    const error = err as any; // Type assertion for error handling
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    console.error('Error code:', error?.code);
    console.error('Request query district:', district);
    console.error('MONGO_URI exists:', !!process.env.MONGO_URI);
    console.error('MONGODB_URI exists:', !!process.env.MONGODB_URI);
    console.error('===================================================================');

    // Make sure we always return a proper HTTP response
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}
