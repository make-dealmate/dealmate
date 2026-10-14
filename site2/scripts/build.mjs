import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const marker = '<!-- SEARCH_METADATA: generated from this page by scripts/build.mjs -->';
const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');
const plain = html => decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function readContent(html) {
  const required = (expression, name) => {
    const match = html.match(expression);
    if (!match) throw new Error(`Missing source content: ${name}`);
    return match[1];
  };
  const canonical = decode(required(/<link rel="canonical" href="([^"]+)"\s*\/?\s*>/, 'canonical'));
  const url = new URL(canonical);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) throw new Error('Use one HTTPS homepage canonical');
  const title = plain(required(/<title>(.*?)<\/title>/s, 'title'));
  const description = decode(required(/<meta name="description" content="([^"]+)"/, 'description'));
  const definition = plain(required(/<p[^>]+id="service-definition"[^>]*>(.*?)<\/p>/s, 'definition'));
  const author = plain(required(/<span id="content-author">(.*?)<\/span>/s, 'author'));
  const updated = required(/<time id="content-updated" datetime="(\d{4}-\d{2}-\d{2})"/, 'content update date');
  const repository = required(/<a id="source-repository" href="([^"]+)"/, 'public source');
  const faqSource = required(/<section\b[^>]*id="faq"[^>]*>(.*?)<\/section>/s, 'FAQ section');
  const faq = [...faqSource.matchAll(/<details><summary>(.*?)<\/summary><p>(.*?)<\/p><\/details>/gs)].map(([,question,answer]) => ({
    question: plain(question.replace(/<span aria-hidden="true">.*?<\/span>/gs, '')),
    answer: plain(answer)
  }));
  if (!faq.length || faq.length !== (faqSource.match(/<details>/g) || []).length) throw new Error('Every visible FAQ must have one question and answer');
  return { canonical, title, description, definition, author, updated, repository, faq };
}

export async function buildSite() {
  // public/index.html is the content source. Rebuild derived files instead of editing them.
  const source = await readFile(resolve(root, 'public/index.html'), 'utf8');
  if (source.split(marker).length !== 2) throw new Error('Expected exactly one metadata marker');
  const c = readContent(source);
  const asset = new URL('share-card.png', c.canonical).href;
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'Organization', '@id': `${c.canonical}#organization`, name: c.author, alternateName: '딜메이트', url: c.canonical },
      { '@type': 'WebSite', '@id': `${c.canonical}#website`, name: c.author, alternateName: '딜메이트', url: c.canonical, inLanguage: 'ko-KR', publisher: { '@id': `${c.canonical}#organization` } },
      { '@type': 'WebPage', '@id': `${c.canonical}#webpage`, url: c.canonical, name: c.title, description: c.description, inLanguage: 'ko-KR', dateModified: c.updated, author: { '@id': `${c.canonical}#organization` }, isPartOf: { '@id': `${c.canonical}#website` }, citation: c.repository },
      { '@type': 'FAQPage', '@id': `${c.canonical}#faq`, url: `${c.canonical}#faq`, inLanguage: 'ko-KR', isPartOf: { '@id': `${c.canonical}#webpage` }, mainEntity: c.faq.map(item => ({ '@type': 'Question', name: item.question, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) }
    ]
  };
  const tags = [
    ['og:type', 'website'], ['og:locale', 'ko_KR'], ['og:site_name', c.author],
    ['og:title', c.title], ['og:description', c.description], ['og:url', c.canonical],
    ['og:image', asset], ['og:image:type', 'image/png'], ['og:image:width', '1200'], ['og:image:height', '630'], ['og:image:alt', 'Dealmate 딜메이트 로고'],
    ['twitter:card', 'summary_large_image'], ['twitter:title', c.title], ['twitter:description', c.description], ['twitter:image', asset], ['twitter:image:alt', 'Dealmate 딜메이트 로고']
  ].map(([name,content]) => `<meta ${name.startsWith('og:') ? 'property' : 'name'}="${name}" content="${escape(content)}">`);
  tags.push(`<meta name="author" content="${escape(c.author)}">`);
  tags.push(`<script type="application/ld+json">${JSON.stringify(graph).replace(/</g, '\\u003c')}</script>`);
  const dist = resolve(root, 'dist');
  await mkdir(dist, { recursive: true });
  await cp(resolve(root, 'public'), dist, { recursive: true });
  await writeFile(resolve(dist, 'index.html'), source.replace(marker, () => tags.join('\n  ')));
  await writeFile(resolve(dist, 'robots.txt'), `User-agent: *\nDisallow: /api/\n\nSitemap: ${c.canonical}sitemap.xml\n`);
  await writeFile(resolve(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${escape(c.canonical)}</loc><lastmod>${c.updated}</lastmod></url>\n</urlset>\n`);
  await writeFile(resolve(dist, 'llms.txt'), `# ${c.author} (딜메이트)\n\n> ${c.definition}\n\n## 원문\n\n- [홈페이지](${c.canonical}): 서비스의 현재 단계와 소개\n- [서비스 구상](${c.canonical}#approach): 준비 중인 서비스 방향\n- [이용 흐름](${c.canonical}#journey): 구매자가 직접 비교·문의·결정하는 구상\n- [질문과 답변](${c.canonical}#faq): 이용 가능 여부, 메시지, 결제, 대상, 가격 안내\n- [작성·갱신·근거](${c.canonical}#about): 작성자와 내용 갱신일, 원문 출처\n\n## Optional\n\n- [구현·변경 기록](${c.repository}): 공개 코드 저장소\n`);
  return { output: dist, pages: 1, faqs: c.faq.length, schemaTypes: graph['@graph'].map(item => item['@type']) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(await buildSite()));
}
