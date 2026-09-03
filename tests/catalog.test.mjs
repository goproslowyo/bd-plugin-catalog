import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readManifest,
  readPluginMetadata,
  brokenFromFetch,
  applyListState,
  parseListState,
  formatListState,
  parseDeepLink,
  artifactFilename,
  passesHeaderCheck,
  versionLink,
  historyUrl,
  pinnedCommit,
  authorProfileUrl,
  daysSince,
  isRecentlyUpdated,
  hue,
  initials,
  collectTags,
  catalogUpdatedDate,
  cacheKey,
  pluginsFolderRows,
} from '../catalog.js';

const REPO = { owner: 'goproslowyo', repo: 'bd-plugins', ref: 'main' };
const ENTRY = { id: 'better-pin-dms', name: 'BetterPinDMs', order: 8 };

const seedPinDms = {
  name: 'BetterPinDMs',
  description: 'Enhanced DM pinning.',
  author: 'Pharaoh2k',
  version: '3.0.1',
  status: 'Active',
  workingStatus: 'Working',
  lastUpdated: '2026-08-27',
  releaseDate: '2025-11-24',
  features: ['Pin DMs'],
  sourceUrl: 'https://github.com/Pharaoh2k/BetterDiscordStuff/tree/main/Plugins/BetterPinDMs',
  changelogUrl: 'https://raw.githubusercontent.com/Pharaoh2k/BetterDiscordStuff/main/Plugins/BetterPinDMs/CHANGELOG.md',
  downloadUrl: 'https://raw.githubusercontent.com/Pharaoh2k/BetterDiscordStuff/main/Plugins/BetterPinDMs/BetterPinDMs.plugin.js',
  pinnedUrl: 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/75c20e7/Plugins/BetterPinDMs/BetterPinDMs.plugin.js',
};

test('readPluginMetadata: a seed plugin is an External entry with stated URLs kept verbatim', () => {
  const result = readPluginMetadata(JSON.stringify(seedPinDms), ENTRY, REPO);
  assert.equal(result.status, 'ok');
  const p = result.plugin;
  assert.equal(p.id, 'better-pin-dms');
  assert.equal(p.entryName, 'BetterPinDMs');
  assert.equal(p.kind, 'external');
  assert.equal(p.name, 'BetterPinDMs');
  assert.equal(p.version, '3.0.1');
  assert.deepEqual(p.authors, ['Pharaoh2k']);
  assert.equal(p.downloadUrl, seedPinDms.downloadUrl);
  assert.equal(p.sourceUrl, seedPinDms.sourceUrl);
  assert.equal(p.changelogUrl, seedPinDms.changelogUrl);
  assert.equal(p.pinnedUrl, seedPinDms.pinnedUrl);
  assert.equal(p.lastUpdated, '2026-08-27');
  assert.equal(p.releaseDate, '2025-11-24');
  assert.deepEqual(p.features, ['Pin DMs']);
  assert.deepEqual(p.tags, []);
  assert.equal(p.featured, false);
  assert.equal(p.issuesUrl, 'https://github.com/goproslowyo/bd-plugins/issues');
  assert.equal(p.servedFrom, 'Pharaoh2k/BetterDiscordStuff');
});

test('readPluginMetadata: a Hosted entry with no URL fields derives them from the manifest name and ref', () => {
  const body = JSON.stringify({ name: 'Hosted Derived', description: 'd', version: '1.0.0', author: 'Fixture' });
  const entry = { id: 'hosted-derived', name: 'HostedDerived', order: 0 };
  const repo = { owner: 'goproslowyo', repo: 'bd-plugins', ref: 'test/broken' };
  const result = readPluginMetadata(body, entry, repo);
  assert.equal(result.status, 'ok');
  const p = result.plugin;
  assert.equal(p.kind, 'hosted');
  assert.equal(p.downloadUrl, 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/test/broken/Plugins/HostedDerived/HostedDerived.plugin.js');
  assert.equal(p.sourceUrl, 'https://github.com/goproslowyo/bd-plugins/tree/test/broken/Plugins/HostedDerived');
  assert.equal(p.changelogUrl, 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/test/broken/Plugins/HostedDerived/CHANGELOG.md');
  assert.equal(p.servedFrom, 'goproslowyo/bd-plugins');
});

test('readPluginMetadata: a downloadUrl inside the Content Repository on any ref is still Hosted', () => {
  const body = JSON.stringify({
    name: 'X', description: 'd', version: '1', author: 'A',
    downloadUrl: 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/abc1234/Plugins/X/X.plugin.js',
  });
  const result = readPluginMetadata(body, { id: 'x', name: 'X', order: 0 }, REPO);
  assert.equal(result.plugin.kind, 'hosted');
  assert.equal(result.plugin.downloadUrl, 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/abc1234/Plugins/X/X.plugin.js');
  assert.equal(result.plugin.sourceUrl, 'https://github.com/goproslowyo/bd-plugins/tree/main/Plugins/X');
});

test('readPluginMetadata: Broken when JSON is malformed', () => {
  const result = readPluginMetadata('{ "name": "x",', ENTRY, REPO);
  assert.deepEqual(result, { status: 'broken', reason: 'plugin.json is not valid JSON.' });
});

test('readPluginMetadata: Broken when a required field is missing or mistyped', () => {
  const missing = readPluginMetadata(JSON.stringify({ name: 'x', description: 'd', version: '1' }), ENTRY, REPO);
  assert.deepEqual(missing, { status: 'broken', reason: 'Required field “author” is missing.' });
  const mistyped = readPluginMetadata(JSON.stringify({ name: 'x', description: 'd', version: 5, author: 'a' }), ENTRY, REPO);
  assert.deepEqual(mistyped, { status: 'broken', reason: 'Required field “version” has the wrong type.' });
  const notObject = readPluginMetadata('[1,2]', ENTRY, REPO);
  assert.deepEqual(notObject, { status: 'broken', reason: 'plugin.json is not a JSON object.' });
});

test('readPluginMetadata: an External entry without sourceUrl is Broken', () => {
  const body = JSON.stringify({
    name: 'x', description: 'd', version: '1', author: 'a',
    downloadUrl: 'https://raw.githubusercontent.com/someone/else/main/X.plugin.js',
  });
  const result = readPluginMetadata(body, ENTRY, REPO);
  assert.deepEqual(result, { status: 'broken', reason: 'Required field “sourceUrl” is missing.' });
});

test('readPluginMetadata: bad optional fields are dropped individually and the entry still renders', () => {
  const body = JSON.stringify({
    name: 'BadOptionals',
    description: 'd',
    version: '1.0.0',
    author: 'Fixture, Second Author, ,',
    lastUpdated: 'yesterday',
    releaseDate: '2026-13-45',
    features: 'not-an-array',
    tags: 'not-an-array',
    icon: 'http://example.com/icon.png',
    issuesUrl: 'ftp://example.com/issues',
    license: 42,
    featured: 'yes',
    pinnedUrl: 'http://example.com/pinned.plugin.js',
    unknownKey: 'must be ignored',
    sourceUrl: 'https://github.com/goproslowyo/bd-plugins/tree/test/broken/Plugins/BadOptionals',
    downloadUrl: 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/test/broken/Plugins/BadOptionals/BadOptionals.plugin.js',
  });
  const result = readPluginMetadata(body, { id: 'bad-optionals', name: 'BadOptionals', order: 0 }, REPO);
  assert.equal(result.status, 'ok');
  const p = result.plugin;
  assert.deepEqual(p.authors, ['Fixture', 'Second Author']);
  assert.equal(p.lastUpdated, null);
  assert.equal(p.releaseDate, null);
  assert.deepEqual(p.features, []);
  assert.deepEqual(p.tags, []);
  assert.equal(p.icon, null);
  assert.equal(p.issuesUrl, 'https://github.com/goproslowyo/bd-plugins/issues');
  assert.equal(p.license, null);
  assert.equal(p.featured, false);
  assert.equal(p.pinnedUrl, null);
  assert.equal('unknownKey' in p, false);
});

test('readPluginMetadata: icon and pinnedUrl must be https on raw.githubusercontent.com, pinnedUrl needs a commit segment', () => {
  const base = { name: 'x', description: 'd', version: '1', author: 'a' };
  const read = (extra) => readPluginMetadata(JSON.stringify({ ...base, ...extra }), ENTRY, REPO).plugin;
  assert.equal(read({ icon: 'https://raw.githubusercontent.com/o/r/main/icon.png' }).icon, 'https://raw.githubusercontent.com/o/r/main/icon.png');
  assert.equal(read({ icon: 'https://example.com/icon.png' }).icon, null);
  assert.equal(read({ pinnedUrl: 'https://raw.githubusercontent.com/o/r/main/X.plugin.js' }).pinnedUrl, null);
  assert.equal(read({ pinnedUrl: 'https://raw.githubusercontent.com/o/r/75c20e7/X.plugin.js' }).pinnedUrl, 'https://raw.githubusercontent.com/o/r/75c20e7/X.plugin.js');
  assert.equal(read({ versionUrl: 'https://example.com/v1' }).versionUrl, 'https://example.com/v1');
  assert.equal(read({ versionUrl: 'http://example.com/v1' }).versionUrl, null);
});

test('readPluginMetadata: a real but non-existent date is treated as absent', () => {
  const base = { name: 'x', description: 'd', version: '1', author: 'a' };
  const read = (extra) => readPluginMetadata(JSON.stringify({ ...base, ...extra }), ENTRY, REPO).plugin;
  assert.equal(read({ lastUpdated: '2026-02-30' }).lastUpdated, null);
  assert.equal(read({ lastUpdated: '2026-02-28' }).lastUpdated, '2026-02-28');
  assert.equal(read({ lastUpdated: '2026-2-8' }).lastUpdated, null);
});

test('readManifest keeps enabled slug entries in array order and skips the rest', () => {
  const manifest = {
    lastUpdated: '2026-02-17',
    plugins: [
      { id: 'better-pin-dms', name: 'BetterPinDMs', enabled: true },
      { id: 'hidden-disabled', name: 'HiddenDisabled', enabled: false },
      { id: 'Not A Slug', name: 'NotASlug', enabled: true },
      { name: 'NoId', enabled: true },
      { id: 'no-name', enabled: true },
      { id: 'no-enabled-flag', name: 'NoEnabled' },
      { id: 'audio-toolbox', name: 'AudioToolbox', enabled: true },
    ],
  };
  const result = readManifest(manifest);
  assert.equal(result.ok, true);
  assert.deepEqual(result.entries.map((e) => e.id), ['better-pin-dms', 'audio-toolbox']);
  assert.deepEqual(result.entries[0], { id: 'better-pin-dms', name: 'BetterPinDMs', order: 0 });
  assert.deepEqual(result.entries[1], { id: 'audio-toolbox', name: 'AudioToolbox', order: 6 });
});

test('readManifest reports an invalid manifest when plugins is not an array', () => {
  assert.deepEqual(readManifest({ plugins: 'nope' }), { ok: false, reason: 'invalid' });
  assert.deepEqual(readManifest(null), { ok: false, reason: 'invalid' });
  assert.deepEqual(readManifest([]), { ok: false, reason: 'invalid' });
});

/* ---------- fetch outcomes ---------- */

test('brokenFromFetch names the HTTP status, a network error, or throttling', () => {
  assert.deepEqual(brokenFromFetch({ kind: 'http', status: 404 }), { status: 'broken', reason: 'plugin.json could not be fetched (404).', throttled: false });
  assert.deepEqual(brokenFromFetch({ kind: 'http', status: 429 }), { status: 'broken', reason: 'GitHub is limiting downloads from your network.', throttled: true });
  assert.deepEqual(brokenFromFetch({ kind: 'network' }), { status: 'broken', reason: 'plugin.json could not be fetched (network error).', throttled: false });
});

/* ---------- filter and sort ---------- */

const plugin = (over) => ({
  id: over.id, entryName: over.name, order: over.order ?? 0, kind: 'external', name: over.name,
  description: over.description ?? '', version: '1.0.0', authors: over.authors ?? ['Pharaoh2k'],
  status: null, workingStatus: null, lastUpdated: over.lastUpdated ?? null, releaseDate: null,
  features: [], sourceUrl: 'https://github.com/o/r', changelogUrl: null, downloadUrl: 'https://raw.githubusercontent.com/o/r/main/x.plugin.js',
  requirements: [], tags: over.tags ?? [], icon: null, license: null, issuesUrl: 'https://github.com/o/r/issues',
  featured: false, pinnedUrl: null, versionUrl: null, servedFrom: 'o/r',
});
const CATALOG = [
  plugin({ id: 'better-pin-dms', name: 'BetterPinDMs', order: 0, description: 'Enhanced DM pinning.', tags: ['dms', 'organisation'], lastUpdated: '2026-08-27' }),
  plugin({ id: 'audio-toolbox', name: 'AudioToolbox', order: 1, description: 'Audio toolkit.', tags: ['audio', 'files'], lastUpdated: '2026-08-27' }),
  plugin({ id: 'show-all-channels', name: 'ShowAllChannelsAuto', order: 2, description: 'Show all channels.', tags: ['channels'], lastUpdated: null }),
  plugin({ id: 'better-file-viewer', name: 'BetterFileViewer', order: 3, description: 'View files.', tags: ['files'], authors: ['Pharaoh2k', 'AGreenPig'], lastUpdated: '2026-09-01' }),
];

test('applyListState: search is a case-insensitive substring over name, description, authors and tags', () => {
  const ids = (state) => applyListState(CATALOG, state).map((p) => p.id);
  assert.deepEqual(ids({ q: 'PIN', tags: [], sort: 'catalog' }), ['better-pin-dms']);
  assert.deepEqual(ids({ q: 'greenpig', tags: [], sort: 'catalog' }), ['better-file-viewer']);
  assert.deepEqual(ids({ q: 'organis', tags: [], sort: 'catalog' }), ['better-pin-dms']);
  assert.deepEqual(ids({ q: 'toolkit', tags: [], sort: 'catalog' }), ['audio-toolbox']);
  assert.deepEqual(ids({ q: '  ', tags: [], sort: 'catalog' }).length, 4);
});

test('applyListState: selected tags are OR-ed', () => {
  const ids = applyListState(CATALOG, { q: '', tags: ['dms', 'channels'], sort: 'catalog' }).map((p) => p.id);
  assert.deepEqual(ids, ['better-pin-dms', 'show-all-channels']);
});

test('applyListState: Updated sorts by Recency descending, undated last, ties by manifest order', () => {
  const ids = applyListState(CATALOG, { q: '', tags: [], sort: 'updated' }).map((p) => p.id);
  assert.deepEqual(ids, ['better-file-viewer', 'better-pin-dms', 'audio-toolbox', 'show-all-channels']);
});

test('applyListState: A–Z sorts by name and catalog keeps manifest order', () => {
  assert.deepEqual(applyListState(CATALOG, { q: '', tags: [], sort: 'name' }).map((p) => p.name), ['AudioToolbox', 'BetterFileViewer', 'BetterPinDMs', 'ShowAllChannelsAuto']);
  const shuffled = [CATALOG[3], CATALOG[0], CATALOG[2], CATALOG[1]];
  assert.deepEqual(applyListState(shuffled, { q: '', tags: [], sort: 'catalog' }).map((p) => p.order), [0, 1, 2, 3]);
});

/* ---------- List State in the query string ---------- */

test('parseListState reads q, repeated tag, and sort; unknown sort falls back to catalog', () => {
  assert.deepEqual(parseListState('?q=pin&tag=dms&tag=files&sort=updated'), { q: 'pin', tags: ['dms', 'files'], sort: 'updated' });
  assert.deepEqual(parseListState('?sort=bogus'), { q: '', tags: [], sort: 'catalog' });
  assert.deepEqual(parseListState(''), { q: '', tags: [], sort: 'catalog' });
  assert.deepEqual(parseListState('?sort=name&tag=&tag=a'), { q: '', tags: ['a'], sort: 'name' });
});

test('formatListState omits defaults so a plain visit has a clean address', () => {
  assert.equal(formatListState({ q: '', tags: [], sort: 'catalog' }), '');
  assert.equal(formatListState({ q: 'pin', tags: [], sort: 'catalog' }), '?q=pin');
  assert.equal(formatListState({ q: '', tags: ['a', 'b'], sort: 'name' }), '?tag=a&tag=b&sort=name');
  assert.equal(formatListState({ q: 'a b', tags: [], sort: 'updated' }), '?q=a+b&sort=updated');
});

test('parseDeepLink reads #plugin/<id> and nothing else', () => {
  assert.equal(parseDeepLink('#plugin/better-pin-dms'), 'better-pin-dms');
  assert.equal(parseDeepLink('#plugin/Not%20A%20Slug'), 'Not A Slug');
  assert.equal(parseDeepLink('#grid'), null);
  assert.equal(parseDeepLink(''), null);
  assert.equal(parseDeepLink('#plugin/'), null);
});

/* ---------- download ---------- */

test('artifactFilename prefers the manifest name, then the URL segment, then the slug', () => {
  assert.equal(artifactFilename({ entryName: 'BetterPinDMs', id: 'better-pin-dms', downloadUrl: 'https://raw.githubusercontent.com/x/y/main/Plugins/BetterPinDMs/BetterPinDMs.plugin.js' }), 'BetterPinDMs.plugin.js');
  assert.equal(artifactFilename({ entryName: 'ExternalOtherRepo', id: 'external-other-repo', downloadUrl: 'https://raw.githubusercontent.com/mwittrien/BetterDiscordAddons/master/Plugins/ImageUtilities/ImageUtilities.plugin.js' }), 'ExternalOtherRepo.plugin.js');
  assert.equal(artifactFilename({ entryName: 'Bad Name!', id: 'bad-name', downloadUrl: 'https://raw.githubusercontent.com/x/y/main/ImageUtilities.plugin.js' }), 'ImageUtilities.plugin.js');
  assert.equal(artifactFilename({ entryName: 'Bad Name!', id: 'bad-name', downloadUrl: 'https://raw.githubusercontent.com/x/y/main/README.md' }), 'bad-name.plugin.js');
});

test('passesHeaderCheck looks at the first kilobyte for a META header', () => {
  assert.equal(passesHeaderCheck('/**\n * @name BetterPinDMs\n * @author Pharaoh2k\n */\nmodule.exports = class {}'), true);
  assert.equal(passesHeaderCheck('# README\n\nThis is not a plugin.'), false);
  assert.equal(passesHeaderCheck('/** nothing here */'), false);
  assert.equal(passesHeaderCheck('x'.repeat(1024) + '/** @name late */'), false);
  assert.equal(passesHeaderCheck(''), false);
});

/* ---------- links ---------- */

test('versionLink: stated versionUrl, else the Hosted tag, else the file history with an honest title', () => {
  const hosted = { ...plugin({ id: 'hosted-derived', name: 'HostedDerived' }), kind: 'hosted', servedFrom: 'goproslowyo/bd-plugins', version: '1.0.0' };
  assert.deepEqual(versionLink(hosted), { href: 'https://github.com/goproslowyo/bd-plugins/tree/HostedDerived/v1.0.0/Plugins/HostedDerived', title: 'This version in the repository' });
  const external = { ...plugin({ id: 'better-pin-dms', name: 'BetterPinDMs' }), servedFrom: 'Pharaoh2k/BetterDiscordStuff' };
  assert.deepEqual(versionLink(external), { href: 'https://github.com/Pharaoh2k/BetterDiscordStuff/commits/main/Plugins/BetterPinDMs/BetterPinDMs.plugin.js', title: 'No per-version link for this plugin; opens its change history' });
  assert.deepEqual(versionLink({ ...external, versionUrl: 'https://example.com/v1' }), { href: 'https://example.com/v1', title: 'This version in the repository' });
  assert.equal(versionLink({ ...external, servedFrom: null }), null);
});

test('historyUrl uses the served-from repository and the manifest name', () => {
  assert.equal(historyUrl({ ...plugin({ id: 'x', name: 'BetterPinDMs' }), servedFrom: 'Pharaoh2k/BetterDiscordStuff' }), 'https://github.com/Pharaoh2k/BetterDiscordStuff/commits/main/Plugins/BetterPinDMs/BetterPinDMs.plugin.js');
  assert.equal(historyUrl({ ...plugin({ id: 'x', name: 'X' }), servedFrom: null }), null);
});

test('pinnedCommit extracts the repository and sha from a pinnedUrl', () => {
  assert.deepEqual(pinnedCommit('https://raw.githubusercontent.com/goproslowyo/bd-plugins/75c20e7/Plugins/BetterPinDMs/BetterPinDMs.plugin.js'), {
    repository: 'goproslowyo/bd-plugins', sha: '75c20e7', shortSha: '75c20e7', commitUrl: 'https://github.com/goproslowyo/bd-plugins/commit/75c20e7',
  });
  assert.equal(pinnedCommit('https://raw.githubusercontent.com/goproslowyo/bd-plugins/75c20e7f1c2d3e4a5b6c7d8e9f0a1b2c3d4e5f6a/X.plugin.js').shortSha, '75c20e7');
  assert.equal(pinnedCommit(null), null);
});

test('authorProfileUrl links GitHub-shaped names only', () => {
  assert.equal(authorProfileUrl('Pharaoh2k'), 'https://github.com/Pharaoh2k');
  assert.equal(authorProfileUrl('CarJem Generations'), null);
  assert.equal(authorProfileUrl('-dash'), null);
  assert.equal(authorProfileUrl('a'), 'https://github.com/a');
});

/* ---------- Recency ---------- */

test('daysSince and isRecentlyUpdated use a 30-day window from the given today', () => {
  const today = new Date('2026-09-03T12:00:00Z');
  assert.equal(daysSince('2026-08-27', today), 7);
  assert.equal(daysSince('2026-09-03', today), 0);
  assert.equal(daysSince(null, today), null);
  assert.equal(isRecentlyUpdated('2026-08-04', today), true);
  assert.equal(isRecentlyUpdated('2026-08-03', today), false);
  assert.equal(isRecentlyUpdated(null, today), false);
});

/* ---------- presentation helpers ---------- */

test('hue maps a name into the 200–289 band deterministically', () => {
  const h = hue('BetterPinDMs');
  assert.equal(h, hue('BetterPinDMs'));
  assert.ok(h >= 200 && h < 290);
  assert.notEqual(hue('AudioToolbox'), hue('BetterPinDMs'));
});

test('initials takes the first letters of the first two words', () => {
  assert.equal(initials('BetterPinDMs'), 'BP');
  assert.equal(initials('QuickMessages-Reborn'), 'QM');
  assert.equal(initials('AudioToolbox'), 'AT');
  assert.equal(initials('x'), 'X');
});

test('collectTags lists the tags present, sorted A–Z, with counts', () => {
  assert.deepEqual(collectTags(CATALOG), [
    { tag: 'audio', count: 1 }, { tag: 'channels', count: 1 }, { tag: 'dms', count: 1 }, { tag: 'files', count: 2 }, { tag: 'organisation', count: 1 },
  ]);
});

test('catalogUpdatedDate is the newest lastUpdated among rendered entries, or null', () => {
  assert.equal(catalogUpdatedDate(CATALOG), '2026-09-01');
  assert.equal(catalogUpdatedDate([CATALOG[2]]), null);
});

test('cacheKey names the repository, ref and schema version', () => {
  assert.match(cacheKey(REPO), /^catalog:goproslowyo\/bd-plugins@main:v\d+$/);
});

test('pluginsFolderRows lists the visitor OS first and marks it', () => {
  const win = pluginsFolderRows('windows');
  assert.deepEqual(win.map((r) => r.os), ['Windows', 'macOS', 'Linux']);
  assert.equal(win[0].you, true);
  assert.equal(win[0].path, '%APPDATA%\\BetterDiscord\\plugins');
  const mac = pluginsFolderRows('mac');
  assert.deepEqual(mac.map((r) => r.os), ['macOS', 'Windows', 'Linux']);
  assert.equal(mac[0].you, true);
  assert.equal(mac[0].path, '~/Library/Application Support/BetterDiscord/plugins');
  const linux = pluginsFolderRows('linux');
  assert.equal(linux[0].os, 'Linux');
  assert.equal(linux[0].path, '$XDG_CONFIG_HOME/BetterDiscord/plugins');
  assert.equal(linux[0].note, 'Defaults to ~/.config/BetterDiscord/plugins');
  const unknown = pluginsFolderRows(null);
  assert.deepEqual(unknown.map((r) => r.os), ['Windows', 'macOS', 'Linux']);
  assert.equal(unknown.some((r) => r.you), false);
});
