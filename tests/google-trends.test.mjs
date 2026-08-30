import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeEntities,
  inner,
  normalize,
  parseRssItems,
  parseTraffic,
} from "../scrapers/community/google-trends.mjs";

test("parses a well-formed <item> block: title, traffic, pubDate, link, news titles", () => {
  const xml = `
    <rss><channel>
      <item>
        <title>GPT-5 launch</title>
        <ht:approx_traffic>200000+</ht:approx_traffic>
        <link>https://trends.google.com/trends/trendingsearches/daily?geo=US</link>
        <pubDate>Fri, 28 Aug 2026 12:00:00 -0700</pubDate>
        <ht:news_item><ht:news_item_title>OpenAI ships GPT-5</ht:news_item_title></ht:news_item>
        <ht:news_item><ht:news_item_title>What GPT-5 means for devs</ht:news_item_title></ht:news_item>
      </item>
    </channel></rss>
  `;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  const it = items[0];
  assert.equal(it.title, "GPT-5 launch");
  assert.equal(it.approxTrafficRaw, "200000+");
  assert.equal(it.pubDate, "Fri, 28 Aug 2026 12:00:00 -0700");
  assert.equal(it.link, "https://trends.google.com/trends/trendingsearches/daily?geo=US");
  assert.deepEqual(it.newsTitles, ["OpenAI ships GPT-5", "What GPT-5 means for devs"]);
});

test("unwraps a CDATA-wrapped title", () => {
  const xml = `
    <item>
      <title><![CDATA[Some & Title]]></title>
    </item>
  `;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Some & Title");
});

test("decodes HTML entities in the title", () => {
  const xml = `
    <item>
      <title>Tom &amp; Jerry&apos;s &quot;AI&quot; show</title>
    </item>
  `;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, `Tom & Jerry's "AI" show`);
});

test("decodeEntities handles amp/lt/gt/quot/apos/#39/nbsp and CDATA directly", () => {
  const decoded = decodeEntities("&amp;&lt;&gt;&quot;&apos;&#39;&nbsp;");
  assert.equal(decoded, "&<>\"'' ");
  assert.equal(decodeEntities("<![CDATA[raw & text]]>"), "raw & text");
});

test("tolerates an attribute on the opening tag (e.g. <title type=\"text\">)", () => {
  // Hardened: `inner`'s tag regex now allows an optional attribute list on the
  // opening tag, so a minor upstream feed change (Google Trends adding an
  // attribute to a tag it emits) no longer silently nulls out the field.
  const block = `<title type="text">Some Title</title>`;
  assert.equal(inner(block, "title"), "Some Title");

  const xml = `<item><title type="text">Some Title</title></item>`;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Some Title");
});

test("item missing a title is parsed with an empty title (caller filters it out)", () => {
  const xml = `
    <item>
      <ht:approx_traffic>50000+</ht:approx_traffic>
      <pubDate>Fri, 28 Aug 2026 12:00:00 -0700</pubDate>
    </item>
  `;
  const items = parseRssItems(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "");
  // Mirrors the `if (!it.title) continue;` guard in run() that drops such items.
  assert.equal(Boolean(items[0].title), false);
});

test("parseTraffic extracts a numeric value from strings like '200K+'", () => {
  assert.equal(parseTraffic("200000+"), 200000);
  assert.equal(parseTraffic("50,000+"), 50000);
  assert.equal(parseTraffic(null), null);
  assert.equal(parseTraffic(""), null);
  assert.equal(parseTraffic("0"), null);
});

test("normalize slugifies a title", () => {
  assert.equal(normalize("GPT-5 Launch!"), "gpt-5-launch");
  assert.equal(normalize("  Tom & Jerry  "), "tom-jerry");
});
