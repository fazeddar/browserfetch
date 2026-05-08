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

    if (url.pathname === "/proxy" || url.pathname === "/proxy/") {
      const target = url.searchParams.get("url") || url.searchParams.get("target");
      const origin = request.headers.get("Origin") || "*";

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      }

      if (!target) {
        return new Response(
          `<!DOCTYPE html>
<html><head><meta charset=utf-8><title>Proxy</title><style>
body{background:#11111b;color:#cdd6f4;font-family:monospace;padding:2em;margin:0}
.box{background:#1e1e2e;border:1px solid #313244;border-radius:10px;padding:1.5em;max-width:600px;margin:auto}
input{width:100%;padding:.6em;background:#181825;color:#cdd6f4;border:1px solid #45475a;border-radius:6px;font-family:inherit;font-size:1em;box-sizing:border-box}
button{margin-top:1em;padding:.6em 1.5em;background:#cba6f7;color:#1e1e2e;border:0;border-radius:6px;cursor:pointer;font-weight:bold}
button:hover{background:#b4befe}
</style></head><body>
<div class=box>
<h2 style=margin-top:0>Web Proxy</h2>
<form method=get>
<input type=text name=url placeholder="Enter URL to proxy..." required>
<button type=submit>Go</button>
</form>
</div>
</body></html>`,
          {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8", ...corsHeaders(origin) }
          }
        );
      }

      try {
        const targetUrl = new URL(target);
        const resp = await fetch(targetUrl.toString(), {
          method: request.method,
          headers: { "User-Agent": "Mozilla/5.0 (browserfetch proxy)" },
          redirect: "follow"
        });

        let body = await resp.text();
        const contentType = resp.headers.get("content-type") || "text/html";

        if (contentType.includes("text/html")) {
          const proxyBase = new URL(request.url).origin;
          body = body
            .replace(/href=["'](?!(?:https?:\/\/|data:|mailto:|#|\/\/))/g, `href="${proxyBase}/proxy?url=${targetUrl.origin}/`)
            .replace(/src=["'](?!(?:https?:\/\/|data:|#))/g, `src="${proxyBase}/proxy?url=${targetUrl.origin}/`)
            .replace(/action=["'](?!(?:https?:\/\/|data:))/g, `action="${proxyBase}/proxy?url=${targetUrl.origin}/`);
        }

        return new Response(body, {
          status: resp.status,
          headers: {
            "Content-Type": contentType,
            ...corsHeaders(origin)
          }
        });
      } catch (err) {
        return json(
          { error: "Proxy request failed", details: String(err && err.message ? err.message : err) },
          502,
          origin
        );
      }
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
