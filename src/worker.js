import { MongoClient } from "mongodb";

const uri = "mongodb+srv://srilanka_temples_admin:srilanka_temples_admin123@srilanka-cluster.6k82w97.mongodb.net/hindu-temples?retryWrites=true&w=majority";

let client;

export default {
  async fetch(request, env, ctx) {
    if (!client) {
      client = new MongoClient(uri);
      await client.connect();
    }

    const db = client.db("hindu-temples");
    const temples = await db.collection("temples").find().toArray();

    return new Response(JSON.stringify(temples), {
      headers: { "Content-Type": "application/json" },
    });
  },
};
