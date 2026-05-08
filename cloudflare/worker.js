function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(origin)
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/browserfetch") {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = "/browserfetch.html";
      return env.ASSETS.fetch(new Request(assetUrl.toString(), request));
    }

    if (url.pathname === "/api/generate") {
      const origin = request.headers.get("Origin") || "*";

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }

      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, origin);
      }

      if (!env.GROQ_API_KEY) {
        return json(
          {
            error:
              "Missing GROQ_API_KEY secret in Cloudflare Worker. Add it in Worker Settings > Variables and Secrets."
          },
          500,
          origin
        );
      }

      let body;
      try {
        body = await request.json();
      } catch (_e) {
        return json({ error: "Invalid JSON body" }, 400, origin);
      }

      const prompt = String(body.prompt || "").trim();
      const model = String(body.model || "llama-3.1-8b-instant").trim();

      if (!prompt) {
        return json({ error: "prompt is required" }, 400, origin);
      }

      try {
        const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7,
            stream: false
          })
        });

        const payload = await upstream.json();

        if (!upstream.ok) {
          return json(
            {
              error: "Groq request failed",
              status: upstream.status,
              details: payload
            },
            upstream.status,
            origin
          );
        }

        const text =
          payload &&
          payload.choices &&
          payload.choices[0] &&
          payload.choices[0].message &&
          typeof payload.choices[0].message.content === "string"
            ? payload.choices[0].message.content
            : "";

        return json(
          {
            response: text,
            model,
            provider: "groq"
          },
          200,
          origin
        );
      } catch (err) {
        return json(
          {
            error: "Upstream request error",
            details: String(err && err.message ? err.message : err)
          },
          502,
          origin
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};
