import { MongoClient, Db } from "mongodb";

// Define interfaces for the API
interface TempleDocument {
  _id?: {
    $oid: string;
  };
  id?: string;
  osm_id?: number;
  added_at?: {
    $date: string;
  };
  latitude?: number;
  longitude?: number;
  name?: string;
  temple_name?: string;
  location?: string;
  osm_type?: string;
  photos?: string[];
  source?: string;
  tags?: {
    amenity?: string;
    check_date?: string;
    name?: string;
    religion?: string;
    [key: string]: any;
  };
  [key: string]: any;
}

interface Temple {
  _id?: string;
  id?: string;
  osm_id?: number;
  name?: string;
  location?: string;
  district?: string;
  latitude?: number;
  longitude?: number;
  photos?: string[];
  description?: string;
  [key: string]: any;
}

// Helper function to extract ID from MongoDB document
function extractId(doc: TempleDocument): string {
  if (doc.id) return doc.id;
  if (doc._id) {
    if (typeof doc._id === 'string') return doc._id;
    if (doc._id.$oid) return doc._id.$oid;
  }
  // Fallback to osm_id as string if no other ID is available
  return doc.osm_id?.toString() || 'unknown';
}

// Helper function to build location string from address components
function buildLocationString(doc: TempleDocument): string {
  const components: string[] = [];

  // Add suburb if available
  if (doc.suburb) {
    components.push(doc.suburb);
  }

  // Add village if available
  if (doc.village) {
    components.push(doc.village);
  }

  // Add district if available
  if (doc.district) {
    components.push(doc.district);
  }

  // Add city if available and no other components
  if (components.length === 0 && doc.tags?.['addr:city']) {
    components.push(doc.tags['addr:city']);
  }

  // If no address components found, use the location field or fallback
  if (components.length === 0) {
    return doc.location || doc.tags?.name || doc.name || 'Unknown Location';
  }

  return components.join(', ');
}

// Function to convert TempleDocument to Temple
function convertTempleDocumentToTemple(doc: TempleDocument): Temple {
  const id = extractId(doc);
  return {
    _id: id,
    id: id,
    osm_id: doc.osm_id,
    name: doc.temple_name || doc.name,
    location: buildLocationString(doc),
    district: undefined, // Can be derived from location or added later
    latitude: doc.latitude,
    longitude: doc.longitude,
    photos: doc.photos,
    description: `OSM ID: ${doc.osm_id}, Type: ${doc.osm_type}, Source: ${doc.source}`,
  };
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
  console.log('Temples Initial API handler called');
  console.log('Request method:', req.method);
  console.log('Request URL:', req.url);

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

    console.log('Querying temples collection with level 1 filter and excluding unnamed temples...');
    const templeDocuments: TempleDocument[] = await db.collection<TempleDocument>("temples").find({
      level: 1,
      name: { $not: { $regex: '^unnamed', $options: 'i' } }
    }).toArray();

    console.log(`Found ${templeDocuments.length} temple documents`);
    console.log('Converting to Temple format...');
    const temples: Temple[] = templeDocuments.map(convertTempleDocumentToTemple);

    console.log(`Converted ${temples.length} temples`);
    console.log('Sending successful response');
    res.status(200).json(temples);
  } catch (err: unknown) {
    console.error('==================== ERROR IN TEMPLE INITIAL API ====================');
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
