import { MongoClient } from "mongodb";

// Global variable to cache the MongoDB client for reuse between function calls
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGODB_URI) {
  throw new Error('Please define the MONGO_URI or MONGODB_URI environment variable inside .env or Vercel environment variables');
}

let cachedClient = null;
let cachedDb = null;

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

export default async function handler(req, res) {
    try {
        const { limit, north, south, east, west } = req.query;

        let query: any = {};
        let queryLimit = limit ? parseInt(limit as string) : undefined;

        // If geographic bounds are provided, filter by them
        if (north && south && east && west) {
            query.latitude = {
                $gte: parseFloat(south as string),
                $lte: parseFloat(north as string)
            };
            query.longitude = {
                $gte: parseFloat(west as string),
                $lte: parseFloat(east as string)
            };
        }

        let templesQuery = Temple.find(query);

        // Sort by some criteria (could be rating, or just by ID for consistency)
        templesQuery = templesQuery.sort({ _id: -1 });

        // Apply limit if specified
        if (queryLimit) {
            templesQuery = templesQuery.limit(queryLimit);
        }

        const temples = await templesQuery;

        res.status(200).json(temples);
    } catch (error) {
        console.error('Error searching temples:', error);
        res.status(500).json({ message: 'Server error' });
    }
};
