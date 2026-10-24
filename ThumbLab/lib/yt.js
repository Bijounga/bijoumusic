/**
 * YouTube search helpers that don't touch Electron, so they can be tested with a stand-in for the API.
 */

function isoDuration(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || "");
  if (!m) return "";
  const [d, h, mi, s] = [m[1], m[2], m[3], m[4]].map((n) => parseInt(n || "0", 10));
  const hours = h + d * 24;
  const pad = (n) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`;
}

/** "12:34" or "1:02:03" -> seconds (0 when unknown). */
function durationSeconds(text) {
  if (!text) return 0;
  return text.split(":").reduce((n, part) => n * 60 + (parseInt(part, 10) || 0), 0);
}

const SHORTS_MAX_SECONDS = 180;

/** How many of these videos would stay on the page with the given Shorts setting. */
function countQualified(videos, hideShorts) {
  return hideShorts ? videos.filter((v) => durationSeconds(v.duration) > SHORTS_MAX_SECONDS).length : videos.length;
}

/**
 * Searches page after page until `want` videos qualify (or there are no more results, or maxPages is
 * reached), so hiding Shorts finds more videos instead of leaving the page short.
 * ytGet(endpoint, params) is the API call; opts: { q, order, want, hideShorts, after, before, maxPages }.
 * Returns { videos, pages, exhausted }.
 */
async function searchVideos(ytGet, opts) {
  const { q, order, want, hideShorts, after, before } = opts;
  const maxPages = opts.maxPages || 5;
  const videos = [];
  const seen = new Set();
  let token, pages = 0, exhausted = false;

  while (pages < maxPages) {
    const params = {
      part: "snippet", type: "video", maxResults: "50", q, order: order || "relevance", videoEmbeddable: "any",
    };
    if (token) params.pageToken = token;
    if (after) params.publishedAfter = after;
    if (before) params.publishedBefore = before;
    const page = await ytGet("search", params);
    pages++;

    const items = (page.items || []).filter((i) => i.id && i.id.videoId && !seen.has(i.id.videoId) && seen.add(i.id.videoId));
    if (items.length) {
      const d = await ytGet("videos", { part: "statistics,contentDetails", id: items.map((i) => i.id.videoId).join(",") });
      const byId = new Map((d.items || []).map((v) => [v.id, v]));
      for (const i of items) {
        const det = byId.get(i.id.videoId);
        videos.push({
          id: i.id.videoId,
          title: i.snippet.title.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
          channel: i.snippet.channelTitle,
          thumb: `https://i.ytimg.com/vi/${i.id.videoId}/mqdefault.jpg`,
          published: i.snippet.publishedAt,
          views: det && det.statistics ? parseInt(det.statistics.viewCount || "0", 10) : 0,
          duration: det && det.contentDetails ? isoDuration(det.contentDetails.duration) : "",
        });
      }
    }
    token = page.nextPageToken;
    if (!token) { exhausted = true; break; }
    if (countQualified(videos, hideShorts) >= want) break;
  }
  return { videos, pages, exhausted };
}

module.exports = { isoDuration, durationSeconds, countQualified, searchVideos, SHORTS_MAX_SECONDS };
