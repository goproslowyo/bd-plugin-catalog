import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readManifest,
  readPluginMetadata,
  brokenFromFetch,
  applyListState,
  nextSort,
  parseListState,
  formatListState,
  parseDeepLink,
  deepLinkHash,
  artifactFilename,
  passesHeaderCheck,
  versionLink,
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
  detectPlatform,
  readUpstream,
  upstreamMetadataUrl,
  upstreamVersionUrl,
  readUpstreamVersion,
  upstreamState,
  forkChangesRange,
  forkChangesUrl,
  artifactDiffAnchor,
} from '../catalog.js';
import { createHash } from 'node:crypto';

const REPO = { owner: 'goproslowyo', repo: 'bd-plugins', ref: 'main' };
const ENTRY = { id: 'better-pin-dms', name: 'BetterPinDMs' };

/** Reads a plugin.json body with the four required fields plus `extra`, for ENTRY in REPO. */
const readMinimal = (extra = {}) => readPluginMetadata(JSON.stringify({ name: 'x', description: 'd', version: '1', author: 'a', ...extra }), ENTRY, REPO);

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
  const entry = { id: 'hosted-derived', name: 'HostedDerived' };
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
  const stated = 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/abc1234/Plugins/BetterPinDMs/BetterPinDMs.plugin.js';
  const p = readMinimal({ downloadUrl: stated }).plugin;
  assert.equal(p.kind, 'hosted');
  assert.equal(p.downloadUrl, stated);
  assert.equal(p.sourceUrl, 'https://github.com/goproslowyo/bd-plugins/tree/main/Plugins/BetterPinDMs');
});

test('readPluginMetadata: a stated downloadUrl that is not https is dropped, so the entry is Hosted with derived locations', () => {
  const p = readMinimal({ downloadUrl: 'http://example.com/X.plugin.js' }).plugin;
  assert.equal(p.kind, 'hosted');
  assert.equal(p.downloadUrl, 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/main/Plugins/BetterPinDMs/BetterPinDMs.plugin.js');
  assert.equal(p.sourceUrl, 'https://github.com/goproslowyo/bd-plugins/tree/main/Plugins/BetterPinDMs');
  assert.equal(p.changelogUrl, 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/main/Plugins/BetterPinDMs/CHANGELOG.md');
});

test('readPluginMetadata: Broken reasons for malformed JSON, a non-object body, and a required field missing or mistyped', () => {
  assert.deepEqual(readPluginMetadata('{ "name": "x",', ENTRY, REPO), { status: 'broken', reason: 'plugin.json is not valid JSON.' });
  assert.deepEqual(readPluginMetadata('[1,2]', ENTRY, REPO), { status: 'broken', reason: 'plugin.json is not a JSON object.' });
  assert.deepEqual(readMinimal({ author: undefined }), { status: 'broken', reason: 'Required field “author” is missing.' });
  assert.deepEqual(readMinimal({ version: 5 }), { status: 'broken', reason: 'Required field “version” has the wrong type.' });
});

test('readPluginMetadata: an External entry without sourceUrl is Broken, and a Broken entry keeps its stated downloadUrl for the Fallback Link', () => {
  const stated = 'https://raw.githubusercontent.com/someone/else/main/X.plugin.js';
  assert.deepEqual(readMinimal({ downloadUrl: stated }), { status: 'broken', reason: 'Required field “sourceUrl” is missing.', downloadUrl: stated });
  assert.deepEqual(readMinimal({ downloadUrl: stated, version: 5 }), { status: 'broken', reason: 'Required field “version” has the wrong type.', downloadUrl: stated });
});

test('readPluginMetadata: bad optional fields are dropped individually and the entry still renders', () => {
  const body = JSON.stringify({
    name: 'BadOptionals',
    description: 'd',
    version: '1.0.0',
    author: 'Fixture, Second Author, ,',
    features: 'not-an-array',
    tags: ['a', 5, 'b'],
    icon: 'http://example.com/icon.png',
    issuesUrl: 'ftp://example.com/issues',
    license: 42,
    featured: 'yes',
    pinnedUrl: 'http://example.com/pinned.plugin.js',
    unknownKey: 'must be ignored',
    sourceUrl: 'https://github.com/goproslowyo/bd-plugins/tree/test/broken/Plugins/BadOptionals',
    downloadUrl: 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/test/broken/Plugins/BadOptionals/BadOptionals.plugin.js',
  });
  const result = readPluginMetadata(body, { id: 'bad-optionals', name: 'BadOptionals' }, REPO);
  assert.equal(result.status, 'ok');
  const p = result.plugin;
  assert.deepEqual(p.authors, ['Fixture', 'Second Author']);
  assert.deepEqual(p.features, []);
  assert.deepEqual(p.tags, []);
  assert.equal(p.icon, null);
  assert.equal(p.issuesUrl, 'https://github.com/goproslowyo/bd-plugins/issues');
  assert.equal(p.license, null);
  assert.equal(p.featured, false);
  assert.equal(p.pinnedUrl, null);
  assert.equal('unknownKey' in p, false);
});

test('readPluginMetadata: features, requirements and tags are trimmed and empties dropped', () => {
  const p = readMinimal({ features: [' Pin DMs ', ''], requirements: ['', ' ZeresPluginLibrary '], tags: [' dms ', ' '] }).plugin;
  assert.deepEqual(p.features, ['Pin DMs']);
  assert.deepEqual(p.requirements, ['ZeresPluginLibrary']);
  assert.deepEqual(p.tags, ['dms']);
});

test('readPluginMetadata: icon and pinnedUrl must be https on the Allowlisted Host (pinnedUrl with a commit segment); versionUrl must be https', () => {
  const read = (extra) => readMinimal(extra).plugin;
  assert.equal(read({ icon: 'https://raw.githubusercontent.com/o/r/main/icon.png' }).icon, 'https://raw.githubusercontent.com/o/r/main/icon.png');
  assert.equal(read({ icon: 'https://example.com/icon.png' }).icon, null);
  assert.equal(read({ pinnedUrl: 'https://raw.githubusercontent.com/o/r/main/X.plugin.js' }).pinnedUrl, null);
  assert.equal(read({ pinnedUrl: 'https://raw.githubusercontent.com/o/r/75c20e7/X.plugin.js' }).pinnedUrl, 'https://raw.githubusercontent.com/o/r/75c20e7/X.plugin.js');
  assert.equal(read({ versionUrl: 'https://example.com/v1' }).versionUrl, 'https://example.com/v1');
  assert.equal(read({ versionUrl: 'http://example.com/v1' }).versionUrl, null);
});

test('readPluginMetadata: lastUpdated and releaseDate must be real YYYY-MM-DD dates, otherwise the plugin has no Recency', () => {
  const cases = [['2026-02-28', '2026-02-28'], ['2026-02-30', null], ['2026-13-45', null], ['2026-2-8', null], ['yesterday', null], [20260228, null]];
  for (const [input, expected] of cases) {
    const p = readMinimal({ lastUpdated: input, releaseDate: input }).plugin;
    assert.equal(p.lastUpdated, expected, `lastUpdated ${input}`);
    assert.equal(p.releaseDate, expected, `releaseDate ${input}`);
  }
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
  assert.deepEqual(readManifest(manifest), [{ id: 'better-pin-dms', name: 'BetterPinDMs' }, { id: 'audio-toolbox', name: 'AudioToolbox' }]);
});

test('readManifest is null for an invalid manifest: no plugins array', () => {
  assert.equal(readManifest({ plugins: 'nope' }), null);
  assert.equal(readManifest(null), null);
  assert.equal(readManifest([]), null);
});

/* ---------- fetch outcomes ---------- */

test('brokenFromFetch names the HTTP status, a network error, or throttling', () => {
  assert.deepEqual(brokenFromFetch({ kind: 'http', status: 404 }), { status: 'broken', reason: 'plugin.json could not be fetched (404).', throttled: false });
  assert.deepEqual(brokenFromFetch({ kind: 'http', status: 429 }), {
    status: 'broken',
    reason: 'GitHub is limiting downloads from your network. Wait a few minutes, then retry. This isn\'t automatic.',
    throttled: true,
  });
  assert.deepEqual(brokenFromFetch({ kind: 'network' }), { status: 'broken', reason: 'plugin.json could not be fetched (network error).', throttled: false });
});

/* ---------- filter and sort ---------- */

const plugin = (over) => ({
  id: over.id, entryName: over.name, kind: 'external', name: over.name,
  description: over.description ?? '', version: '1.0.0', authors: over.authors ?? ['Pharaoh2k'],
  status: null, workingStatus: null, lastUpdated: over.lastUpdated ?? null, releaseDate: over.releaseDate ?? null,
  features: [], sourceUrl: 'https://github.com/o/r', changelogUrl: null, downloadUrl: 'https://raw.githubusercontent.com/o/r/main/x.plugin.js',
  requirements: [], tags: over.tags ?? [], icon: null, license: null, issuesUrl: 'https://github.com/o/r/issues',
  featured: false, pinnedUrl: null, versionUrl: null, servedFrom: 'o/r', upstream: null,
});
const CATALOG = [
  plugin({ id: 'better-pin-dms', name: 'BetterPinDMs', description: 'Enhanced DM pinning.', tags: ['dms', 'organisation'], lastUpdated: '2026-08-27', releaseDate: '2025-11-24' }),
  plugin({ id: 'audio-toolbox', name: 'AudioToolbox', description: 'Audio toolkit.', tags: ['audio', 'files'], lastUpdated: '2026-08-27', releaseDate: '2026-01-10' }),
  plugin({ id: 'show-all-channels', name: 'ShowAllChannelsAuto', description: 'Show all channels.', tags: ['channels'], lastUpdated: null, releaseDate: null }),
  plugin({ id: 'better-file-viewer', name: 'BetterFileViewer', description: 'View files.', tags: ['files'], authors: ['Pharaoh2k', 'AGreenPig'], lastUpdated: '2026-09-01', releaseDate: '2025-11-24' }),
];
/** A List State with the default sort (Updated, newest first). @param {object} over */
const listState = (over = {}) => ({ q: '', tags: [], sort: 'updated', dir: 'desc', ...over });

test('applyListState: search is a case-insensitive substring over name, description, authors and tags', () => {
  const ids = (over) => applyListState(CATALOG, listState(over)).map((p) => p.id);
  assert.deepEqual(ids({ q: 'PIN' }), ['better-pin-dms']);
  assert.deepEqual(ids({ q: 'greenpig' }), ['better-file-viewer']);
  assert.deepEqual(ids({ q: 'organis' }), ['better-pin-dms']);
  assert.deepEqual(ids({ q: 'toolkit' }), ['audio-toolbox']);
  assert.equal(ids({ q: '  ' }).length, 4);
});

test('applyListState: selected tags are OR-ed', () => {
  const ids = applyListState(CATALOG, listState({ tags: ['dms', 'channels'] })).map((p) => p.id);
  assert.deepEqual(ids, ['better-pin-dms', 'show-all-channels']);
});

test('applyListState: Updated sorts by Recency descending, undated last, ties by name', () => {
  const ids = applyListState(CATALOG, listState({ sort: 'updated', dir: 'desc' })).map((p) => p.id);
  assert.deepEqual(ids, ['better-file-viewer', 'audio-toolbox', 'better-pin-dms', 'show-all-channels']);
});

test('applyListState: Updated ascending is oldest first with undated entries still last', () => {
  const ids = applyListState(CATALOG, listState({ sort: 'updated', dir: 'asc' })).map((p) => p.id);
  assert.deepEqual(ids, ['audio-toolbox', 'better-pin-dms', 'better-file-viewer', 'show-all-channels']);
});

test('applyListState: Released sorts by releaseDate in both directions, undated last, ties by name', () => {
  const ids = (dir) => applyListState(CATALOG, listState({ sort: 'released', dir })).map((p) => p.id);
  assert.deepEqual(ids('desc'), ['audio-toolbox', 'better-file-viewer', 'better-pin-dms', 'show-all-channels']);
  assert.deepEqual(ids('asc'), ['better-file-viewer', 'better-pin-dms', 'audio-toolbox', 'show-all-channels']);
});

test('applyListState: Name sorts A–Z and Z–A', () => {
  const names = (dir) => applyListState(CATALOG, listState({ sort: 'name', dir })).map((p) => p.name);
  assert.deepEqual(names('asc'), ['AudioToolbox', 'BetterFileViewer', 'BetterPinDMs', 'ShowAllChannelsAuto']);
  assert.deepEqual(names('desc'), ['ShowAllChannelsAuto', 'BetterPinDMs', 'BetterFileViewer', 'AudioToolbox']);
});

test('applyListState: two undated entries keep name order under a date sort', () => {
  const undated = [plugin({ id: 'z', name: 'Zeta' }), plugin({ id: 'a', name: 'Alpha' })];
  for (const dir of ['asc', 'desc']) assert.deepEqual(applyListState(undated, listState({ sort: 'released', dir })).map((p) => p.id), ['a', 'z'], dir);
});

test('nextSort reverses the current key and opens another key in its natural direction', () => {
  assert.deepEqual(nextSort({ sort: 'updated', dir: 'desc' }, 'updated'), { sort: 'updated', dir: 'asc' });
  assert.deepEqual(nextSort({ sort: 'updated', dir: 'asc' }, 'updated'), { sort: 'updated', dir: 'desc' });
  assert.deepEqual(nextSort({ sort: 'updated', dir: 'asc' }, 'released'), { sort: 'released', dir: 'desc' });
  assert.deepEqual(nextSort({ sort: 'released', dir: 'desc' }, 'name'), { sort: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ sort: 'name', dir: 'asc' }, 'name'), { sort: 'name', dir: 'desc' });
  assert.deepEqual(nextSort({ sort: 'name', dir: 'desc' }, 'updated'), { sort: 'updated', dir: 'desc' });
});

/* ---------- List State in the query string ---------- */

test('parseListState reads dir; an unknown or absent dir is the key\'s natural direction', () => {
  assert.deepEqual(parseListState('?dir=asc'), listState({ dir: 'asc' }));
  assert.deepEqual(parseListState('?sort=name&dir=desc'), listState({ sort: 'name', dir: 'desc' }));
  assert.deepEqual(parseListState('?sort=released&dir=sideways'), listState({ sort: 'released', dir: 'desc' }));
  assert.deepEqual(parseListState('?sort=released'), listState({ sort: 'released', dir: 'desc' }));
  assert.deepEqual(parseListState('?sort=bogus&dir=asc'), listState({ dir: 'asc' }));
});

test('formatListState writes dir only when it differs from the key\'s natural direction', () => {
  assert.equal(formatListState(listState({ dir: 'asc' })), '?dir=asc');
  assert.equal(formatListState(listState({ sort: 'released', dir: 'asc' })), '?sort=released&dir=asc');
  assert.equal(formatListState(listState({ sort: 'name', dir: 'desc' })), '?sort=name&dir=desc');
  assert.equal(formatListState(listState({ sort: 'name', dir: 'asc' })), '?sort=name');
});

test('every sort key and direction round-trips through the query string', () => {
  for (const sort of ['updated', 'released', 'name']) {
    for (const dir of ['asc', 'desc']) {
      const state = listState({ sort, dir });
      assert.deepEqual(parseListState(formatListState(state)), state, `${sort} ${dir}`);
    }
  }
});

test('parseListState reads q, repeated tag, and sort; unknown sort falls back to Updated', () => {
  assert.deepEqual(parseListState('?q=pin&tag=dms&tag=files&sort=name'), { q: 'pin', tags: ['dms', 'files'], sort: 'name', dir: 'asc' });
  assert.deepEqual(parseListState('?sort=bogus'), listState());
  assert.deepEqual(parseListState(''), listState());
  assert.deepEqual(parseListState('?sort=name&tag=&tag=a'), listState({ tags: ['a'], sort: 'name', dir: 'asc' }));
});

test('formatListState omits defaults so a plain visit has a clean address', () => {
  assert.equal(formatListState(listState()), '');
  assert.equal(formatListState(listState({ q: 'pin' })), '?q=pin');
  assert.equal(formatListState(listState({ tags: ['a', 'b'], sort: 'name', dir: 'asc' })), '?tag=a&tag=b&sort=name');
  assert.equal(formatListState(listState({ q: 'a b', sort: 'released', dir: 'desc' })), '?q=a+b&sort=released');
});

test('List State survives a round trip through the query string with spaces, & and + in the search text and a tag', () => {
  const state = listState({ q: 'a b & c+d', tags: ['x & y', 'p+q'], sort: 'name', dir: 'asc' });
  assert.deepEqual(parseListState(formatListState(state)), state);
});

test('parseDeepLink reads #plugin/<id> and nothing else', () => {
  assert.equal(parseDeepLink('#plugin/better-pin-dms'), 'better-pin-dms');
  assert.equal(parseDeepLink('#plugin/Not%20A%20Slug'), 'Not A Slug');
  assert.equal(parseDeepLink('#grid'), null);
  assert.equal(parseDeepLink(''), null);
  assert.equal(parseDeepLink('#plugin/'), null);
});

test('Deep Link hash round-trips an id, and an undecodable hash keeps its raw id', () => {
  for (const id of ['better-pin-dms', 'Not A Slug', 'a%b', 'x/y?z#w']) assert.equal(parseDeepLink(deepLinkHash(id)), id, id);
  assert.equal(parseDeepLink('#plugin/%E0'), '%E0');
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

test('versionLink: stated versionUrl, else the artifact at the Pinned Copy commit, else the file history with an honest title', () => {
  const exact = 'This version in the repository';
  const pinnedUrl = 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/75c20e7/Plugins/BetterPinDMs/BetterPinDMs.plugin.js';
  const hosted = { ...plugin({ id: 'hosted-derived', name: 'HostedDerived' }), kind: 'hosted', servedFrom: 'goproslowyo/bd-plugins' };
  assert.deepEqual(versionLink({ ...hosted, pinnedUrl }), { href: 'https://github.com/goproslowyo/bd-plugins/blob/75c20e7/Plugins/HostedDerived/HostedDerived.plugin.js', title: exact });
  assert.deepEqual(versionLink(hosted), { href: 'https://github.com/goproslowyo/bd-plugins/commits/main/Plugins/HostedDerived/HostedDerived.plugin.js', title: 'No per-version link for this plugin; opens its change history' });
  const external = { ...plugin({ id: 'better-pin-dms', name: 'BetterPinDMs' }), servedFrom: 'Pharaoh2k/BetterDiscordStuff' };
  assert.deepEqual(versionLink({ ...external, pinnedUrl }), { href: 'https://github.com/goproslowyo/bd-plugins/blob/75c20e7/Plugins/BetterPinDMs/BetterPinDMs.plugin.js', title: exact });
  assert.deepEqual(versionLink(external), { href: 'https://github.com/Pharaoh2k/BetterDiscordStuff/commits/main/Plugins/BetterPinDMs/BetterPinDMs.plugin.js', title: 'No per-version link for this plugin; opens its change history' });
  assert.deepEqual(versionLink({ ...external, pinnedUrl, versionUrl: 'https://example.com/v1' }), { href: 'https://example.com/v1', title: exact });
  assert.equal(versionLink({ ...external, servedFrom: null }), null);
});

test('pinnedCommit extracts the repository and sha from a pinnedUrl', () => {
  const url = 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/75c20e7/Plugins/BetterPinDMs/BetterPinDMs.plugin.js';
  assert.deepEqual(pinnedCommit(url), {
    url, repository: 'goproslowyo/bd-plugins', sha: '75c20e7', shortSha: '75c20e7', commitUrl: 'https://github.com/goproslowyo/bd-plugins/commit/75c20e7',
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

test('pluginsFolderRows lists the visitor OS first and marks it, or Windows first unmarked without a signal', () => {
  assert.deepEqual(pluginsFolderRows('mac'), [
    { os: 'macOS', path: '~/Library/Application Support/BetterDiscord/plugins', note: null, you: true },
    { os: 'Windows', path: '%APPDATA%\\BetterDiscord\\plugins', note: null, you: false },
    { os: 'Linux', path: '$XDG_CONFIG_HOME/BetterDiscord/plugins', note: 'Defaults to ~/.config/BetterDiscord/plugins', you: false },
  ]);
  assert.deepEqual(pluginsFolderRows('linux').map((r) => r.os), ['Linux', 'Windows', 'macOS']);
  const unknown = pluginsFolderRows(null);
  assert.deepEqual(unknown.map((r) => r.os), ['Windows', 'macOS', 'Linux']);
  assert.equal(unknown.some((r) => r.you), false);
});

test('detectPlatform reads Windows, macOS and Linux from the navigator, and nothing from Android or an empty one', () => {
  const cases = [
    [{ userAgentData: { platform: 'Windows' }, platform: 'Win32', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }, 'windows'],
    [{ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, 'mac'],
    [{ platform: 'Linux x86_64', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }, 'linux'],
    [{ platform: 'Linux armv8l', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' }, null],
    [{}, null],
    [{ userAgentData: { platform: 'macOS' }, platform: 'darwin' }, 'mac'],
  ];
  for (const [nav, expected] of cases) assert.equal(detectPlatform(nav), expected, JSON.stringify(nav));
});

/* ---------- Upstream, Upstream Check, Fork Changes ---------- */

const ECT_ENTRY = { id: 'enhanced-channel-tabs', name: 'EnhancedChannelTabs' };
const ECT_UPSTREAM = {
  url: 'https://github.com/Pharaoh2k/BetterDiscordStuff/tree/main/Plugins/EnhancedChannelTabs',
  version: '5.0.15',
  commit: '79939c8',
  forkPoint: '75c20e7',
};
const readHostedWithUpstream = (upstream) => readPluginMetadata(JSON.stringify({ name: 'x', description: 'd', version: '5.0.16', author: 'a', upstream }), ECT_ENTRY, REPO);

test('readUpstream keeps a well-formed object and parses the Upstream folder out of its tree URL', () => {
  assert.deepEqual(readUpstream(ECT_UPSTREAM), {
    ...ECT_UPSTREAM, owner: 'Pharaoh2k', repo: 'BetterDiscordStuff', ref: 'main', name: 'EnhancedChannelTabs',
  });
  assert.equal(readUpstream({ ...ECT_UPSTREAM, version: '  5.0.15 ' }).version, '5.0.15');
});

test('readUpstream is all-or-nothing: one malformed member drops the whole object', () => {
  assert.equal(readUpstream(null), null);
  assert.equal(readUpstream('https://github.com/o/r'), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, url: 'https://github.com/Pharaoh2k/BetterDiscordStuff' }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, url: 'http://github.com/o/r/tree/main/Plugins/X' }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, url: 'https://gitlab.com/o/r/tree/main/Plugins/X' }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, version: '' }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, version: 5 }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, commit: 'abc' }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, commit: 'ABCDEF1' }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, forkPoint: undefined }), null);
  assert.equal(readUpstream({ ...ECT_UPSTREAM, forkPoint: '75c20e7'.repeat(6) }), null);
});

test('readPluginMetadata: a Hosted entry keeps a valid upstream, drops a malformed one, and ignores it on an External entry', () => {
  assert.deepEqual(readHostedWithUpstream(ECT_UPSTREAM).plugin.upstream, readUpstream(ECT_UPSTREAM));
  assert.equal(readHostedWithUpstream({ ...ECT_UPSTREAM, commit: 'nope' }).plugin.upstream, null);
  assert.equal(readMinimal().plugin.upstream, null);
  const external = readPluginMetadata(JSON.stringify({ ...seedPinDms, upstream: ECT_UPSTREAM }), ENTRY, REPO);
  assert.equal(external.plugin.kind, 'external');
  assert.equal(external.plugin.upstream, null);
});

test('Upstream paths: the metadata URL is the only one fetched, the version link is the file at the recorded Upstream commit', () => {
  const u = readUpstream(ECT_UPSTREAM);
  assert.equal(upstreamMetadataUrl(u), 'https://raw.githubusercontent.com/Pharaoh2k/BetterDiscordStuff/main/Plugins/EnhancedChannelTabs/plugin.json');
  assert.equal(upstreamVersionUrl(u), 'https://github.com/Pharaoh2k/BetterDiscordStuff/blob/79939c8/Plugins/EnhancedChannelTabs/EnhancedChannelTabs.plugin.js');
  const renamed = readUpstream({ ...ECT_UPSTREAM, url: 'https://github.com/o/r/tree/dev/Plugins/OtherName' });
  assert.equal(upstreamMetadataUrl(renamed), 'https://raw.githubusercontent.com/o/r/dev/Plugins/OtherName/plugin.json');
  assert.equal(upstreamVersionUrl(renamed), 'https://github.com/o/r/blob/79939c8/Plugins/OtherName/OtherName.plugin.js');
});

test('readUpstreamVersion takes the trimmed version string and reports unparsable or versionless JSON as invalid', () => {
  assert.deepEqual(readUpstreamVersion('{"version":" 5.0.15 "}'), { version: '5.0.15' });
  assert.deepEqual(readUpstreamVersion('not json'), { failure: { kind: 'invalid' } });
  assert.deepEqual(readUpstreamVersion('{"name":"x"}'), { failure: { kind: 'invalid' } });
  assert.deepEqual(readUpstreamVersion('{"version":5}'), { failure: { kind: 'invalid' } });
  assert.deepEqual(readUpstreamVersion('{"version":"  "}'), { failure: { kind: 'invalid' } });
  assert.deepEqual(readUpstreamVersion('[]'), { failure: { kind: 'invalid' } });
});

test('upstreamState: In Sync on an equal version, Drifted on any difference, Unchecked on a failure (throttled for 429)', () => {
  const u = readUpstream(ECT_UPSTREAM);
  assert.deepEqual(upstreamState(u, { checkedAt: 1, version: '5.0.15' }), { state: 'in-sync' });
  assert.deepEqual(upstreamState(u, { checkedAt: 1, version: '5.0.16' }), { state: 'drifted', current: '5.0.16' });
  assert.deepEqual(upstreamState(u, { checkedAt: 1, version: '5.0.14' }), { state: 'drifted', current: '5.0.14' });
  assert.deepEqual(upstreamState(u, { checkedAt: 1, version: null, failure: { kind: 'http', status: 404 } }), { state: 'unchecked', throttled: false });
  assert.deepEqual(upstreamState(u, { checkedAt: 1, version: null, failure: { kind: 'network' } }), { state: 'unchecked', throttled: false });
  assert.deepEqual(upstreamState(u, { checkedAt: 1, version: null, failure: { kind: 'invalid' } }), { state: 'unchecked', throttled: false });
  assert.deepEqual(upstreamState(u, { checkedAt: 1, version: null, failure: { kind: 'http', status: 429 } }), { state: 'unchecked', throttled: true });
});

test('forkChangesRange runs from the Fork Point to the Pinned Copy sha, else to the configured ref; equal shas mean no changes', () => {
  const hosted = { ...plugin(ECT_ENTRY), kind: 'hosted', servedFrom: 'goproslowyo/bd-plugins', upstream: readUpstream(ECT_UPSTREAM) };
  const pinnedUrl = 'https://raw.githubusercontent.com/goproslowyo/bd-plugins/1e81a0f/Plugins/EnhancedChannelTabs/EnhancedChannelTabs.plugin.js';
  assert.deepEqual(forkChangesRange({ ...hosted, pinnedUrl }, REPO), { from: '75c20e7', to: '1e81a0f', empty: false });
  assert.deepEqual(forkChangesRange(hosted, REPO), { from: '75c20e7', to: 'main', empty: false });
  const seedPinned = pinnedUrl.replace('1e81a0f', '75c20e70fec5dff41bd739f0ef9f887f58f308e6');
  assert.deepEqual(forkChangesRange({ ...hosted, pinnedUrl: seedPinned }, REPO), { from: '75c20e7', to: '75c20e70fec5dff41bd739f0ef9f887f58f308e6', empty: true });
  assert.equal(forkChangesRange({ ...hosted, upstream: null }, REPO), null);
});

test('forkChangesUrl is the compare view in the served-from repository, anchored on the artifact', () => {
  const hosted = { ...plugin(ECT_ENTRY), kind: 'hosted', servedFrom: 'goproslowyo/bd-plugins', upstream: readUpstream(ECT_UPSTREAM) };
  assert.equal(forkChangesUrl(hosted, { from: '75c20e7', to: '1e81a0f', empty: false }, 'abc123'), 'https://github.com/goproslowyo/bd-plugins/compare/75c20e7...1e81a0f#diff-abc123');
  assert.equal(forkChangesUrl(hosted, { from: '75c20e7', to: '1e81a0f', empty: false }, null), 'https://github.com/goproslowyo/bd-plugins/compare/75c20e7...1e81a0f');
  assert.equal(forkChangesUrl({ ...hosted, servedFrom: null }, { from: '75c20e7', to: '1e81a0f', empty: false }, 'abc123'), null);
});

test('artifactDiffAnchor is the lowercase SHA-256 hex of the repository-relative artifact path', async () => {
  const path = 'Plugins/EnhancedChannelTabs/EnhancedChannelTabs.plugin.js';
  assert.equal(await artifactDiffAnchor({ entryName: 'EnhancedChannelTabs' }), createHash('sha256').update(path).digest('hex'));
});
