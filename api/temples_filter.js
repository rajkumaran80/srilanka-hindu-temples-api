import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);
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
