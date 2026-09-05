// @ts-check
/**
 * Pure domain logic for the BetterDiscord Plugin Catalog.
 * Vocabulary follows the project glossary: Catalog, Plugin Entry, Hosted / External,
 * Slug, Pinned Copy, Broken Plugin, Recency, Header Check, Fallback Link, List State.
 * Nothing in here touches the DOM or the network.
 */

/** @typedef {{ owner: string, repo: string, ref: string }} Repository */
/** @typedef {{ id: string, name: string }} PluginEntry */

/**
 * @typedef {object} Plugin
 * @property {string} id            Slug from the manifest; the Deep Link key.
 * @property {string} entryName     Manifest name: folder and artifact filename stem.
 * @property {'hosted' | 'external'} kind
 * @property {string} name
 * @property {string} description
 * @property {string} version
 * @property {string[]} authors
 * @property {string | null} status
 * @property {string | null} workingStatus
 * @property {string | null} lastUpdated   YYYY-MM-DD; the only Recency source.
 * @property {string | null} releaseDate
 * @property {string[]} features
 * @property {string} sourceUrl
 * @property {string | null} changelogUrl
 * @property {string} downloadUrl
 * @property {string[]} requirements
 * @property {string[]} tags
 * @property {string | null} icon
 * @property {string | null} license
 * @property {string} issuesUrl
 * @property {boolean} featured
 * @property {string | null} pinnedUrl
 * @property {string | null} versionUrl
 * @property {string | null} servedFrom     owner/repo parsed from sourceUrl.
 */

/**
 * A Broken Plugin keeps whatever it could still tell us: `downloadUrl` when the
 * body stated a usable one (for the Fallback Link), `throttled` when the host
 * answered 429.
 * @typedef {{ status: 'ok', plugin: Plugin } | { status: 'broken', reason: string, downloadUrl?: string, throttled?: boolean }} MetadataOutcome
 */

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Reads a parsed manifest.json into the list of Plugin Entries the Site
 * should fetch, in manifest order, or null when the manifest has no plugins
 * array. Entries that are disabled, missing a field, or whose id is not a
 * Slug are skipped silently.
 * @param {unknown} manifest
 * @returns {PluginEntry[] | null}
 */
export function readManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return null;
  const plugins = /** @type {{ plugins?: unknown }} */ (manifest).plugins;
  if (!Array.isArray(plugins)) return null;
  /** @type {PluginEntry[]} */
  const entries = [];
  for (const raw of plugins) {
    if (!raw || typeof raw !== 'object') continue;
    const { id, name, enabled } = /** @type {Record<string, unknown>} */ (raw);
    if (typeof id !== 'string' || !SLUG.test(id)) continue;
    if (typeof name !== 'string' || name === '') continue;
    if (enabled !== true) continue;
    entries.push({ id, name });
  }
  return entries;
}

/** The one Allowlisted Host: the only place the Site fetches from. */
const RAW_HOSTNAME = 'raw.githubusercontent.com';
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMMIT_SEGMENT = /\/[0-9a-f]{7,40}\//;

/** @param {Repository} r */
const rawBase = (r) => `https://${RAW_HOSTNAME}/${r.owner}/${r.repo}/${r.ref}`;
/** @param {Repository} r */
export const repoUrl = (r) => `https://github.com/${r.owner}/${r.repo}`;
/** @param {Repository} r */
export const manifestUrl = (r) => `${rawBase(r)}/manifest.json`;
/** @param {Repository} r @param {PluginEntry} e */
export const metadataUrl = (r, e) => `${rawBase(r)}/Plugins/${e.name}/plugin.json`;

/** @param {unknown} v */
const isHttps = (v) => typeof v === 'string' && /^https:\/\/[^\s/]+/.test(v);

/**
 * Whether the Site may fetch this URL itself (an Allowlisted Host). Anything
 * else gets only a Fallback Link.
 * @param {unknown} v
 */
export function isAllowlisted(v) {
  if (!isHttps(v)) return false;
  try {
    return new URL(/** @type {string} */ (v)).hostname === RAW_HOSTNAME;
  } catch {
    return false;
  }
}

/**
 * Milliseconds at UTC midnight of a YYYY-MM-DD string. An impossible day such
 * as 30 February either fails to parse or rolls over into the next month,
 * depending on the engine, so callers compare the fields back.
 * @param {string} isoDate
 */
const utcMidnight = (isoDate) => Date.parse(`${isoDate}T00:00:00Z`);

/** @param {unknown} v @returns {string | null} */
function isoDateOrNull(v) {
  if (typeof v !== 'string') return null;
  const m = ISO_DATE.exec(v);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = new Date(utcMidnight(v));
  const real = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return real ? v : null;
}

/** @param {unknown} v @returns {string[]} */
const stringArray = (v) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? /** @type {string[]} */ (v) : []);

/** Trimmed, non-empty strings from an array optional. @param {unknown} v */
const cleanStrings = (v) => stringArray(v).map((s) => s.trim()).filter(Boolean);

/** @param {unknown} v @returns {string | null} */
const stringOrNull = (v) => (typeof v === 'string' ? v : null);

/** @param {unknown} v @returns {string | null} */
const httpsOrNull = (v) => (isHttps(v) ? /** @type {string} */ (v) : null);

/**
 * Splits the comma-separated author string into author chips.
 * @param {string} s
 */
const splitAuthors = (s) => s.split(',').map((a) => a.trim()).filter(Boolean);

/**
 * `owner/repo` parsed from a GitHub URL, for the Served-from display and the history link.
 * @param {string | null} url
 * @returns {string | null}
 */
function servedFromRepository(url) {
  const m = typeof url === 'string' ? /^https:\/\/github\.com\/([^/]+\/[^/]+)/.exec(url) : null;
  return m ? m[1].replace(/\.git$/, '') : null;
}

/**
 * Where a Hosted entry's artifact, source folder and changelog live when its
 * Plugin Metadata leaves them unstated. Built from the manifest name, never
 * the metadata name.
 * @param {Repository} repository
 * @param {PluginEntry} entry
 */
export function derivedUrls(repository, entry) {
  const base = rawBase(repository);
  return {
    downloadUrl: `${base}/Plugins/${entry.name}/${entry.name}.plugin.js`,
    sourceUrl: `${repoUrl(repository)}/tree/${repository.ref}/Plugins/${entry.name}`,
    changelogUrl: `${base}/Plugins/${entry.name}/CHANGELOG.md`,
  };
}

/**
 * Parses one plugin.json body into a Plugin or a Broken Plugin reason.
 * Required fields missing or mistyped make the entry Broken; bad optional
 * fields are dropped one by one.
 * @param {string} body    Response text of plugin.json (untrusted).
 * @param {PluginEntry} entry
 * @param {Repository} repository
 * @returns {MetadataOutcome}
 */
export function readPluginMetadata(body, entry, repository) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    return { status: 'broken', reason: 'plugin.json is not valid JSON.' };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'broken', reason: 'plugin.json is not a JSON object.' };
  }
  const meta = /** @type {Record<string, unknown>} */ (raw);
  const statedDownload = httpsOrNull(meta.downloadUrl);
  /** @param {string} reason @returns {MetadataOutcome} */
  const broken = (reason) => (statedDownload ? { status: 'broken', reason, downloadUrl: statedDownload } : { status: 'broken', reason });

  for (const key of ['name', 'description', 'version', 'author']) {
    if (!(key in meta) || meta[key] === null) return broken(`Required field “${key}” is missing.`);
    if (typeof meta[key] !== 'string') return broken(`Required field “${key}” has the wrong type.`);
  }
  const { name, description, version, author } = /** @type {{ name: string, description: string, version: string, author: string }} */ (meta);

  const insideRepository = `https://${RAW_HOSTNAME}/${repository.owner}/${repository.repo}/`;
  const kind = statedDownload === null || statedDownload.startsWith(insideRepository) ? 'hosted' : 'external';

  const statedSource = httpsOrNull(meta.sourceUrl);
  /** @type {string} */
  let downloadUrl;
  /** @type {string} */
  let sourceUrl;
  let changelogUrl = httpsOrNull(meta.changelogUrl);

  if (kind === 'hosted') {
    const derived = derivedUrls(repository, entry);
    downloadUrl = statedDownload ?? derived.downloadUrl;
    sourceUrl = statedSource ?? derived.sourceUrl;
    changelogUrl ??= derived.changelogUrl;
  } else {
    if (statedSource === null) return broken('Required field “sourceUrl” is missing.');
    downloadUrl = /** @type {string} */ (statedDownload);
    sourceUrl = statedSource;
  }

  const pinned = isAllowlisted(meta.pinnedUrl) && COMMIT_SEGMENT.test(/** @type {string} */ (meta.pinnedUrl))
    ? /** @type {string} */ (meta.pinnedUrl)
    : null;

  return {
    status: 'ok',
    plugin: {
      id: entry.id,
      entryName: entry.name,
      kind,
      name,
      description,
      version,
      authors: splitAuthors(author),
      status: stringOrNull(meta.status),
      workingStatus: stringOrNull(meta.workingStatus),
      lastUpdated: isoDateOrNull(meta.lastUpdated),
      releaseDate: isoDateOrNull(meta.releaseDate),
      features: cleanStrings(meta.features),
      sourceUrl,
      changelogUrl,
      downloadUrl,
      requirements: cleanStrings(meta.requirements),
      tags: cleanStrings(meta.tags),
      icon: isAllowlisted(meta.icon) ? /** @type {string} */ (meta.icon) : null,
      license: stringOrNull(meta.license),
      issuesUrl: httpsOrNull(meta.issuesUrl) ?? `${repoUrl(repository)}/issues`,
      featured: meta.featured === true,
      pinnedUrl: pinned,
      versionUrl: httpsOrNull(meta.versionUrl),
      servedFrom: servedFromRepository(sourceUrl),
    },
  };
}

/** Copy shown whenever the Content Repository's host answers 429 (Throttled). */
export const THROTTLED_COPY = 'GitHub is limiting downloads from your network. Wait a few minutes, then retry. This isn\'t automatic.';

/**
 * Turns a failed plugin.json fetch into a Broken Plugin outcome.
 * @param {{ kind: 'http', status: number } | { kind: 'network' }} failure
 * @returns {{ status: 'broken', reason: string, throttled: boolean }}
 */
export function brokenFromFetch(failure) {
  if (failure.kind === 'http' && failure.status === 429) {
    return { status: 'broken', reason: THROTTLED_COPY, throttled: true };
  }
  const detail = failure.kind === 'http' ? String(failure.status) : 'network error';
  return { status: 'broken', reason: `plugin.json could not be fetched (${detail}).`, throttled: false };
}

/* ---------- List State: search, tags, sort ---------- */

const SORT_KEYS = /** @type {const} */ (['updated', 'released', 'name']);
/** @typedef {typeof SORT_KEYS[number]} SortKey */
/** @typedef {'asc' | 'desc'} SortDir */
/** @typedef {{ q: string, tags: string[], sort: SortKey, dir: SortDir }} ListState */

/** The direction a sort key takes when first chosen: dates newest first, names A–Z. */
export const NATURAL_DIR = /** @type {Readonly<Record<SortKey, SortDir>>} */ ({ updated: 'desc', released: 'desc', name: 'asc' });

/** @type {ListState} */
export const DEFAULT_LIST_STATE = { q: '', tags: [], sort: 'updated', dir: NATURAL_DIR.updated };

/** Which Plugin field each date sort reads. */
const DATE_FIELD = /** @type {const} */ ({ updated: 'lastUpdated', released: 'releaseDate' });

/** @param {Plugin} p */
const searchText = (p) => [p.name, p.description, ...p.authors, ...p.tags].join('\n').toLowerCase();

/** @type {(a: Plugin, b: Plugin) => number} */
const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * The sort a segment produces when activated: choosing the current key
 * reverses its direction, choosing another key takes that key's natural one.
 * @param {Pick<ListState, 'sort' | 'dir'>} current
 * @param {SortKey} key
 * @returns {{ sort: SortKey, dir: SortDir }}
 */
export function nextSort(current, key) {
  if (key !== current.sort) return { sort: key, dir: NATURAL_DIR[key] };
  return { sort: key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * Filters and sorts the Catalog for the given List State. Search is a
 * case-insensitive substring over name, description, authors and tags; tags
 * are OR-ed. The date sorts put entries without a date last in either
 * direction; every tie breaks by name A–Z.
 * @param {Plugin[]} plugins
 * @param {ListState} state
 * @returns {Plugin[]}
 */
export function applyListState(plugins, state) {
  const q = state.q.trim().toLowerCase();
  const tags = new Set(state.tags);
  const kept = plugins.filter((p) => {
    if (q && !searchText(p).includes(q)) return false;
    if (tags.size && !p.tags.some((t) => tags.has(t))) return false;
    return true;
  });
  const sign = state.dir === 'asc' ? 1 : -1;
  if (state.sort === 'name') return kept.sort((a, b) => sign * byName(a, b));
  const field = DATE_FIELD[state.sort];
  return kept.sort((a, b) => {
    const da = a[field];
    const db = b[field];
    if (da === null || db === null) {
      if (da === db) return byName(a, b);
      return da === null ? 1 : -1;
    }
    return sign * da.localeCompare(db) || byName(a, b);
  });
}

/**
 * Reads the List State from a query string (`?q=…&tag=a&tag=b&sort=…&dir=…`).
 * An unknown sort falls back to the default; an unknown or absent dir to the
 * key's natural direction.
 * @param {string} search
 * @returns {ListState}
 */
export function parseListState(search) {
  const params = new URLSearchParams(search);
  const sortParam = params.get('sort');
  const sort = SORT_KEYS.includes(/** @type {SortKey} */ (sortParam)) ? /** @type {SortKey} */ (sortParam) : DEFAULT_LIST_STATE.sort;
  const dirParam = params.get('dir');
  const dir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : NATURAL_DIR[sort];
  return { q: params.get('q') ?? '', tags: params.getAll('tag').filter(Boolean), sort, dir };
}

/**
 * Writes the List State as a query string, omitting defaults ('' for a plain
 * visit): the default sort, and a direction that is the key's natural one.
 * @param {ListState} state
 */
export function formatListState(state) {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  for (const t of state.tags) params.append('tag', t);
  if (state.sort !== DEFAULT_LIST_STATE.sort) params.set('sort', state.sort);
  if (state.dir !== NATURAL_DIR[state.sort]) params.set('dir', state.dir);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * The Deep Link key from a hash (`#plugin/<id>`), or null.
 * @param {string} hash
 */
export function parseDeepLink(hash) {
  const m = /^#plugin\/(.+)$/.exec(hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/** @param {string} id */
export const deepLinkHash = (id) => `#plugin/${encodeURIComponent(id)}`;

/* ---------- download ---------- */

/**
 * The filename a saved Plugin Artifact gets: manifest name + `.plugin.js` when
 * it is a safe filename, else the URL's last segment when it ends in
 * `.plugin.js`, else `<slug>.plugin.js`.
 * @param {{ entryName: string, id: string, downloadUrl: string }} p
 */
export function artifactFilename(p) {
  if (/^[A-Za-z0-9._-]+$/.test(p.entryName)) return `${p.entryName}.plugin.js`;
  const segment = p.downloadUrl.split(/[?#]/, 1)[0].split('/').pop() ?? '';
  if (/^[A-Za-z0-9._-]+\.plugin\.js$/.test(segment)) return segment;
  return `${p.id}.plugin.js`;
}

/**
 * Header Check: the first kilobyte of a fetched artifact must carry the marks
 * of a BetterDiscord META header. Reads text, never executes it.
 * @param {string} text
 */
export function passesHeaderCheck(text) {
  const head = text.slice(0, 1024);
  return head.includes('/**') && head.includes('@name');
}

/* ---------- links ---------- */

/**
 * The file history of a plugin in its served-from repository.
 * @param {Pick<Plugin, 'servedFrom' | 'entryName'>} p
 */
export function historyUrl(p) {
  if (!p.servedFrom) return null;
  return `https://github.com/${p.servedFrom}/commits/main/Plugins/${p.entryName}/${p.entryName}.plugin.js`;
}

/**
 * Where the version label points: a stated versionUrl, else the artifact at
 * its Pinned Copy's commit, else the file history (labelled honestly).
 * @param {Pick<Plugin, 'versionUrl' | 'pinnedUrl' | 'servedFrom' | 'entryName'>} p
 * @returns {{ href: string, title: string } | null}
 */
export function versionLink(p) {
  const exact = 'This version in the repository';
  if (p.versionUrl) return { href: p.versionUrl, title: exact };
  const pinned = pinnedCommit(p.pinnedUrl);
  if (pinned) {
    return { href: `https://github.com/${pinned.repository}/blob/${pinned.sha}/Plugins/${p.entryName}/${p.entryName}.plugin.js`, title: exact };
  }
  const history = historyUrl(p);
  return history ? { href: history, title: 'No per-version link for this plugin; opens its change history' } : null;
}

/**
 * The Pinned Copy's repository and commit, from its raw URL.
 * @param {string | null} pinnedUrl
 * @returns {{ url: string, repository: string, sha: string, shortSha: string, commitUrl: string } | null}
 */
export function pinnedCommit(pinnedUrl) {
  if (!pinnedUrl || !isAllowlisted(pinnedUrl)) return null;
  const m = /^\/([^/]+\/[^/]+)\/([0-9a-f]{7,40})\//.exec(new URL(pinnedUrl).pathname);
  if (!m) return null;
  const [, repository, sha] = m;
  return { url: pinnedUrl, repository, sha, shortSha: sha.slice(0, 7), commitUrl: `https://github.com/${repository}/commit/${sha}` };
}

/**
 * A GitHub profile link for an author chip, when the name is GitHub-shaped.
 * @param {string} author
 */
export function authorProfileUrl(author) {
  return /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(author) ? `https://github.com/${author}` : null;
}

/** @param {string} license */
export const licenseUrl = (license) => `https://spdx.org/licenses/${encodeURIComponent(license)}.html`;

/* ---------- Recency ---------- */

export const RECENT_DAYS = 30;

/**
 * Whole days between a YYYY-MM-DD date and today (UTC), or null without a date.
 * @param {string | null} isoDate
 * @param {Date} today
 */
export function daysSince(isoDate, today) {
  if (!isoDate) return null;
  const then = utcMidnight(isoDate);
  if (Number.isNaN(then)) return null;
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((todayUtc - then) / 864e5);
}

/**
 * Recently Updated: Recency within the last 30 days.
 * @param {string | null} isoDate
 * @param {Date} today
 */
export function isRecentlyUpdated(isoDate, today) {
  const d = daysSince(isoDate, today);
  return d !== null && d >= 0 && d <= RECENT_DAYS;
}

/* ---------- presentation helpers ---------- */

/**
 * Per-plugin hue: a 31-multiplier string hash mapped into 200–289 degrees
 * (blue → violet → magenta).
 * @param {string} name
 */
export function hue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return 200 + (h % 90);
}

/**
 * Initials for the icon tile: first letters of the first two words, where
 * camel-case boundaries, spaces, hyphens and underscores split words.
 * @param {string} name
 */
export function initials(name) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[\s\-_]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
}

/**
 * Tags present in the Catalog, A–Z, with how many plugins carry each.
 * @param {Plugin[]} plugins
 * @returns {Array<{ tag: string, count: number }>}
 */
export function collectTags(plugins) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const p of plugins) for (const t of new Set(p.tags)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag));
}

/**
 * The newest lastUpdated among rendered entries, or null when none declares one.
 * @param {Plugin[]} plugins
 */
export function catalogUpdatedDate(plugins) {
  let newest = null;
  for (const p of plugins) if (p.lastUpdated && (!newest || p.lastUpdated > newest)) newest = p.lastUpdated;
  return newest;
}

/** Bump whenever the parsed Plugin shape changes, so stale sessionStorage is ignored. */
const SCHEMA_VERSION = 2;

/** @param {Repository} r */
export const cacheKey = (r) => `catalog:${r.owner}/${r.repo}@${r.ref}:v${SCHEMA_VERSION}`;

/** Where BetterDiscord loads plugins from, per operating system. */
const PLUGINS_FOLDERS = [
  { key: 'windows', os: 'Windows', path: '%APPDATA%\\BetterDiscord\\plugins', note: null },
  { key: 'mac', os: 'macOS', path: '~/Library/Application Support/BetterDiscord/plugins', note: null },
  { key: 'linux', os: 'Linux', path: '$XDG_CONFIG_HOME/BetterDiscord/plugins', note: 'Defaults to ~/.config/BetterDiscord/plugins' },
];

/**
 * Plugins Folder Hint rows, the visitor's OS first and marked when the signal is clear.
 * @param {'windows' | 'mac' | 'linux' | null} platform
 * @returns {Array<{ os: string, path: string, note: string | null, you: boolean }>}
 */
export function pluginsFolderRows(platform) {
  const rows = platform ? [...PLUGINS_FOLDERS.filter((r) => r.key === platform), ...PLUGINS_FOLDERS.filter((r) => r.key !== platform)] : PLUGINS_FOLDERS;
  return rows.map(({ key, ...r }) => ({ ...r, you: key === platform }));
}

/**
 * Reads the visitor's OS from the user agent hints the browser offers.
 * @param {{ userAgentData?: { platform?: string }, platform?: string, userAgent?: string }} nav
 * @returns {'windows' | 'mac' | 'linux' | null}
 */
export function detectPlatform(nav) {
  const s = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase();
  if (/\bwin/.test(s)) return 'windows';
  if (/mac/.test(s)) return 'mac';
  if (/linux|x11/.test(s) && !/android/.test(s)) return 'linux';
  return null;
}
