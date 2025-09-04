import axios from 'axios';
import cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';
import { createObjectCsvWriter } from 'csv-writer';

const START_URL = 'https://www.work.ua/jobs-kyiv-team+leader/?page=2';
const OUTPUT_DIR = path.join(process.cwd(), 'data');
const JSON_PATH = path.join(OUTPUT_DIR, 'workua.json');
const CSV_PATH = path.join(OUTPUT_DIR, 'workua.csv');

function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function sanitize(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: 20000,
    headers: {
      'User-Agent': 'workua-parser/1.0 (+github.com)'
    },
    validateStatus: s => s >= 200 && s < 400
  });
  return res.data;
}

function parseJobs(html) {
  const $ = cheerio.load(html);
  const results = [];

  // Work.ua job cards structure can vary. We target list items within the results container.
  $('.card, .job-link').each((_, el) => {
    const root = $(el);
    // Title and link
    let title = sanitize(root.find('h2, .add-top-xs a, a.job-link').first().text());
    let link = root.find('h2 a, .add-top-xs a, a.job-link').first().attr('href') || '';
    if (link && !/^https?:/i.test(link)) link = `https://www.work.ua${link}`;

    // Company and location
    const company = sanitize(root.find('.add-top-xs .strong-600, .mt-xs .strong-600, .company, .add-top-xs a[rel="nofollow"]').first().text());
    const metaText = sanitize(root.find('.mt-xs, .text-muted, .overflow').first().text());
    let location = '';
    const locMatch = metaText.match(/Київ|Kyiv|Киев/i);
    if (locMatch) location = locMatch[0];

    // Salary
    const salary = sanitize(root.find('.salary, .text-success, .nowrap').first().text());

    // Posted date (e.g., "2 дні тому")
    const dateText = sanitize(root.find('.text-muted:contains("тому"), time, .text-muted small').first().text());

    if (!title && !link) return;
    results.push({ title, company, location, salary, date: dateText, url: link });
  });

  // Fallback: list items under main results container
  if (results.length === 0) {
    $('#pjax-job-list .job-link').each((_, a) => {
      const title = sanitize($(a).text());
      let link = $(a).attr('href') || '';
      if (link && !/^https?:/i.test(link)) link = `https://www.work.ua${link}`;
      if (title || link) results.push({ title, company: '', location: '', salary: '', date: '', url: link });
    });
  }

  return results;
}

async function run() {
  ensureOutputDir();
  const html = await fetchHtml(START_URL);
  const jobs = parseJobs(html);

  fs.writeFileSync(JSON_PATH, JSON.stringify(jobs, null, 2), 'utf-8');

  const csvWriter = createObjectCsvWriter({
    path: CSV_PATH,
    header: [
      { id: 'title', title: 'title' },
      { id: 'company', title: 'company' },
      { id: 'location', title: 'location' },
      { id: 'salary', title: 'salary' },
      { id: 'date', title: 'date' },
      { id: 'url', title: 'url' }
    ]
  });
  await csvWriter.writeRecords(jobs);

  console.log(`Work.ua: saved ${jobs.length} jobs to`);
  console.log(`- ${JSON_PATH}`);
  console.log(`- ${CSV_PATH}`);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});


