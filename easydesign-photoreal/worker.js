/**
 * EasyRack EasyDesign photoreal render endpoint.
 * Cloudflare Worker module.
 * Required secret: OPENAI_API_KEY
 */
const ALLOWED_ORIGINS = new Set([
  "https://www.easyrack.net",
  "https://easyrack.net",
]);

function cors(origin) {
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : "https://www.easyrack.net";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...cors(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function dataUrlToBlob(dataUrl, fallbackType = "image/jpeg") {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    throw new Error("Invalid image data URL.");
  }
  const comma = dataUrl.indexOf(",");
  if (comma < 0) throw new Error("Malformed image data URL.");
  const header = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  const match = /^data:([^;]+);base64$/i.exec(header);
  const mime = match ? match[1] : fallbackType;
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function finite(n, fallback = 0) {
  n = Number(n);
  return Number.isFinite(n) ? n : fallback;
}

function buildPrompt(body) {
  const w = body.warehouse || {};
  const d = body.design || {};
  const beams = d.beamBreakdown || {};
  const beamText = Object.keys(beams)
    .sort((a, b) => Number(a) - Number(b))
    .map((k) => `${k}mm beams: ${beams[k]}`)
    .join(", ");

  return `
Create one highly photorealistic wide-angle commercial warehouse photograph based on the supplied EasyDesign reference images.

REFERENCE PRIORITY:
- Image 1 is the main perspective geometry reference.
- Image 2, if supplied, is the birdseye layout reference.
- Preserve the customer's rack geometry as closely as possible.
- Do not invent a different rack layout.

RACKING:
- Industrial blue perforated steel uprights with realistic base plates.
- Bright safety-orange pallet beams with realistic beam profiles and end connectors.
- Galvanised grey diagonal and horizontal frame bracing.
- Preserve the same relative rack-run count, orientation, spacing and aisle positions.
- Preserve the approximate storage-level count shown by the EasyDesign geometry.

CUSTOMER DESIGN DATA:
- Warehouse: ${finite(w.lengthM)}m long x ${finite(w.widthM)}m wide x ${finite(w.heightM)}m high.
- Rack bays: ${finite(d.bayCount)}.
- Rack runs: ${finite(d.runCount)}.
- Storage levels: ${finite(d.levels)}.
- Standard frame height: ${finite(d.frameHeightMM) / 1000}m.
- Calculated pallet spaces: ${finite(d.totalPalletSpaces)}.
- Pallet type: ${String(d.palletType || "standard")}.
- Aisle standard: ${finite(d.aisleStandardM)}m.
- Beam breakdown: ${beamText || "use supplied geometry"}.

REAL-WORLD PRESENTATION:
- Modern UK industrial warehouse.
- Smooth light-grey concrete floor.
- Insulated metal wall cladding and realistic steel roof structure.
- Neutral LED high-bay lighting with natural skylight where appropriate.
- Fill rack positions with realistic timber pallets, shrink-wrapped cartons and neutral mixed warehouse stock.
- Keep loads seated realistically on beams.
- A forklift may appear in the background for scale, but do not obscure the layout.
- No people.

CAMERA / STYLE:
- Professional architectural warehouse photography.
- 24-28mm wide-angle lens feel, straight verticals, realistic perspective.
- Natural contrast, realistic textures, balanced exposure.
- Must look like a real installed warehouse, not a CGI render.
- Do not draw UI controls, design labels, legends or annotations.

Output only the finished warehouse photograph.
`.trim();
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      if (origin && !ALLOWED_ORIGINS.has(origin)) {
        return new Response(null, { status: 403, headers: cors(origin) });
      }
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
    if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: "Origin not allowed." }, 403, origin);
    if (!env.OPENAI_API_KEY) return json({ error: "OPENAI_API_KEY is not configured." }, 500, origin);

    try {
      const body = await request.json();
      if (!body.referenceImage) return json({ error: "referenceImage is required." }, 400, origin);

      const referenceBlob = dataUrlToBlob(body.referenceImage);
      const birdseyeBlob = body.birdseyeImage ? dataUrlToBlob(body.birdseyeImage) : null;

      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("image[]", referenceBlob, "easydesign-perspective.jpg");
      if (birdseyeBlob) form.append("image[]", birdseyeBlob, "easydesign-birdseye.jpg");
      form.append("prompt", buildPrompt(body));
      form.append("size", "1536x1024");
      form.append("quality", "high");
      form.append("output_format", "jpeg");
      form.append("output_compression", "88");

      const response = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: form,
      });

      const raw = await response.text();
      let data;
      try { data = JSON.parse(raw); } catch { data = null; }

      if (!response.ok) {
        return json({ error: data?.error?.message || raw || "OpenAI image generation failed." }, response.status, origin);
      }

      const b64 = data?.data?.[0]?.b64_json;
      if (!b64) return json({ error: "No generated image was returned." }, 502, origin);

      return json({
        ok: true,
        reference: String(body.reference || ""),
        imageDataUrl: `data:image/jpeg;base64,${b64}`,
      }, 200, origin);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Unexpected render error." }, 500, origin);
    }
  },
};
