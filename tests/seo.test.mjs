import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildSite } from '../site2/scripts/build.mjs';

await buildSite();
const folder = resolve('site2/dist');
const html = await readFile(resolve(folder, 'index.html'), 'utf8');
const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])['@graph'];
const canonical = 'https://thedealmate.com/';

test('one canonical is shared by sitemap, OG and site identities', async () => {
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
  assert.ok(html.includes(`rel="canonical" href="${canonical}"`));
  assert.ok(html.includes(`property="og:url" content="${canonical}"`));
  for (const type of ['WebSite', 'WebPage', 'Organization']) assert.equal(graph.find(x => x['@type'] === type).url, canonical);
  const xml = await readFile(resolve(folder, 'sitemap.xml'), 'utf8');
  assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(x=>x[1]), [canonical]);
  assert.ok(!xml.includes('/api/'));
  for (const content of [html, xml, await readFile(resolve(folder, 'robots.txt'), 'utf8'), await readFile(resolve(folder, 'llms.txt'), 'utf8')]) {
    assert.ok(!content.includes('dealmate-blush.vercel.app'), 'Search documents must use only the new domain');
  }
});

test('all five structured FAQs match the visible questions and answers', () => {
  const faqs = graph.find(x => x['@type'] === 'FAQPage').mainEntity;
  assert.equal(faqs.length, 5);
  for (const item of faqs) {
    assert.equal(item['@type'], 'Question');
    assert.ok(html.includes(`<summary>${item.name}<span aria-hidden="true">+</span></summary><p>${item.acceptedAnswer.text}</p>`));
    assert.equal(item.acceptedAnswer['@type'], 'Answer');
  }
  assert.match(faqs.find(x => x.name === '이용 가격은 얼마인가요?').acceptedAnswer.text, /아직 확정되지/);
});

test('metadata retains idea stage and contains no offers, ratings or invented statistics', () => {
  assert.match(html, /아이디어 구체화 단계/);
  assert.match(html, /현재 정식 서비스 이용 불가/);
  assert.match(html, /실제 매물이나 고객 검증 결과를 나타내지 않습니다/);
  const data = JSON.stringify(graph);
  for (const forbidden of ['aggregateRating', 'reviewCount', 'ratingValue', 'offers', 'priceCurrency', 'numberOfEmployees']) assert.ok(!data.includes(`"${forbidden}"`));
  assert.ok(!html.includes('hajatoday.com'));
});

test('crawler instructions allow public content but exclude authentication API', async () => {
  const robots = await readFile(resolve(folder, 'robots.txt'), 'utf8');
  assert.match(robots, /^User-agent: \*\nDisallow: \/api\//);
  assert.ok(robots.includes(`Sitemap: ${canonical}sitemap.xml`));
  assert.ok(!/^Disallow: \/\s*$/m.test(robots));
  const config = JSON.parse(await readFile('vercel.json','utf8'));
  assert.ok(config.headers.some(rule => rule.source === '/api/(.*)' && rule.headers.some(h => h.key === 'X-Robots-Tag' && h.value.includes('noindex'))));
  assert.equal(config.outputDirectory, 'site2/dist');
  assert.equal(config.buildCommand, 'npm run build');
});

test('local assets and anchor links resolve; images have deliberate alternatives', async () => {
  const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]));
  for (const [,link] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (link.startsWith('#')) assert.ok(ids.has(link.slice(1)), `Missing anchor ${link}`);
    else if (link.startsWith('/')) await access(resolve(folder, '.'+link));
  }
  for (const [image] of html.matchAll(/<img\b[^>]*>/g)) assert.match(image, /\balt="[^"]*"/);
  assert.match(html, /property="og:image:alt" content="Dealmate 딜메이트 로고"/);
  const png = await readFile(resolve(folder, 'share-card.png'));
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});

test('source date is retained and llms points to the public original without account data', async () => {
  const date = html.match(/id="content-updated" datetime="([^"]+)"/)[1];
  assert.equal(graph.find(x=>x['@type']==='WebPage').dateModified,date);
  assert.ok((await readFile(resolve(folder,'sitemap.xml'),'utf8')).includes(`<lastmod>${date}</lastmod>`));
  const llms = await readFile(resolve(folder, 'llms.txt'), 'utf8');
  assert.ok(llms.includes(`${canonical}#faq`));
  assert.ok(llms.includes(`${canonical}#about`));
  assert.ok(!/gmail\.com|credential|nonce|session|고객 \d+/.test(llms));
});
