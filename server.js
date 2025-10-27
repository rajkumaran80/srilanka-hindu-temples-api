import express from 'express';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const app = express();

// Load environment variables
dotenv.config();

// Import the Vercel serverless functions
const templesHandler = (await import('./api/temples.js')).default;
const templesFilterHandler = (await import('./api/temples_filter.js')).default;

// Middleware to parse JSON
app.use(express.json());

// Helper function to convert Express req/res to Vercel format
function createVercelRequest(req) {
  return {
    method: req.method,
    headers: req.headers,
    body: req.body ? JSON.stringify(req.body) : null,
    query: req.query,
    url: req.url,
  };
}

function createVercelResponse(res) {
  return {
    status: (code) => ({
      json: (data) => res.status(code).json(data),
      end: () => res.status(code).end(),
    }),
    json: (data) => res.json(data),
    status: (code) => res.status(code),
  };
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'Sri Lanka Hindu Temples API is running locally' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 Sri Lanka Hindu Temples API running locally on http://localhost:${PORT}`);
  console.log(`📚 API endpoints:`);
  console.log(`   GET /api/temples`);
  console.log(`   GET /api/temples_filter?district=<district>`);
  console.log(`   GET /health`);
});
