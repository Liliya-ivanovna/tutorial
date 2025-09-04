import axios from 'axios';
import cheerio from 'cheerio';
import PQueue from 'p-queue';
import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

const BASE_URL = 'https://learning.ua';
const START_URL = `${BASE_URL}/matematyka/`;

const OUTPUT_DIR = path.join(process.cwd(), 'data');
const JSON_PATH = path.join(OUTPUT_DIR, 'tasks.json');
const CSV_PATH = path.join(OUTPUT_DIR, 'tasks.csv');
const HTML_DIR = path.join(OUTPUT_DIR, 'html');

const REQUEST_TIMEOUT_MS = 20000;
const CONCURRENCY = 3;
const INTERVAL_CAP = 1; // one request per INTERVAL_MS
const INTERVAL_MS = 800; // polite delay

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }
  if (!fs.existsSync(HTML_DIR)) {
    fs.mkdirSync(HTML_DIR, { recursive: true });
  }
}

function sanitizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function isSameDomain(url) {
  return url.startsWith('/') || url.startsWith(BASE_URL);
}

function absolutize(url) {
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return new URL(url, START_URL).toString();
}

async function fetchHtml(url) {
  const response = await axios.get(url, {
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'User-Agent': 'learning-ua-crawler/1.0 (+github.com)'
    },
    validateStatus: (s) => s >= 200 && s < 400
  });
  return response.data;
}

function extractCategoryLinks($) {
  const links = new Set();
  // Look for "Переглянути" links and category tiles leading to paginated lists
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = sanitizeText($(el).text());
    if (!href) return;
    if (!isSameDomain(href)) return;

    // Heuristic: links containing matematika and possibly pagination or class pages
    const hrefAbs = absolutize(href);
    if (hrefAbs.includes('/matematyka/') && (text.includes('Переглянути') || /\d+\s*рок/i.test(text) || /клас/i.test(text))) {
      links.add(hrefAbs);
    }
  });
  return Array.from(links);
}

function extractTasksFromListPage($, context = {}) {
  const tasks = [];
  // Tasks often shown as list items with titles like "А.1 ..." or "A.1 ..."
  const titleRegex = /^(?:[AАБВГДЄЖЗИІЇКЛМНОПРСТУФХЦЧШЩЮЯ])[\.]?\s*\d+\b/i;

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    let text = sanitizeText($(el).text());
    if (!href || !text) return;
    if (!isSameDomain(href)) return;

    if (titleRegex.test(text)) {
      const url = absolutize(href);
      tasks.push({
        url,
        title: text,
        category: context.category || null,
        grade: context.grade || null
      });
    }
  });

  return tasks;
}

function extractContext($) {
  const h1 = sanitizeText($('h1, .page-title, .title').first().text() || '');
  let grade = null;
  let category = null;
  // Simple heuristics for grade/category extraction
  if (/клас/i.test(h1)) grade = h1;
  category = h1 || null;
  return { grade, category };
}

async function crawl() {
  ensureOutputDir();
  const queue = new PQueue({ concurrency: CONCURRENCY, intervalCap: INTERVAL_CAP, interval: INTERVAL_MS });
  const seen = new Set();
  const results = [];

  async function enqueue(url, type = 'list', context = {}) {
    const abs = absolutize(url);
    if (seen.has(abs)) return;
    seen.add(abs);
    queue.add(async () => {
      try {
        const html = await fetchHtml(abs);
        const $ = cheerio.load(html);

        if (type === 'start') {
          // From the start page, collect category links and also parse any tasks if present
          const ctx = extractContext($);
          results.push(...extractTasksFromListPage($, ctx));
          const links = extractCategoryLinks($);
          for (const link of links) {
            await enqueue(link, 'list');
          }
        } else if (type === 'list') {
          const ctx = extractContext($);
          results.push(...extractTasksFromListPage($, ctx));

          // Pagination discovery
          $('a').each((_, el) => {
            const href = $(el).attr('href') || '';
            const text = sanitizeText($(el).text());
            if (!href) return;
            if (!isSameDomain(href)) return;
            const absLink = absolutize(href);
            if (absLink.includes('/matematyka/') && (/page\//i.test(absLink) || /Наступна|Попередня|Далі|Сторінка/i.test(text))) {
              enqueue(absLink, 'list');
            }
          });
        }
      } catch (err) {
        console.error('Failed:', abs, err.message || err);
      }
    });
  }

  await enqueue(START_URL, 'start');
  await queue.onIdle();

  // Deduplicate by URL
  const unique = Array.from(new Map(results.map(t => [t.url, t])).values());

  // Download each task's HTML and store local path
  const downloadQueue = new PQueue({ concurrency: CONCURRENCY, intervalCap: INTERVAL_CAP, interval: INTERVAL_MS });
  const augmented = [];
  for (const task of unique) {
    downloadQueue.add(async () => {
      const urlObj = new URL(task.url);
      const safeName = urlObj.pathname.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
      const fileName = `${safeName || 'index'}.html`;
      const filePath = path.join(HTML_DIR, fileName);
      try {
        const html = await fetchHtml(task.url);
        fs.writeFileSync(filePath, html, 'utf-8');
        augmented.push({ ...task, localPath: path.relative(process.cwd(), filePath) });
      } catch (e) {
        console.error('Failed to download task HTML:', task.url, e.message || e);
        augmented.push({ ...task, localPath: null });
      }
    });
  }
  await downloadQueue.onIdle();

  // Write outputs
  fs.writeFileSync(JSON_PATH, JSON.stringify(augmented, null, 2), 'utf-8');

  const csvWriter = createObjectCsvWriter({
    path: CSV_PATH,
    header: [
      { id: 'url', title: 'url' },
      { id: 'title', title: 'title' },
      { id: 'category', title: 'category' },
      { id: 'grade', title: 'grade' },
      { id: 'localPath', title: 'localPath' }
    ]
  });
  await csvWriter.writeRecords(augmented);

  console.log(`Saved ${augmented.length} tasks to:`);
  console.log(`- ${JSON_PATH}`);
  console.log(`- ${CSV_PATH}`);
  console.log(`HTML saved under: ${HTML_DIR}`);
}

crawl().catch((e) => {
  console.error(e);
  process.exit(1);
});


