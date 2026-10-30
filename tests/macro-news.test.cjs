'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const raw = fs.readFileSync(path.join(__dirname, '..', 'main-v188.js'), 'utf8');
const executable = raw.replace(/^export\s+(default\s+)?/gm, (_match, isDefault) => isDefault ? 'const exported = ' : '');
const context = { URL, Date, Intl, Symbol, Map, Set, Object, Number, String, Boolean, Math, RegExp, Error, Array };
const api = vm.runInNewContext(executable + '\n;({ NEWS_SOURCES, NEWS_PARSER_REVISION, newsItem, parseNewsXml, newsContextSummary, newsTimestamp })', context, { filename: 'main-v188.js' });
const at = new Date().toISOString();
const pubDate = new Date().toUTCString();
const item = (title, source = 'BEA_RELEASES', url = 'https://www.bea.gov/news/2026/release') =>
  api.newsItem({ title, url, pubDate }, source, at);

test('registered source inventory preserves six existing feeds and adds two official feeds', () => {
  assert.equal(api.NEWS_SOURCES.length, 8);
  assert.deepEqual(Array.from(api.NEWS_SOURCES.slice(0, 2), x => x.id), ['BEA_RELEASES', 'BOJ_RELEASES']);
  assert.equal(api.NEWS_SOURCES.find(x => x.id === 'BEA_RELEASES').url, 'https://apps.bea.gov/rss/rss.xml');
  assert.equal(api.NEWS_SOURCES.find(x => x.id === 'BOJ_RELEASES').url, 'https://www.boj.or.jp/en/rss/whatsnew.xml');
});
test('BEA PCE and GDP are relevant macro events', () => {
  for (const title of ['Personal Income and Outlays: PCE Price Index', 'Gross Domestic Product (Advance Estimate), 3rd Quarter']) {
    const row = item(title);
    assert.equal(row.relevant, true);
    assert.ok(row.riskTags.includes('MACRO_EVENT_REVIEW'));
    assert.equal(row.tradeDirection, null);
  }
});
test('initial claims and producer prices are macro events', () => {
  for (const title of ['Initial Jobless Claims weekly report', 'Producer Price Index (PPI)']) {
    assert.ok(item(title).riskTags.includes('MACRO_EVENT_REVIEW'));
  }
});
test('DXY and treasury yields require risk review but do not create a trade direction', () => {
  const row = item('DXY dollar index and US Treasury yields jump');
  assert.ok(row.riskTags.includes('USD_YIELD_RISK_REVIEW'));
  assert.equal(row.tradeDirection, null);
});
test('BOJ standalone policy title is recognized without the institution name', () => {
  const row = item('Statement on Monetary Policy', 'BOJ_RELEASES', 'http://www.boj.or.jp/en/mopo/mpmdeci/decision.htm');
  assert.equal(row.relevant, true);
  assert.ok(row.riskTags.includes('CENTRAL_BANK_POLICY_REVIEW'));
  assert.match(row.url, /^https:\/\/www\.boj\.or\.jp\//);
});
test('BOJ RDF RSS with dc:date is parsed', () => {
  const xml = '<?xml version="1.0"?><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<item><title>Statement on Monetary Policy</title><link>http://www.boj.or.jp/en/mopo/decision.htm</link><dc:date>' + at + '</dc:date></item></rdf:RDF>';
  const rows = api.parseNewsXml(xml, 'BOJ_RELEASES', at);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].riskTags.includes('CENTRAL_BANK_POLICY_REVIEW'));
});
test('BEA standard RSS is parsed', () => {
  const xml = '<rss><channel><item><title>Personal Income and Outlays PCE</title><link>https://www.bea.gov/news/pce</link><pubDate>' +
    pubDate + '</pubDate></item></channel></rss>';
  const rows = api.parseNewsXml(xml, 'BEA_RELEASES', at);
  assert.equal(rows.length, 1);
  assert.equal(rows.parseDiagnostics.acceptedItemCount, 1);
});
test('missing publication time never masquerades as fresh news', () => {
  assert.equal(api.newsItem({ title: 'PCE inflation', url: 'https://www.bea.gov/news/pce' }, 'BEA_RELEASES', at), null);
  assert.equal(api.newsTimestamp('2026-10-30 08:30:00'), null);
});
test('external HTTP links are rejected, official BOJ legacy HTTP is upgraded', () => {
  assert.equal(item('Statement on Monetary Policy', 'BOJ_RELEASES', 'http://attacker.example/a'), null);
  assert.match(item('Statement on Monetary Policy', 'BOJ_RELEASES', 'http://www.boj.or.jp/en/a').url, /^https:/);
});
test('original exchange security risk is retained', () => {
  const row = item('Bitcoin exchange hack, withdrawals halted', 'COINDESK', 'https://www.coindesk.com/news/hack');
  assert.ok(row.riskTags.includes('EXCHANGE_SECURITY_REVIEW'));
});
test('source audit and BOJ coverage reflect verified records only', () => {
  const empty = api.newsContextSummary({});
  assert.equal(empty.expectedSourceCount, 10);
  assert.equal(empty.coverage.BOJ, 'OFFICIAL_RSS_UNAVAILABLE');
  const populated = api.newsContextSummary({ BOJ_RELEASES: { status: 'ok', fetchedAt: at, items: [] } });
  assert.equal(populated.coverage.BOJ, 'OFFICIAL_RSS_CONNECTED');
});
test('malformed feed and unsafe XML are rejected', () => {
  assert.throws(() => api.parseNewsXml('<html>Not RSS</html>', 'BOJ_RELEASES', at), /NOT_A_NEWS_FEED/);
  assert.throws(() => api.parseNewsXml('<!DOCTYPE rss><rss/>', 'BEA_RELEASES', at), /UNSUPPORTED_XML_DECLARATION/);
});
