// @ts-check
/**
 * BetterDiscord Plugin Catalog: the Site.
 * Fetches the Manifest and Plugin Metadata from the Content Repository, renders
 * the Catalog, and downloads Plugin Artifacts. All remote JSON is untrusted and
 * only ever reaches the page through textContent, attributes, or CSSOM.
 */
import {
  readManifest,
  readPluginMetadata,
  derivedUrls,
  brokenFromFetch,
  applyListState,
  parseListState,
  formatListState,
  parseDeepLink,
  deepLinkHash,
  artifactFilename,
  passesHeaderCheck,
  isAllowlisted,
  versionLink,
  historyUrl,
  pinnedCommit,
  authorProfileUrl,
  licenseUrl,
  daysSince,
  isRecentlyUpdated,
  hue,
  initials,
  collectTags,
  catalogUpdatedDate,
  cacheKey,
  pluginsFolderRows,
  detectPlatform,
  manifestUrl,
  metadataUrl,
  rawBase,
  repoUrl,
  DEFAULT_LIST_STATE,
  THROTTLED_COPY,
} from './catalog.js';

/** @typedef {import('./catalog.js').Plugin} Plugin */
/** @typedef {import('./catalog.js').PluginEntry} PluginEntry */
/** @typedef {import('./catalog.js').ListState} ListState */
/** @typedef {import('./catalog.js').SortKey} SortKey */
/** @typedef {import('./catalog.js').MetadataOutcome} Outcome */

const REPOSITORY = { owner: 'goproslowyo', repo: 'bd-plugins', ref: 'main' };

const CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_DEBOUNCE_MS = 150;
const COPY_FLASH_MS = 1200;
const SKELETON_COUNT = 9;
const DENSITY_MAX = 7;
const SVG_NS = 'http://www.w3.org/2000/svg';

/* ============ DOM helpers ============ */

/**
 * Creates an element. Attribute values are set as strings; `text` sets
 * textContent; `class` sets className; `on*` adds listeners.
 * @param {string} tag
 * @param {Record<string, unknown>} [attrs]
 * @param {...(Node | string | number | null | undefined | false | Array<Node | string | null | undefined | false>)} children
 * @returns {HTMLElement}
 */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), /** @type {EventListener} */ (value));
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** @type {Record<string, Array<{ path?: string, circle?: [number, number, number], rect?: [number, number, number, number, number] }>>} */
const ICONS = {
  search: [{ circle: [11, 11, 7] }, { path: 'm20 20-3.5-3.5' }],
  chevron: [{ path: 'm9 6 6 6-6 6' }],
  down: [{ path: 'M12 4v12m0 0 5-5m-5 5-5-5M4 20h16' }],
  ext: [{ path: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6' }],
  copy: [{ rect: [9, 9, 11, 11, 2] }, { path: 'M5 15V5a1 1 0 0 1 1-1h10' }],
  link: [{ path: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5' }, { path: 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5' }],
  close: [{ path: 'M6 6l12 12M18 6 6 18' }],
  check: [{ path: 'm5 12 4 4L19 6' }],
  warn: [{ path: 'M12 3 2 20h20L12 3z' }, { path: 'M12 10v4m0 3h.01' }],
  info: [{ circle: [12, 12, 9] }, { path: 'M12 11v5m0-8h.01' }],
  refresh: [{ path: 'M20 12a8 8 0 1 1-2.3-5.7' }, { path: 'M20 4v5h-5' }],
  github: [{ path: 'M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21' }],
  folder: [{ path: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z' }],
  box: [{ path: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3z' }, { path: 'M12 12 4 7.5M12 12l8-4.5M12 12v9' }],
  ghost: [{ path: 'M5 21V11a7 7 0 0 1 14 0v10l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2L5 21z' }, { path: 'M9 11h.01M15 11h.01' }],
  star: [{ path: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9L6.5 20l1-6.2L3 9.6l6.2-.9L12 3z' }],
};

/**
 * An inline 16px stroke icon, hidden from assistive tech.
 * @param {keyof typeof ICONS} name
 * @param {string} [extraClass]
 */
function icon(name, extraClass = '') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `i${extraClass ? ` ${extraClass}` : ''}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const part of ICONS[name]) {
    if (part.path) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', part.path);
      svg.append(p);
    } else if (part.circle) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', String(part.circle[0]));
      c.setAttribute('cy', String(part.circle[1]));
      c.setAttribute('r', String(part.circle[2]));
      svg.append(c);
    } else if (part.rect) {
      const r = document.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', String(part.rect[0]));
      r.setAttribute('y', String(part.rect[1]));
      r.setAttribute('width', String(part.rect[2]));
      r.setAttribute('height', String(part.rect[3]));
      r.setAttribute('rx', String(part.rect[4]));
      svg.append(r);
    }
  }
  return svg;
}

/** @param {string} id */
function byId(id) {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

/** @param {HTMLElement} el */
function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * A link to another site: never a forced target, always noopener.
 * @param {string} href
 * @param {Record<string, unknown>} attrs
 * @param {...(Node | string | null | false)} children
 */
function extLink(href, attrs, ...children) {
  return h('a', { href, rel: 'noopener noreferrer', ...attrs }, ...children);
}

/** @param {string} isoDate */
function formatDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const storage = {
  /** @param {Storage | null} store @param {string} key */
  get(store, key) {
    try {
      return store?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  /** @param {Storage | null} store @param {string} key @param {string | null} value */
  set(store, key, value) {
    try {
      if (value === null) store?.removeItem(key);
      else store?.setItem(key, value);
    } catch {
      /* private mode or full: the page works without it */
    }
  },
};
/** @param {'localStorage' | 'sessionStorage'} name */
function storeNamed(name) {
  try {
    return window[name];
  } catch {
    return null;
  }
}
const local = storeNamed('localStorage');
const session = storeNamed('sessionStorage');

/* ============ Elements ============ */

const els = {
  shell: byId('shell'),
  side: byId('side'),
  rail: byId('rail'),
  railTagCount: byId('rail-tag-count'),
  fold: byId('fold'),
  search: /** @type {HTMLInputElement} */ (byId('q')),
  clearTags: byId('clear-tags'),
  taglist: byId('taglist'),
  sort: byId('sort'),
  repoLink: /** @type {HTMLAnchorElement} */ (byId('repo-link')),
  repoName: byId('repo-name'),
  catalogUpdated: byId('catalog-updated'),
  catalogUpdatedLink: /** @type {HTMLAnchorElement} */ (byId('catalog-updated-link')),
  refresh: byId('refresh'),
  density: byId('density'),
  densityBars: byId('density-bars'),
  toolbar: byId('toolbar'),
  countShown: byId('count-shown'),
  countTotal: byId('count-total'),
  activeTags: byId('active-tags'),
  reset: byId('reset'),
  bannerSlot: byId('banner-slot'),
  grid: byId('grid'),
  fullstate: byId('fullstate-slot'),
  announce: byId('announce'),
  sheet: /** @type {HTMLDialogElement} */ (byId('sheet')),
  keys: /** @type {HTMLDialogElement} */ (byId('keys')),
};

/* ============ State ============ */

const state = {
  /** @type {PluginEntry[]} enabled, well-formed entries in manifest order */
  entries: [],
  /** @type {Map<string, Outcome>} */
  outcomes: new Map(),
  loaded: false,
  loading: false,
  /** @type {ListState} */
  list: { ...DEFAULT_LIST_STATE },
  collapsed: false,
  density: DENSITY_MAX,
  firstRender: true,
  bannerDismissed: false,
  /** @type {HTMLElement | null} the control that opened the sheet, for focus return */
  openedFrom: null,
  /** whether this page pushed the current #plugin hash (so closing goes back) */
  pushedHash: false,
  closing: false,
  /** whether the sheet is showing, tracked by us so teardown runs exactly once */
  sheetShown: false,
  /** @type {Map<string, HTMLElement>} card elements by id */
  cards: new Map(),
};

/* ============ Announcements ============ */

/** @type {number | undefined} */
let announceTimer;
/** @param {string} text */
function announce(text) {
  els.announce.textContent = '';
  window.clearTimeout(announceTimer);
  announceTimer = window.setTimeout(() => {
    els.announce.textContent = text;
  }, 30);
}

/* ============ Theme, sidebar, density ============ */

/** @param {'light' | 'dark'} theme */
function applyTheme(theme) {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
  else document.documentElement.removeAttribute('data-theme');
  const next = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  for (const b of document.querySelectorAll('[data-theme-toggle]')) b.setAttribute('aria-label', next);
  storage.set(local, 'theme', theme);
}
function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/** @param {boolean} collapsed @param {boolean} [focusAfter] */
function setCollapsed(collapsed, focusAfter = true) {
  state.collapsed = collapsed;
  els.shell.classList.toggle('collapsed', collapsed);
  storage.set(local, 'sidebar', collapsed ? 'collapsed' : 'expanded');
  renderActiveTags();
  if (!focusAfter) return;
  if (collapsed) /** @type {HTMLElement | null} */ (els.rail.querySelector('[data-expand="fold"]'))?.focus();
  else els.fold.focus();
}

/** @param {number} level */
function setDensity(level) {
  state.density = Math.min(DENSITY_MAX, Math.max(1, level));
  els.shell.style.setProperty('--lvl', String(state.density));
  storage.set(local, 'density', String(state.density));
  clear(els.densityBars);
  for (let i = 0; i < DENSITY_MAX; i += 1) {
    const bar = h('i', { class: i < state.density ? 'on' : '' });
    bar.style.height = `${6 + i * 2}px`;
    els.densityBars.append(bar);
  }
  els.density.setAttribute('aria-label', `Card size, level ${state.density} of ${DENSITY_MAX}`);
  const smaller = els.density.querySelector('[data-density="-1"]');
  const larger = els.density.querySelector('[data-density="1"]');
  smaller?.setAttribute('aria-disabled', String(state.density <= 1));
  larger?.setAttribute('aria-disabled', String(state.density >= DENSITY_MAX));
}

/* ============ Fetching ============ */

/** @typedef {{ ok: true, text: string } | { ok: false, failure: { kind: 'http', status: number } | { kind: 'network' } }} FetchOutcome */

/**
 * One plain GET with no custom headers (a preflight would be refused).
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<FetchOutcome>}
 */
async function fetchText(url, init = {}) {
  try {
    const res = await fetch(url, init);
    if (!res.ok) return { ok: false, failure: { kind: 'http', status: res.status } };
    return { ok: true, text: await res.text() };
  } catch {
    return { ok: false, failure: { kind: 'network' } };
  }
}

/** @param {FetchOutcome} outcome */
const isThrottled = (outcome) => !outcome.ok && outcome.failure.kind === 'http' && outcome.failure.status === 429;

/* ============ Catalog cache ============ */

function readCache() {
  const raw = storage.get(session, cacheKey(REPOSITORY));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    if (!Array.isArray(parsed.manifest?.entries) || typeof parsed.entries !== 'object') return null;
    return /** @type {{ entries: PluginEntry[], outcomes: Record<string, Outcome> }} */ ({ entries: parsed.manifest.entries, outcomes: parsed.entries });
  } catch {
    return null;
  }
}

function writeCache() {
  /** @type {Record<string, Outcome>} */
  const outcomes = {};
  for (const [id, outcome] of state.outcomes) outcomes[id] = outcome;
  storage.set(session, cacheKey(REPOSITORY), JSON.stringify({ savedAt: Date.now(), manifest: { entries: state.entries }, entries: outcomes }));
}

function clearCache() {
  state.outcomes = new Map();
  state.entries = [];
  state.loaded = false;
  storage.set(session, cacheKey(REPOSITORY), null);
}

/* ============ Loading the Catalog ============ */

/**
 * Fetches one entry's Plugin Metadata and records the outcome.
 * @param {PluginEntry} entry
 * @param {RequestInit} init
 */
async function loadEntry(entry, init) {
  const res = await fetchText(metadataUrl(REPOSITORY, entry), init);
  const outcome = res.ok ? readPluginMetadata(res.text, entry, REPOSITORY) : brokenFromFetch(res.failure);
  state.outcomes.set(entry.id, outcome);
}

/**
 * Loads the whole Catalog: manifest, then every enabled entry with allSettled.
 * @param {{ reload?: boolean }} [opts]
 */
async function loadCatalog({ reload = false } = {}) {
  if (state.loading) return;
  state.loading = true;
  state.bannerDismissed = false;
  /** @type {RequestInit} */
  const init = reload ? { cache: 'reload' } : {};

  if (!reload) {
    const cached = readCache();
    if (cached) {
      state.entries = cached.entries;
      state.outcomes = new Map(Object.entries(cached.outcomes));
      state.loaded = true;
      state.loading = false;
      renderCatalog();
      return;
    }
  }

  showSkeleton();
  const manifestRes = await fetchText(manifestUrl(REPOSITORY), init);
  if (!manifestRes.ok) {
    state.loading = false;
    showFullState(isThrottled(manifestRes) ? 'throttled' : 'unreachable');
    return;
  }
  /** @type {unknown} */
  let manifestJson;
  try {
    manifestJson = JSON.parse(manifestRes.text);
  } catch {
    manifestJson = null;
  }
  const manifest = readManifest(manifestJson);
  if (!manifest.ok) {
    state.loading = false;
    showFullState('invalid');
    return;
  }
  state.entries = manifest.entries;
  state.outcomes = new Map();
  await Promise.allSettled(state.entries.map((entry) => loadEntry(entry, init)));
  state.loaded = true;
  state.loading = false;
  writeCache();
  renderCatalog();
}

/**
 * Refetches only the given ids (Partial Failure retry, or one entry from the sheet).
 * @param {string[]} ids
 */
async function retryEntries(ids) {
  const wanted = new Set(ids);
  const entries = state.entries.filter((e) => wanted.has(e.id));
  await Promise.allSettled(entries.map((entry) => loadEntry(entry, { cache: 'reload' })));
  writeCache();
  for (const entry of entries) replaceCard(entry.id);
  renderTags();
  renderFooterDate();
  applyList();
  renderBanner();
}

/* ============ Rendering: page states ============ */

function showSkeleton() {
  els.fullstate.hidden = true;
  els.toolbar.hidden = false;
  clear(els.bannerSlot);
  clear(els.grid);
  state.cards = new Map();
  els.grid.setAttribute('aria-busy', 'true');
  els.countShown.textContent = '…';
  els.countTotal.textContent = '…';
  for (let i = 0; i < SKELETON_COUNT; i += 1) {
    els.grid.append(
      h('li', { class: 'card skeleton', 'aria-hidden': 'true' },
        h('div', { class: 'head' }, h('span', { class: 'sk sk-tile' }), h('div', { class: 't' }, h('span', { class: 'sk sk-line w-50' }), h('span', { class: 'sk sk-line w-20' }))),
        h('span', { class: 'sk sk-line w-100' }),
        h('span', { class: 'sk sk-line w-85' }),
        h('span', { class: 'sk sk-line w-40' }),
        h('div', { class: 'foot' }, h('span', { class: 'sk sk-line w-90px' }), h('span', { class: 'sk sk-line w-56px' }))),
    );
  }
}

/**
 * @param {'unreachable' | 'throttled' | 'invalid'} kind
 */
function showFullState(kind) {
  els.toolbar.hidden = true;
  clear(els.bannerSlot);
  clear(els.grid);
  els.grid.removeAttribute('aria-busy');
  state.cards = new Map();
  clear(els.fullstate);
  const tryAgain = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => loadCatalog({ reload: true }) }, icon('refresh'), kind === 'throttled' ? 'Retry' : 'Try again');
  const repoName = `${REPOSITORY.owner}/${REPOSITORY.repo}`;
  /** @type {HTMLElement[]} */
  let body;
  if (kind === 'unreachable') {
    body = [
      h('h2', { text: 'Couldn\'t reach the catalog' }),
      h('p', {}, 'The plugin list at ', h('span', { class: 'mono', text: repoName }), ' didn\'t answer. Check your connection, then try again.'),
      h('div', { class: 'actions' }, tryAgain, extLink(repoUrl(REPOSITORY), { class: 'btn' }, 'Open the repository ', icon('ext'))),
    ];
  } else if (kind === 'throttled') {
    body = [
      h('h2', { text: 'GitHub is limiting downloads from your network' }),
      h('p', { text: 'Too many requests came from your address in a short time. Wait a few minutes, then retry. This isn\'t automatic.' }),
      h('div', { class: 'actions' }, tryAgain, extLink(repoUrl(REPOSITORY), { class: 'btn' }, 'Open the repository ', icon('ext'))),
    ];
  } else {
    body = [
      h('h2', { text: 'The catalog file is malformed' }),
      h('p', {}, h('span', { class: 'mono', text: 'manifest.json' }), ' was found but isn\'t a valid plugin list. If you maintain the repository, check the file; otherwise try again later.'),
      h('div', { class: 'actions' }, tryAgain),
    ];
  }
  els.fullstate.append(h('div', { class: 'fullstate', role: 'alert' }, h('div', { class: 'glyph' }, icon('warn')), ...body));
  els.fullstate.hidden = false;
}

/* ============ Rendering: the Catalog ============ */

function renderCatalog() {
  els.fullstate.hidden = true;
  els.toolbar.hidden = false;
  clear(els.grid);
  els.grid.removeAttribute('aria-busy');
  state.cards = new Map();
  let i = 0;
  for (const entry of state.entries) {
    const outcome = state.outcomes.get(entry.id);
    if (!outcome) continue;
    const card = buildCard(entry, outcome);
    if (state.firstRender) {
      card.classList.add('enter');
      card.style.setProperty('--i', String(i));
    }
    state.cards.set(entry.id, card);
    els.grid.append(card);
    i += 1;
  }
  state.firstRender = false;
  renderTags();
  renderFooterDate();
  applyList();
  renderBanner();
  openFromHash();
}

/** @param {string} id */
function replaceCard(id) {
  const entry = state.entries.find((e) => e.id === id);
  const outcome = state.outcomes.get(id);
  const old = state.cards.get(id);
  if (!entry || !outcome || !old) return;
  const card = buildCard(entry, outcome);
  old.replaceWith(card);
  state.cards.set(id, card);
}

/** The plugins that loaded, in manifest order. */
function okPlugins() {
  /** @type {Plugin[]} */
  const out = [];
  for (const entry of state.entries) {
    const o = state.outcomes.get(entry.id);
    if (o?.status === 'ok') out.push(o.plugin);
  }
  return out;
}

/**
 * A Plugin-shaped stand-in for a Broken Plugin so the same List State logic
 * places its card: searchable by its manifest name, no tags, no Recency.
 * @param {PluginEntry} entry
 * @returns {Plugin}
 */
function brokenStandIn(entry) {
  return {
    id: entry.id, entryName: entry.name, order: entry.order, kind: 'hosted', name: entry.name, description: '', version: '',
    authors: [], status: null, workingStatus: null, lastUpdated: null, releaseDate: null, features: [], sourceUrl: '', changelogUrl: null,
    downloadUrl: '', requirements: [], tags: [], icon: null, license: null, issuesUrl: '', featured: false, pinnedUrl: null, versionUrl: null, servedFrom: null,
  };
}

/** Everything with a card, in manifest order. */
function cardModels() {
  /** @type {Plugin[]} */
  const out = [];
  for (const entry of state.entries) {
    const o = state.outcomes.get(entry.id);
    if (!o) continue;
    out.push(o.status === 'ok' ? o.plugin : brokenStandIn(entry));
  }
  return out;
}

/** Filters, sorts and counts the grid for the current List State; never rebuilds cards. */
function applyList() {
  if (!state.loaded) return;
  const models = cardModels();
  const visible = applyListState(models, state.list);
  const visibleIds = new Set(visible.map((p) => p.id));
  for (const [id, card] of state.cards) card.hidden = !visibleIds.has(id);
  for (const p of visible) {
    const card = state.cards.get(p.id);
    if (card) els.grid.append(card);
  }
  els.countShown.textContent = String(visible.length);
  els.countTotal.textContent = String(models.length);
  els.search.value = state.list.q;
  for (const b of els.sort.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.sort === state.list.sort));
  for (const chip of /** @type {NodeListOf<HTMLElement>} */ (els.taglist.querySelectorAll('.chip'))) chip.setAttribute('aria-pressed', String(state.list.tags.includes(chip.dataset.tag ?? '')));
  els.clearTags.hidden = state.list.tags.length === 0;
  els.railTagCount.textContent = String(state.list.tags.length);
  els.railTagCount.hidden = state.list.tags.length === 0;
  const railTags = els.rail.querySelector('[data-expand="tags"]');
  railTags?.setAttribute('aria-label', state.list.tags.length ? `Show tag filters, ${state.list.tags.length} active` : 'Show tag filters');
  renderActiveTags();
  syncUrl();
}

function syncUrl() {
  const next = `${location.pathname}${formatListState(state.list)}${location.hash}`;
  if (next !== `${location.pathname}${location.search}${location.hash}`) history.replaceState(history.state, '', next);
}

/** @param {Partial<ListState>} patch */
function updateList(patch) {
  state.list = { ...state.list, ...patch };
  applyList();
}

function renderTags() {
  const tags = collectTags(okPlugins());
  const focusedTag = /** @type {HTMLElement | null} */ (els.taglist.querySelector('[tabindex="0"]'))?.dataset.tag;
  clear(els.taglist);
  if (tags.length === 0) {
    els.taglist.append(h('span', { class: 'empty', text: 'No tags yet' }));
    return;
  }
  tags.forEach(({ tag, count }, i) => {
    const pressed = state.list.tags.includes(tag);
    const chip = h('button', {
      type: 'button', class: 'chip', 'data-tag': tag, 'aria-pressed': String(pressed),
      tabindex: (focusedTag ? tag === focusedTag : i === 0) ? '0' : '-1',
      onclick: () => toggleTag(tag),
    }, tag, h('span', { class: 'count num', 'aria-label': `${count} ${count === 1 ? 'plugin' : 'plugins'}`, text: String(count) }));
    els.taglist.append(chip);
  });
  if (focusedTag && !els.taglist.querySelector('[tabindex="0"]')) els.taglist.querySelector('.chip')?.setAttribute('tabindex', '0');
}

/** @param {string} tag */
function toggleTag(tag) {
  const tags = state.list.tags.includes(tag) ? state.list.tags.filter((t) => t !== tag) : [...state.list.tags, tag];
  updateList({ tags });
}

function renderActiveTags() {
  clear(els.activeTags);
  if (!state.collapsed) return;
  for (const tag of state.list.tags) {
    els.activeTags.append(
      h('button', { type: 'button', class: 'chip', 'aria-pressed': 'true', 'aria-label': `Remove tag filter ${tag}`, onclick: () => toggleTag(tag) }, tag, icon('close')),
    );
  }
}

function renderFooterDate() {
  const date = catalogUpdatedDate(okPlugins());
  if (!date) {
    els.catalogUpdated.hidden = true;
    return;
  }
  els.catalogUpdatedLink.textContent = formatDate(date);
  els.catalogUpdatedLink.href = `${repoUrl(REPOSITORY)}/commits/${REPOSITORY.ref}`;
  els.catalogUpdated.hidden = false;
}

function brokenIds() {
  /** @type {string[]} */
  const ids = [];
  for (const entry of state.entries) if (state.outcomes.get(entry.id)?.status === 'broken') ids.push(entry.id);
  return ids;
}

function renderBanner() {
  clear(els.bannerSlot);
  const failed = brokenIds();
  if (failed.length === 0 || state.bannerDismissed) return;
  const throttled = failed.some((id) => /** @type {{ throttled?: boolean }} */ (state.outcomes.get(id)).throttled);
  const n = failed.length;
  const m = state.entries.length;
  const banner = h('div', { class: 'banner banner-warn', role: 'status' },
    icon('warn'),
    h('div', { class: 'grow' },
      h('strong', { text: `${n} of ${m} plugins could not be loaded.` }),
      ' ',
      throttled ? THROTTLED_COPY : 'The rest of the catalog is fine. Failed entries are marked below.'),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', onclick: /** @param {Event} e */ (e) => {
        const b = /** @type {HTMLButtonElement} */ (e.currentTarget);
        b.disabled = true;
        retryEntries(failed);
      } }, icon('refresh'), `Retry those ${n}`),
      h('button', { type: 'button', class: 'btn btn-quiet btn-icon', 'aria-label': 'Dismiss', onclick: () => {
        state.bannerDismissed = true;
        renderBanner();
      } }, icon('close'))));
  els.bannerSlot.append(banner);
}

/* ============ Rendering: cards ============ */

/**
 * @param {Plugin} p
 * @param {number} max
 */
function authorChips(p, max) {
  const chips = p.authors.slice(0, max).map((a) => h('span', { class: 'author', text: a }));
  if (p.authors.length > max) chips.push(h('span', { class: 'author more', text: `+${p.authors.length - max}` }));
  return chips;
}

/** @param {Plugin} p @param {boolean} large */
function tile(p, large) {
  const t = h('span', { class: `tile${large ? ' lg' : ''}`, 'aria-hidden': 'true' });
  t.style.setProperty('--h', String(hue(p.name)));
  if (p.icon) {
    const img = h('img', { src: p.icon, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => {
      clear(t);
      t.textContent = initials(p.name);
    });
    t.append(img);
  } else {
    t.textContent = initials(p.name);
  }
  return t;
}

/** @param {Plugin} p */
function updatedBadge(p) {
  const today = new Date();
  if (!isRecentlyUpdated(p.lastUpdated, today)) return null;
  const days = daysSince(p.lastUpdated, today) ?? 0;
  const text = `Updated ${days} ${days === 1 ? 'day' : 'days'} ago`;
  return h('span', { class: 'badge badge-updated', title: text }, icon('check'), h('span', { 'aria-hidden': 'true', text: `${days}d` }), h('span', { class: 'sr-only', text: text }));
}

/** @param {Plugin} p */
function featuredBadge(p) {
  if (!p.featured) return null;
  return h('span', { class: 'badge badge-featured', title: 'Featured' }, icon('star'), h('span', { class: 'sr-only', text: 'Featured' }));
}

/**
 * The card's open control: the name as a Deep Link. A click records where to
 * return focus and that this page pushed the hash, then lets the browser navigate.
 * @param {string} id
 * @param {string} name
 * @param {string} label   accessible name
 */
function openControl(id, name, label) {
  const open = h('a', { class: 'name', href: deepLinkHash(id), 'aria-label': label, text: name });
  open.addEventListener('click', () => {
    state.openedFrom = open;
    state.pushedHash = true;
  });
  return open;
}

/**
 * @param {PluginEntry} entry
 * @param {Outcome} outcome
 */
function buildCard(entry, outcome) {
  if (outcome.status === 'broken') return buildBrokenCard(entry, outcome);
  const p = outcome.plugin;
  const today = new Date();
  const days = daysSince(p.lastUpdated, today);
  const recent = isRecentlyUpdated(p.lastUpdated, today);
  const label = `${p.name}, version ${p.version}${recent ? `, updated ${days} ${days === 1 ? 'day' : 'days'} ago` : ''}. Open details`;
  const card = h('li', { class: 'card', 'data-id': p.id });
  card.style.setProperty('--h', String(hue(p.name)));
  const open = openControl(p.id, p.name, label);
  card.append(
    h('div', { class: 'head' },
      tile(p, false),
      h('div', { class: 't' }, open, h('span', { class: 'ver mono num', text: `v${p.version}` })),
      h('span', { class: 'badges' }, featuredBadge(p), updatedBadge(p))),
    h('p', { class: 'desc', text: p.description.split(/\n\s*\n/)[0] }),
  );
  if (p.tags.length) {
    card.append(h('div', { class: 'card-tags' }, ...p.tags.map((t) => h('button', { type: 'button', tabindex: '-1', title: `Show all ${t} plugins`, text: t, onclick: () => updateList({ tags: [t] }) }))));
  }
  card.append(
    h('div', { class: 'foot' },
      h('span', { class: 'meta-line' }, ...authorChips(p, 2)),
      h('span', { class: 'go', 'aria-hidden': 'true' }, 'Details ', icon('chevron'))),
  );
  return card;
}

/**
 * @param {PluginEntry} entry
 * @param {{ status: 'broken', reason: string }} outcome
 */
function buildBrokenCard(entry, outcome) {
  const card = h('li', { class: 'card broken', 'data-id': entry.id });
  const open = openControl(entry.id, entry.name, `${entry.name}, couldn't load. Open details`);
  card.append(
    h('div', { class: 'head' },
      h('span', { class: 'tile warn', 'aria-hidden': 'true' }, icon('warn')),
      h('div', { class: 't' }, open, h('span', { class: 'ver', text: 'didn\'t load' })),
      h('span', { class: 'badges' }, h('span', { class: 'badge badge-bad', text: 'Couldn\'t load' }))),
    h('p', { class: 'desc' }, outcome.reason, ' ', h('span', { class: 'fine', text: 'Everything else loaded normally.' })),
    h('div', { class: 'foot' },
      h('span', { class: 'meta-line', text: 'Retry from the banner above' }),
      h('span', { class: 'go', 'aria-hidden': 'true' }, 'Details ', icon('chevron'))),
  );
  return card;
}

/* ============ The Detail View: bottom sheet ============ */

/** The sheet's close button: first in DOM order (CSS places it last visually). */
function closeButton() {
  return h('button', { type: 'button', class: 'btn btn-quiet d-close', 'data-close': '', 'aria-label': 'Close' }, icon('close'));
}

/** The Fallback Link: plain navigation to the artifact's live location. @param {string} url */
function fallbackLink(url) {
  return extLink(url, { class: 'fallback' }, 'Open raw file ', icon('ext'));
}

/** Copies this page's Deep Link for a plugin. @param {string} id */
function copyLinkButton(id) {
  const button = h('button', { type: 'button', class: 'btn btn-quiet' }, icon('link'), 'Copy link');
  button.addEventListener('click', () => copyText(pageDeepLink(id), [button]));
  return button;
}

/**
 * Copies text and flashes the given controls green while announcing "Copied".
 * @param {string} text
 * @param {HTMLElement[]} flash
 */
async function copyText(text, flash) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    announce('Copy failed');
    return;
  }
  announce('Copied');
  for (const el of flash) el.classList.add('done');
  window.setTimeout(() => {
    for (const el of flash) el.classList.remove('done');
  }, COPY_FLASH_MS);
}

/** @param {string} id */
const pageDeepLink = (id) => `${location.origin}${location.pathname}${deepLinkHash(id)}`;

/**
 * The Blob download flow with the Header Check.
 * @param {string} url
 * @param {string} filename
 * @param {HTMLButtonElement} button
 * @param {HTMLElement} stateEl
 * @param {string} idleLabel
 */
async function saveArtifact(url, filename, button, stateEl, idleLabel) {
  const setState = /** @param {'idle' | 'fetching' | 'saved' | 'failed'} s @param {Node[]} [content] */ (s, content = []) => {
    clear(stateEl);
    stateEl.className = `state${s === 'saved' ? ' ok' : s === 'failed' ? ' bad' : ''}`;
    stateEl.append(...content);
    button.disabled = s === 'fetching';
    const label = /** @type {HTMLElement} */ (button.querySelector('.label'));
    label.textContent = s === 'fetching' ? 'Downloading…' : idleLabel;
  };
  setState('fetching', [icon('refresh'), h('span', { text: `Fetching ${filename}…` })]);
  const res = await fetchText(url);
  if (!res.ok) {
    const why = isThrottled(res) ? THROTTLED_COPY : res.failure.kind === 'http' ? `The file could not be fetched (${res.failure.status}). Use the raw file link instead.` : 'The file could not be fetched (network error). Use the raw file link instead.';
    setState('failed', [icon('warn'), h('span', { text: why })]);
    return;
  }
  if (!passesHeaderCheck(res.text)) {
    setState('failed', [icon('warn'), h('span', { text: 'This file does not look like a BetterDiscord plugin. Nothing was saved — use the raw file link instead.' })]);
    return;
  }
  const blob = new Blob([res.text], { type: 'text/javascript' });
  const href = URL.createObjectURL(blob);
  const a = h('a', { href, download: filename, class: 'sr-only' });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  setState('saved', [icon('check'), h('span', {}, 'Saved as ', h('span', { class: 'mono', text: filename }), '. Move it into your plugins folder.')]);
}

/**
 * The Plugins Folder Hint: three OS paths, each a copy control.
 */
function folderHint() {
  const rows = pluginsFolderRows(detectPlatform(navigator));
  const paths = h('div', { class: 'paths' });
  for (const row of rows) {
    const code = h('code', { text: row.path });
    const pathButton = h('button', { type: 'button', class: 'path', title: 'Click to copy', 'aria-label': `Copy ${row.os} path` }, code);
    const copyButton = h('button', { type: 'button', class: 'btn btn-quiet copy-path', 'aria-label': `Copy ${row.os} path` }, icon('copy'));
    const copy = () => copyText(row.path, [pathButton, copyButton]);
    pathButton.addEventListener('click', copy);
    copyButton.addEventListener('click', copy);
    const label = h('b', { text: row.os, title: row.note ?? undefined });
    paths.append(h('div', { class: 'pathline' }, label, h('span', { class: 'pathrow' }, pathButton, copyButton, row.you ? h('span', { class: 'you', text: 'you\'re probably here' }) : null)));
  }
  return h('details', { class: 'hint' }, h('summary', {}, icon('chevron', 'chev'), icon('folder'), 'Where does the file go?'), paths);
}

/** @param {Plugin} p */
function sheetHeader(p) {
  const today = new Date();
  const ver = versionLink(p, REPOSITORY);
  const verNode = ver
    ? extLink(ver.href, { class: 'mono num', title: ver.title }, `v${p.version}`)
    : h('span', { class: 'mono num', text: `v${p.version}` });
  const authors = p.authors.map((a) => {
    const url = authorProfileUrl(a);
    return url ? extLink(url, { class: 'author', title: 'GitHub profile' }, a) : h('span', { class: 'author', text: a });
  });
  const sub = h('div', { class: 'sub' }, verNode, ...authors, isRecentlyUpdated(p.lastUpdated, today) ? updatedBadge(p) : null, p.featured ? h('span', { class: 'badge badge-featured' }, icon('star'), 'Featured') : null);
  return h('div', { class: 'd-head' }, closeButton(), tile(p, true), h('div', { class: 't' }, h('h2', { id: 'sheet-title', text: p.name }), sub));
}

/** @param {Plugin} p */
function sheetActions(p) {
  const filename = artifactFilename(p);
  const actions = h('div', { class: 'd-actions' });
  const stateEl = h('span', { class: 'state', 'aria-live': 'polite' });
  if (isAllowlisted(p.downloadUrl)) {
    const download = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-primary' }, icon('down'), h('span', { class: 'label', text: 'Download' })));
    download.addEventListener('click', () => saveArtifact(p.downloadUrl, filename, download, stateEl, 'Download'));
    actions.append(download);
  }
  const copyRaw = h('button', { type: 'button', class: 'btn', title: 'Copies the live URL' }, icon('copy'), 'Copy raw URL');
  copyRaw.addEventListener('click', () => copyText(p.downloadUrl, [copyRaw]));
  actions.append(copyRaw);
  const pinned = pinnedCommit(p.pinnedUrl);
  if (pinned && p.pinnedUrl) {
    const label = `Download snapshot ${pinned.shortSha}`;
    const snapshot = /** @type {HTMLButtonElement} */ (h('button', { type: 'button', class: 'btn btn-quiet', title: `Point-in-time copy from ${pinned.repository}` }, icon('box'), h('span', { class: 'label' }, 'Download snapshot ', h('span', { class: 'mono', text: pinned.shortSha }))));
    snapshot.addEventListener('click', () => saveArtifact(/** @type {string} */ (p.pinnedUrl), filename, snapshot, stateEl, label));
    actions.append(snapshot);
  }
  actions.append(fallbackLink(p.downloadUrl), stateEl);
  return actions;
}

/** @param {string} tag */
function sheetTagButton(tag) {
  return h('button', { type: 'button', title: `Show all ${tag} plugins`, text: tag, onclick: () => {
    state.list = { ...state.list, q: '', tags: [tag] };
    closeSheet();
    applyList();
    els.grid.scrollIntoView({ block: 'start', behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } });
}

/** @param {Plugin} p */
function sheetBody(p) {
  const body = h('div', { class: 'd-body' });
  body.append(sheetActions(p), folderHint());

  const desc = h('div', { class: 'd-desc' });
  for (const para of p.description.split(/\n\s*\n/)) if (para.trim()) desc.append(h('p', { text: para.trim() }));
  body.append(desc);

  if (p.features.length) {
    body.append(h('div', { class: 'd-sect' }, h('h3', { text: 'Features' }), h('ul', { class: 'd-feat' }, ...p.features.map((f) => h('li', {}, icon('check'), h('span', { text: f }))))));
  }

  const dl = h('dl', { class: 'd-meta' });
  /** @param {string} term @param {Node | string | null} value */
  const row = (term, value) => {
    if (value === null) return;
    dl.append(h('dt', { text: term }), h('dd', {}, value));
  };
  const status = [p.status, p.workingStatus].filter(Boolean).join(' · ');
  row('Status', status || null);
  row('Released', p.releaseDate ? h('span', { class: 'num', text: formatDate(p.releaseDate) }) : null);
  const history = historyUrl(p);
  row('Updated', p.lastUpdated ? (history ? extLink(history, { class: 'num', title: 'What changed' }, formatDate(p.lastUpdated)) : h('span', { class: 'num', text: formatDate(p.lastUpdated) })) : null);
  row('License', p.license ? extLink(licenseUrl(p.license), { title: 'Licence text' }, p.license) : null);
  row('Tags', p.tags.length ? h('span', { class: 'card-tags' }, ...p.tags.map(sheetTagButton)) : null);
  row('Requirements', p.requirements.length ? h('ul', {}, ...p.requirements.map((r) => h('li', { text: r }))) : null);
  const kindBadge = h('span', { class: 'badge badge-kind', text: p.kind === 'external' ? 'External' : 'Hosted' });
  row('Served from', p.servedFrom ? h('span', {}, extLink(`https://github.com/${p.servedFrom}`, { class: 'mono' }, p.servedFrom), kindBadge) : kindBadge);
  body.append(h('div', { class: 'd-sect' }, h('h3', { text: 'Details' }), dl));

  if (p.kind === 'external') {
    const pinned = pinnedCommit(p.pinnedUrl);
    body.append(h('div', { class: 'd-note' }, icon('info'), h('span', {},
      'This plugin is served from another repository. The download above fetches its live file',
      pinned ? h('span', {}, '; the snapshot is our own copy pinned to commit ', extLink(pinned.commitUrl, { class: 'mono' }, pinned.shortSha), '.') : '.')));
  }

  body.append(h('div', { class: 'd-sect' }, h('h3', { text: 'Links' }), h('div', { class: 'd-links' },
    extLink(p.sourceUrl, { class: 'btn' }, icon('github'), 'Source'),
    p.changelogUrl ? extLink(p.changelogUrl, { class: 'btn' }, icon('ext'), 'Changelog') : null,
    extLink(p.issuesUrl, { class: 'btn' }, icon('warn'), 'Report an issue'),
    copyLinkButton(p.id))));
  return body;
}

/**
 * @param {PluginEntry} entry
 * @param {{ status: 'broken', reason: string, downloadUrl?: string }} outcome
 */
function brokenSheet(entry, outcome) {
  const head = h('div', { class: 'd-head' },
    closeButton(),
    h('span', { class: 'tile lg warn', 'aria-hidden': 'true' }, icon('warn')),
    h('div', { class: 't' }, h('h2', { id: 'sheet-title', text: entry.name }), h('div', { class: 'sub' }, h('span', { class: 'badge badge-bad', text: 'Couldn\'t load' }))));
  const derived = derivedUrls(REPOSITORY, entry);
  const retry = h('button', { type: 'button', class: 'btn' }, icon('refresh'), 'Retry');
  retry.addEventListener('click', async () => {
    /** @type {HTMLButtonElement} */ (retry).disabled = true;
    await retryEntries([entry.id]);
    renderSheet(entry.id);
  });
  const body = h('div', { class: 'd-body d-broken' },
    h('div', { class: 'banner banner-bad' }, icon('warn'), h('div', { class: 'grow' }, h('strong', { text: 'This plugin\'s details couldn\'t be read.' }), ' ', outcome.reason, ' The plugin itself may still work; you can fetch the raw file directly.')),
    h('div', { class: 'd-actions' }, retry, fallbackLink(outcome.downloadUrl ?? derived.downloadUrl)),
    h('div', { class: 'd-links' }, extLink(derived.sourceUrl, { class: 'btn' }, icon('github'), 'Source folder'), copyLinkButton(entry.id)));
  return [head, body];
}

/** @param {string} id */
function notFoundSheet(id) {
  const head = h('div', { class: 'd-head' }, closeButton(), h('div', { class: 't' }, h('h2', { id: 'sheet-title', class: 'sr-only', text: 'Plugin not found' })));
  const body = h('div', { class: 'd-nf' },
    h('div', { class: 'glyph' }, icon('ghost')),
    h('h2', {}, 'No plugin called ', h('code', { text: id })),
    h('p', { text: 'The link may be old, or the plugin was removed from the catalog.' }),
    h('button', { type: 'button', class: 'btn btn-primary', 'data-close': '', text: 'Back to the catalog' }));
  return [head, body];
}

/** @param {string} id */
function renderSheet(id) {
  clear(els.sheet);
  els.sheet.append(h('span', { class: 'handle', 'aria-hidden': 'true' }));
  const entry = state.entries.find((e) => e.id === id);
  const outcome = entry ? state.outcomes.get(id) : undefined;
  if (!entry || !outcome) els.sheet.append(...notFoundSheet(id));
  else if (outcome.status === 'broken') els.sheet.append(...brokenSheet(entry, outcome));
  else els.sheet.append(sheetHeader(outcome.plugin), sheetBody(outcome.plugin));
}

/** @param {string} id */
function openSheet(id) {
  renderSheet(id);
  if (!els.sheet.open) {
    els.sheet.showModal();
    document.body.classList.add('locked');
  }
  state.sheetShown = true;
  state.closing = false; // an open (e.g. Back landing on another plugin) supersedes a pending close
  els.sheet.scrollTop = 0;
  /** @type {HTMLElement | null} */ (els.sheet.querySelector('.d-close'))?.focus();
}

/**
 * Teardown after the sheet has closed: unlock scrolling, reset the open/close
 * bookkeeping, and return focus. Idempotent, because it runs both from our own
 * close paths and from the dialog's close event (which not every embedder fires).
 */
function finishClose() {
  if (!state.sheetShown) return;
  state.sheetShown = false;
  document.body.classList.remove('locked');
  const back = state.openedFrom && state.openedFrom.isConnected ? state.openedFrom : els.search;
  state.openedFrom = null;
  state.pushedHash = false;
  state.closing = false;
  // After the browser's own focus restoration, which can land on <body>.
  window.setTimeout(() => back.focus(), 0);
}

function closeDialog() {
  if (els.sheet.open) els.sheet.close();
  finishClose();
}

/** Closes the sheet the way it was opened: back out of the pushed hash, or clear it. */
function closeSheet() {
  if (!els.sheet.open || state.closing) return;
  state.closing = true;
  if (state.pushedHash) {
    history.back();
  } else {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    closeDialog();
  }
}

function openFromHash() {
  if (!state.loaded) return;
  const id = parseDeepLink(location.hash);
  if (id !== null) openSheet(id);
  else if (els.sheet.open) closeDialog();
}

els.sheet.addEventListener('cancel', (e) => {
  e.preventDefault();
  closeSheet();
});
els.sheet.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  if (target.closest('[data-close]')) closeSheet();
  else if (target === els.sheet) closeSheet();
});
els.sheet.addEventListener('close', finishClose);
window.addEventListener('hashchange', openFromHash);

/* ============ Keyboard: shortcuts overlay and roving groups ============ */

els.keys.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement} */ (e.target);
  if (target.closest('[data-close]') || target === els.keys) els.keys.close();
});

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const target = /** @type {HTMLElement | null} */ (e.target);
  const inField = !!target && (target.matches('input, textarea, select') || target.isContentEditable);
  if (e.key === 'Escape') {
    // Route Escape ourselves: not every environment fires the dialog's native cancel.
    if (els.keys.open) {
      e.preventDefault();
      els.keys.close();
    } else if (els.sheet.open) {
      e.preventDefault();
      closeSheet();
    }
    return;
  }
  const isHelp = e.key === '?' || (e.code === 'Slash' && e.shiftKey);
  if (isHelp && els.keys.open) {
    e.preventDefault();
    els.keys.close();
    return;
  }
  if (inField || els.sheet.open || els.keys.open) return;
  if (isHelp) {
    e.preventDefault();
    els.keys.showModal();
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    if (state.collapsed) setCollapsed(false, false);
    els.search.focus();
    els.search.select();
    return;
  }
  if (e.key === '[') {
    e.preventDefault();
    setCollapsed(!state.collapsed);
  }
});

/** Roving tabindex: one Tab stop per group, arrows / Home / End move inside it. */
document.addEventListener('keydown', (e) => {
  const target = /** @type {HTMLElement | null} */ (e.target);
  const group = target?.closest('.roving');
  if (!group || !target) return;
  const items = /** @type {HTMLElement[]} */ ([...group.querySelectorAll('button:not([hidden])')]);
  const i = items.indexOf(target);
  if (i < 0) return;
  /** @type {Record<string, number>} */
  const steps = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1, Home: -i, End: items.length - 1 - i };
  const step = steps[e.key];
  if (step === undefined) return;
  e.preventDefault();
  e.stopPropagation();
  const next = items[(i + step + items.length) % items.length];
  for (const item of items) item.tabIndex = -1;
  next.tabIndex = 0;
  next.focus();
});
document.addEventListener('click', (e) => {
  const target = /** @type {HTMLElement | null} */ (e.target);
  const button = target?.closest('.roving button');
  const group = button?.closest('.roving');
  if (!button || !group) return;
  for (const item of group.querySelectorAll('button')) item.tabIndex = -1;
  /** @type {HTMLElement} */ (button).tabIndex = 0;
});

/* ============ Wiring the sidebar and toolbar ============ */

/** @type {number | undefined} */
let searchTimer;
els.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    if (els.search.value !== state.list.q) updateList({ q: els.search.value });
  }, SEARCH_DEBOUNCE_MS);
});
els.clearTags.addEventListener('click', (e) => {
  e.preventDefault();
  updateList({ tags: [] });
});
els.sort.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-sort]'));
  if (b) updateList({ sort: /** @type {SortKey} */ (b.dataset.sort) });
});
els.reset.addEventListener('click', (e) => {
  e.preventDefault();
  state.list = { ...DEFAULT_LIST_STATE };
  applyList();
});
els.fold.addEventListener('click', () => setCollapsed(true));
els.rail.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-expand]'));
  if (!b) return;
  setCollapsed(false, false);
  switch (b.dataset.expand) {
    case 'search':
      els.search.focus();
      break;
    case 'tags':
      /** @type {HTMLElement | null} */ (els.taglist.querySelector('[tabindex="0"]'))?.focus();
      break;
    case 'sort':
      /** @type {HTMLElement | null} */ (els.sort.querySelector('[tabindex="0"]'))?.focus();
      break;
    default:
      els.fold.focus();
  }
});
for (const b of document.querySelectorAll('[data-theme-toggle]')) {
  b.addEventListener('click', () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light'));
}
els.density.addEventListener('click', (e) => {
  const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (e.target).closest('[data-density]'));
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  setDensity(state.density + Number(b.dataset.density));
});
els.refresh.addEventListener('click', () => {
  if (els.sheet.open) closeSheet();
  clearCache();
  loadCatalog({ reload: true });
});

/* ============ Boot ============ */

els.repoLink.href = repoUrl(REPOSITORY);
els.repoName.textContent = `${REPOSITORY.owner}/${REPOSITORY.repo}`;
applyTheme(storage.get(local, 'theme') === 'light' ? 'light' : 'dark');
const savedDensity = Number(storage.get(local, 'density'));
setDensity(savedDensity >= 1 && savedDensity <= DENSITY_MAX ? savedDensity : DENSITY_MAX);
setCollapsed(storage.get(local, 'sidebar') === 'collapsed', false);
state.list = parseListState(location.search);
els.search.value = state.list.q;
loadCatalog();
