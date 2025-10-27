export default {
  async fetch(request, env, ctx) {
    try {
      const res = await fetch(env.BACKEND_URL + "/temples");
      const temples = await res.json();

      return new Response(JSON.stringify(temples), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  },
};
