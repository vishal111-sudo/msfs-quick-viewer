'use strict';

// Where a photo can come from when an aircraft has no thumbnail on disk.
//
// Both sources are Wikimedia APIs, which is not laziness: they are the only
// large aircraft photo libraries that publish a documented API, allow
// automated access, and carry per-image licence metadata. JetPhotos and
// Airliners.net serve a Cloudflare challenge to any non-browser request, and
// their photos are all-rights-reserved to the individual photographer, so
// neither can be used from an app.
//
// A provider turns a search phrase into a candidate image plus the credit that
// has to be shown with it.

/** Words that mark a result as being about an aircraft rather than anything else. */
const AIRCRAFT_WORDS = [
  'aircraft', 'airplane', 'aeroplane', 'airliner', 'airline', 'aviation',
  'helicopter', 'rotorcraft', 'autogyro', 'gyroplane', 'glider', 'sailplane',
  'biplane', 'monoplane', 'seaplane', 'floatplane', 'flying boat',
  'airship', 'blimp', 'balloon', 'bomber', 'fighter', 'warplane',
  'airframe', 'evtol', 'vtol', 'air force', 'trainer', 'jet',
];

function mentionsAircraft(value) {
  if (!value) return false;
  const text = String(value).toLowerCase();
  return AIRCRAFT_WORDS.some((word) => text.includes(word));
}

/** Strip the HTML Commons puts in its `Artist` field. */
function plainText(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Distinctive words from the query, used to sanity-check a result. */
function queryTokens(query) {
  return String(query)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
}

/* ---------- Wikipedia: the lead image of the aircraft's article ---------- */

const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';

/**
 * Curated and almost always the right aircraft, because it is the picture an
 * article chose to lead with. Only ever one image per aircraft type.
 */
async function findOnWikipedia(query, { exactTitle = false, requestJson, thumbSize }) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'pageimages|info|description|categories',
    piprop: 'thumbnail|name',
    pithumbsize: String(thumbSize),
    inprop: 'url',
    cllimit: '30',
    clshow: '!hidden',
    redirects: '1',
  });

  if (exactTitle) {
    params.set('titles', query);
  } else {
    params.set('generator', 'search');
    params.set('gsrsearch', query);
    params.set('gsrlimit', '5');
    params.set('gsrnamespace', '0');
  }

  const payload = await requestJson(`${WIKIPEDIA_API}?${params.toString()}`);
  const pages = (payload && payload.query && payload.query.pages) || [];

  // Beyond the manufacturer, which every sibling shares — searching
  // "Boeing 777-200ER GE" otherwise settles happily on "Boeing 767".
  const distinctive = exactTitle ? [] : queryTokens(query).slice(1);

  // Search results are ranked; keep that order but drop anything that is not
  // an aircraft article, so a poor query returns nothing rather than the first
  // picture Wikipedia happens to have.
  const hit = pages.find((page) => {
    if (!page || !page.thumbnail || !page.thumbnail.source) return false;

    const isAircraft =
      mentionsAircraft(page.description) ||
      (page.categories || []).some((category) => mentionsAircraft(category.title));
    if (!isAircraft) return false;

    if (!distinctive.length) return true;
    const title = String(page.title || '').toLowerCase();
    return distinctive.some((token) => title.includes(token));
  });
  if (!hit) return null;

  return {
    imageUrl: hit.thumbnail.source,
    pageTitle: hit.title,
    description: hit.description || null,
    pageUrl: hit.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(hit.title)}`,
    filePageUrl: hit.pageimage
      ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(hit.pageimage)}`
      : null,
    attribution: null,
    license: null,
  };
}

/* ---------- Wikimedia Commons: the wider photo library ---------- */

const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Many more photographs, including of aircraft with no article of their own —
 * it finds Mike Patey's Draco, which Wikipedia cannot. In exchange the match
 * is looser, and the licence usually requires naming the photographer.
 */
async function findOnCommons(query, { requestJson, thumbSize }) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    // `filetype:bitmap` keeps out SVG diagrams, PDFs and audio.
    gsrsearch: `filetype:bitmap ${query}`,
    gsrnamespace: '6',
    gsrlimit: '8',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|mime',
    iiurlwidth: String(thumbSize),
  });

  const payload = await requestJson(`${COMMONS_API}?${params.toString()}`);
  const pages = (payload && payload.query && payload.query.pages) || [];
  const tokens = queryTokens(query);

  for (const page of pages) {
    const info = (page.imageinfo || [])[0];
    if (!info || !info.thumburl) continue;
    if (info.mime && !/^image\/(jpeg|png|webp)$/.test(info.mime)) continue;

    // The search is a free-text match over the whole file page, so require the
    // file's own name to carry a distinctive word from the query. Without this
    // "Powrachute Sky Rascal" happily returns an unrelated sky photograph.
    const title = String(page.title || '').toLowerCase();
    const matched = tokens.filter((token) => title.includes(token)).length;
    if (tokens.length && matched < Math.min(2, tokens.length)) continue;

    const meta = info.extmetadata || {};
    const artist = plainText(meta.Artist && meta.Artist.value);
    const license = plainText(meta.LicenseShortName && meta.LicenseShortName.value);

    return {
      imageUrl: info.thumburl,
      pageTitle: String(page.title || '').replace(/^File:/, ''),
      description: plainText(meta.ImageDescription && meta.ImageDescription.value).slice(0, 200) || null,
      pageUrl: info.descriptionurl || null,
      filePageUrl: info.descriptionurl || null,
      // CC BY-SA needs the photographer named wherever the image is shown.
      attribution: artist || null,
      license: license || null,
    };
  }
  return null;
}

const SOURCES = {
  wikipedia: {
    id: 'wikipedia',
    label: 'Wikipedia article photo',
    note: 'One curated photo per aircraft type. Most reliable match.',
    find: findOnWikipedia,
    /** Only Wikipedia can look a title up directly from the catalog. */
    supportsExactTitle: true,
  },
  commons: {
    id: 'commons',
    label: 'Wikimedia Commons',
    note: 'A far larger photo library, including aircraft with no article. Looser matches, and photos must credit the photographer.',
    find: findOnCommons,
    supportsExactTitle: false,
  },
};

const DEFAULT_SOURCE = 'wikipedia';

function getSource(id) {
  return SOURCES[id] || SOURCES[DEFAULT_SOURCE];
}

/** Sources offered in Settings, in display order. */
function listSources() {
  return Object.values(SOURCES).map(({ id, label, note }) => ({ id, label, note }));
}

module.exports = { getSource, listSources, DEFAULT_SOURCE, mentionsAircraft, plainText };
