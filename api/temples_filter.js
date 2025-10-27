import { MongoClient } from "mongodb";

const MONGO_URI="mongodb+srv://cloudflare-user:StrongPass123!@srilanka-cluster.6k82w97.mongodb.net/hindu-temples?retryWrites=true&w=majority"
const client = new MongoClient(MONGO_URI);
let db;

async function getDB() {
  if (!db) {
    await client.connect();
    db = client.db("hindu-temples");
  }
  return db;
}

export default async function handler(req, res) {
  const { district } = req.query;
  try {
    const db = await getDB();
    const temples = await db
      .collection("temples")
      .find(district ? { district } : {})
      .toArray();
    res.status(200).json(temples);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
