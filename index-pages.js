const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const SITE_BASE = 'https://mymoneymarketplace.github.io';
const CREDENTIALS_PATH = path.join(__dirname, 'google-credentials.json');
const LOG_PATH = path.join(__dirname, 'submitted-urls.json');
const SCOPES = ['https://www.googleapis.com/auth/indexing'];

// Quota cap per run (buffer under Google's 200/day limit).
const QUOTA_CAP = 195;
// Re-ping a URL only after this many days have elapsed since the last submit.
const STALE_AFTER_DAYS = 30;
const STALE_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
// Small delay between API calls (seconds * 1000).
const INTER_REQUEST_DELAY_MS = 200;

// ─────────── auth ───────────

async function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
  return auth.getClient();
}

// ─────────── discovery ───────────

function getHtmlFiles() {
  // Every .html file at the repo root (not recursive into subfolders,
  // matching the previous behavior). Covers business-loans-*, best-*,
  // personal-loans-*, and any hub pages at root.
  return fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.html'))
    .map(f => `${SITE_BASE}/${f}`)
    .sort();
}

// ─────────── submission log ───────────

function loadLog() {
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, '{}\n', 'utf8');
    return {};
  }
  try {
    const raw = fs.readFileSync(LOG_PATH, 'utf8').trim();
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn(`Log file at ${LOG_PATH} was corrupt (${err.message}); starting fresh.`);
    return {};
  }
}

function saveLog(log) {
  // Keep keys sorted for stable diffs.
  const sorted = {};
  for (const k of Object.keys(log).sort()) sorted[k] = log[k];
  fs.writeFileSync(LOG_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

function recordSubmission(log, url) {
  log[url] = new Date().toISOString();
  saveLog(log);
}

// ─────────── prioritization ───────────

function partitionUrls(urls, log) {
  const now = Date.now();
  const netNew = [];
  const stale = [];
  const skipped = [];

  for (const url of urls) {
    const last = log[url];
    if (!last) {
      netNew.push(url);
      continue;
    }
    const t = Date.parse(last);
    if (Number.isNaN(t) || now - t >= STALE_MS) {
      // Corrupt timestamps fall through to stale, oldest-first sort below.
      stale.push({ url, lastMs: Number.isNaN(t) ? 0 : t });
    } else {
      skipped.push(url);
    }
  }

  // Stale: oldest first so the most-neglected URL gets re-pinged first.
  stale.sort((a, b) => a.lastMs - b.lastMs);

  return {
    netNew,            // preserves alphabetical (getHtmlFiles sorts)
    stale: stale.map(s => s.url),
    skipped
  };
}

// ─────────── indexing API ───────────

async function submitUrl(client, url) {
  const res = await client.request({
    url: 'https://indexing.googleapis.com/v3/urlNotifications:publish',
    method: 'POST',
    data: { url, type: 'URL_UPDATED' },
  });
  return res.data;
}

// ─────────── main ───────────

async function main() {
  const allUrls = getHtmlFiles();
  const log = loadLog();
  const { netNew, stale, skipped } = partitionUrls(allUrls, log);

  // Priority queue: net-new first, then stale (oldest first), capped.
  const queue = [...netNew, ...stale].slice(0, QUOTA_CAP);
  const beyondCap = (netNew.length + stale.length) - queue.length;

  console.log(`Repo total:       ${allUrls.length} .html files`);
  console.log(`Net-new eligible: ${netNew.length}`);
  console.log(`Stale eligible:   ${stale.length} (last submit > ${STALE_AFTER_DAYS} days ago)`);
  console.log(`Skipped (recent): ${skipped.length}`);
  console.log(`Quota this run:   ${queue.length} (cap ${QUOTA_CAP}${beyondCap > 0 ? `, ${beyondCap} over the cap deferred` : ''})`);
  console.log('');

  if (queue.length === 0) {
    console.log('Nothing to submit. Exiting.');
    return;
  }

  let authClient;
  try {
    authClient = await getAuthClient();
  } catch (err) {
    console.error('Auth failed:', err.message);
    process.exit(1);
  }

  const netNewSet = new Set(netNew);
  let submittedNew = 0;
  let resubmittedStale = 0;
  const errors = [];

  for (const url of queue) {
    const isStale = !netNewSet.has(url);
    try {
      const result = await submitUrl(authClient, url);
      const notify = result.urlNotificationMetadata?.latestUpdate?.notifyTime || 'submitted';
      const tag = isStale ? 'STALE' : 'NEW  ';
      console.log(`OK ${tag} ${url}  [${notify}]`);
      recordSubmission(log, url);
      if (isStale) resubmittedStale++;
      else submittedNew++;
    } catch (err) {
      const status = err.response?.status || err.code || 'unknown';
      const msg = err.response?.data?.error?.message || err.message;
      console.error(`FAIL      ${url}  [${status}: ${msg}]`);
      errors.push({ url, status, message: msg });
      // If we hit the daily quota, stop immediately -- every subsequent call
      // will 429 and eat retry budget without effect.
      if (status === 429 || /quota/i.test(msg)) {
        console.error('Quota exhausted. Stopping early.');
        break;
      }
    }
    await new Promise(r => setTimeout(r, INTER_REQUEST_DELAY_MS));
  }

  const submittedThisRun = submittedNew + resubmittedStale;
  const quotaRemaining = Math.max(0, QUOTA_CAP - submittedThisRun - errors.length);

  console.log('\n──── Summary ────');
  console.log(`Repo total (.html):    ${allUrls.length}`);
  console.log(`Net-new submitted:     ${submittedNew}`);
  console.log(`Stale re-submitted:    ${resubmittedStale}`);
  console.log(`Skipped (<${STALE_AFTER_DAYS}d):      ${skipped.length}`);
  console.log(`Quota remaining:       ${quotaRemaining} of ${QUOTA_CAP}`);
  console.log(`Errors:                ${errors.length}`);
  if (errors.length) {
    console.log('\nErrors:');
    for (const e of errors) {
      console.log(`  - ${e.url}`);
      console.log(`      [${e.status}] ${e.message}`);
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
