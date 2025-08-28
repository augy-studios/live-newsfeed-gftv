// Deploy path: /api/rss.js  → then rewrite /rss -> /api/rss in vercel.json

const escape = (s = "") =>
    s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

const rfc1123 = (d) => new Date(d).toUTCString();

/**
 * Build a full absolute URL from a path or absolute string
 */
const abs = (origin, maybeUrl) => {
    try {
        return new URL(maybeUrl, origin).toString();
    } catch {
        return origin;
    }
};

export default async function handler(req, res) {
    try {
        const proto = (req.headers["x-forwarded-proto"] || "https").split(",")[0].trim();
        const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
        const origin = `${proto}://${host}`;

        // Allow overriding source via env; otherwise use your static /feed.json (as in index.html)
        const feedUrl = process.env.FEED_URL || abs(origin, "/feed.json");

        const resp = await fetch(feedUrl, {
            cache: "no-store"
        });
        if (!resp.ok) throw new Error(`Failed to fetch feed.json: ${resp.status}`);
        const data = await resp.json();

        const meta = data.meta || {};
        const posts = Array.isArray(data.posts) ? data.posts : [];

        // Channel metadata
        const channelTitle = meta.title || "Live Feed";
        const channelLink = origin + "/";
        const channelDesc = `RSS for ${channelTitle}`;
        const channelUpdated = meta.updated_at || new Date().toISOString();

        // Build items (newest first)
        const itemsXml = posts
            .slice()
            .sort((a, b) => new Date(b.time) - new Date(a.time))
            .map((p) => {
                const id = p.id || `${p.time}-${(p.title || "").slice(0, 24)}`;
                const title = p.title || "Untitled";
                const desc = p.description || "";
                const pub = p.time || channelUpdated;
                const link = abs(origin, `/#${encodeURIComponent(id)}`); // anchor to your card
                const guid = abs(origin, `/posts/${encodeURIComponent(id)}`); // stable GUID-ish

                // Optional enclosure: first image
                const firstImg = Array.isArray(p.images) && p.images[0] ? abs(origin, p.images[0]) : null;

                return `
  <item>
    <title>${escape(title)}</title>
    <link>${escape(link)}</link>
    <guid isPermaLink="false">${escape(guid)}</guid>
    <pubDate>${escape(rfc1123(pub))}</pubDate>
    <description>${escape(desc)}</description>${
      firstImg ? `\n    <enclosure url="${escape(firstImg)}" type="image/jpeg" />` : ""
    }
  </item>`;
            })
            .join("");

        // Assemble RSS 2.0
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escape(channelTitle)}</title>
  <link>${escape(channelLink)}</link>
  <description>${escape(channelDesc)}</description>
  <lastBuildDate>${escape(rfc1123(channelUpdated))}</lastBuildDate>
  <generator>GFTV NewsSpot RSS</generator>${itemsXml}
</channel>
</rss>`;

        res.setHeader("Content-Type", "application/rss+xml; charset=utf-8");
        // Cache at the edge but keep it fresh
        res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=600");
        res.status(200).send(xml);
    } catch (err) {
        console.error(err);
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.status(500).send("RSS generation error");
    }
}