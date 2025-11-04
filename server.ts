import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import cors from "cors";


// Load environment variables
dotenv.config();

const app: express.Application = express();

// Middleware to parse JSON
app.use(express.json());

// CORS configuration
// Allow origin set via CORS_ORIGIN env var or allow all by default for local development
const corsOptions: cors.CorsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // credentials: true, // uncomment if your frontend needs cookies/auth with credentials
};

// Enable CORS for all routes
app.use(cors(corsOptions));
// Enable pre-flight for all routes
app.options('*', cors(corsOptions));

// Vercel serverless function types
interface VercelRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
  body: string | null;
  query: Record<string, string | any>;
  url: string;
}

interface VercelResponse {
  status: (code: number) => {
    json: (data: any) => void;
    end: () => void;
  };
  json: (data: any) => void;
}

type VercelHandler = (req: VercelRequest, res: VercelResponse) => Promise<void> | void;

// Import the Vercel serverless functions
const templesHandler: VercelHandler = (await import('./api/temples.js')).default;
const templesFilterHandler: VercelHandler = (await import('./api/temples_filter.js')).default;
const templesInitialHandler: VercelHandler = (await import('./api/temples_initial.js')).default;
const templesSearchHandler: VercelHandler = (await import('./api/temples_search.js')).default;

// Helper function to convert Express req/res to Vercel format
function createVercelRequest(req: Request): VercelRequest {
  return {
    method: req.method,
    headers: req.headers,
    body: req.body ? JSON.stringify(req.body) : null,
    query: req.query,
    url: req.url,
  };
}

function createVercelResponse(res: Response): VercelResponse {
  const vercelRes: VercelResponse = {
    status: (code: number) => ({
      json: (data: any) => res.status(code).json(data),
      end: () => res.status(code).end(),
    }),
    json: (data: any) => res.json(data),
  };
  return vercelRes;
}

// Routes that mimic Vercel API routes
app.get('/api/temples', (req, res) => {
  const vercelReq = createVercelRequest(req);
  const vercelRes = createVercelResponse(res);
  templesHandler(vercelReq, vercelRes);
});

app.get('/api/temples_filter', (req, res) => {
  const vercelReq = createVercelRequest(req);
  const vercelRes = createVercelResponse(res);
  templesFilterHandler(vercelReq, vercelRes);
});

app.get('/api/temples_initial.ts', (req, res) => {
  const vercelReq = createVercelRequest(req);
  const vercelRes = createVercelResponse(res);
  templesInitialHandler(vercelReq, vercelRes);
});

app.get('/api/temples_search.ts', (req, res) => {
  const vercelReq = createVercelRequest(req);
  const vercelRes = createVercelResponse(res);
  templesSearchHandler(vercelReq, vercelRes);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Sri Lanka Hindu Temples API is running locally' });
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`🚀 Sri Lanka Hindu Temples API running locally on http://localhost:${PORT}`);
  console.log(`📚 API endpoints:`);
  console.log(`   GET /api/temples - Get all temples`);
  console.log(`   GET /api/temples_filter?district=<district> - Filter temples by district`);
  console.log(`   GET /api/temples_initial - Get first 5 temples`);
  console.log(`   GET /api/temples_search?north=&south=&east=&west=&limit= - Search by geographic bounds`);
  console.log(`   GET /health - Health check`);
});
