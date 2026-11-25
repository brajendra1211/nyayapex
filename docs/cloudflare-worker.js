// Cloudflare Worker that relays Nyay Apex's WhatsApp calls to abwpl.com.
// Needed because the hosting network blocks the server from reaching abwpl's IP directly.
// Only these four paths are forwarded; the API key comes from the Nyay Apex server in the X-API-Key header.
const ROUTES = {
  "POST /send": "https://abwpl.com/api/public/otp/send",
  "POST /verify": "https://abwpl.com/api/public/otp/verify",
  "POST /messages/send": "https://abwpl.com/api/public/messages/send",
  "GET /messages/templates": "https://abwpl.com/api/public/messages/templates",
};

export default {
  async fetch(request) {
    const target = ROUTES[`${request.method} ${new URL(request.url).pathname}`];
    if (!target) return new Response("Not found", { status: 404 });
    const key = request.headers.get("X-API-Key");
    if (!key) return new Response("Missing key", { status: 401 });

    return fetch(target, {
      method: request.method,
      headers: { "X-API-Key": key, "Content-Type": "application/json" },
      body: request.method === "POST" ? await request.text() : undefined,
    });
  },
};
