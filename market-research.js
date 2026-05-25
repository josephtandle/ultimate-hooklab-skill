#!/usr/bin/env node
/**
 * market-research.js
 * Fetches live hook examples for a given niche + optional creator accounts.
 * Sources (in priority order): Wezual database, recent article hooks,
 * Instagram captions (Instaloader), YouTube titles.
 *
 * Usage:
 *   node market-research.js "health coaches on Instagram"
 *   node market-research.js "health coaches on Instagram" "@marieforleo,@jameswedmore"
 *
 * Output: labeled plain text blocks
 *   =RECENT:=               <- freshest hook examples from marketing articles
 *   =WEZUAL:category=       <- niche database hooks (may appear twice if dual-category)
 *   =ACCOUNT:@handle:instagram=     <- creator Instagram captions (hook-shape filtered)
 *   =ACCOUNT:@handle:youtube-titles=  <- creator YouTube video titles
 *   =ACCOUNT:@handle:not-found=     <- could not access
 *   =ACCOUNT:@handle:private=       <- private profile
 *   =ACCOUNT:@handle:rate-limited=  <- rate-limited or login required
 *   =CONFIDENCE:level=              <- high / medium / low
 *   recent:N,wezual:N,accounts:N/N  <- source breakdown
 *   =RESEARCH:failed=               <- all sources failed; message follows
 */

const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Constants ────────────────────────────────────────────────────────────────

const CLAUDE_MODEL_FAST = 'claude-haiku-4-5-20251001';
const HOME = process.env.HOME || require('os').homedir();
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CAPTION_SCRIPT = path.join(__dirname, 'fetch-instagram-captions.py');
const CACHE_DIR = path.join(__dirname, 'cache');
const CACHE_TTL_NICHE = 7 * 24 * 60 * 60 * 1000;    // 7 days
const CACHE_TTL_ACCOUNT = 48 * 60 * 60 * 1000;       // 48 hours
const CACHE_TTL_RECENT = 7 * 24 * 60 * 60 * 1000;    // 7 days

const niche = process.argv[2];
const accountsArg = process.argv[3] || '';

if (!niche) {
  process.stderr.write('Usage: node market-research.js "your niche" "@handle1,@handle2"\n');
  process.exit(1);
}

// Read active accounts from research-accounts.md if no CLI arg provided
function loadResearchAccounts() {
  const dbPath = path.join(__dirname, 'personal/research-accounts.md');
  try {
    const content = fs.readFileSync(dbPath, 'utf8');
    const activeSection = content.split('## Active')[1]?.split('## ')[0] || '';
    return activeSection
      .split('\n')
      .filter(line => line.startsWith('|') && !line.includes('Handle') && !line.includes('---'))
      .map(line => line.split('|')[1]?.trim().replace(/^@/, '').toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
}

const accounts = accountsArg
  ? accountsArg.split(',').map(a => a.trim().replace(/^@/, '').toLowerCase()).filter(Boolean)
  : loadResearchAccounts();

// Debug log for diagnostics (written to cache/last-run-debug.json at end)
const debug = {
  timestamp: new Date().toISOString(),
  niche,
  accounts,
  sources: {
    recent: { urls_attempted: [], urls_succeeded: [], hooks_extracted: 0 },
    wezual: { categories: [], hooks_extracted: 0 },
    accounts: {}
  }
};

// ─── Cache helpers ─────────────────────────────────────────────────────────────

function ensureCache() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cacheKey(name) {
  // Hash to prevent collisions from special characters in niche names
  const hash = crypto.createHash('sha256').update(name).digest('hex').slice(0, 8);
  const slug = name.replace(/[^a-z0-9_-]/gi, '_').toLowerCase().slice(0, 40);
  return path.join(CACHE_DIR, slug + '_' + hash + '.json');
}

function readCache(name, ttl) {
  try {
    const file = cacheKey(name);
    if (!fs.existsSync(file)) return null;
    const { ts, data } = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - ts > ttl) return null;
    return data;
  } catch (e) {
    return null;
  }
}

function writeCache(name, data) {
  try {
    ensureCache();
    fs.writeFileSync(cacheKey(name), JSON.stringify({ ts: Date.now(), data }));
  } catch (e) { /* ignore write errors */ }
}

// ─── Niche → Wezual categories (dual, LLM-assisted with regex fallback) ──────

const VALID_CATEGORIES = ['business-marketing', 'finance-investing', 'fitness-health', 'motivation-mindset', 'tech-ai'];

function nicheToWezualCategoryRegex(niche) {
  const n = niche.toLowerCase();
  let primary = 'business-marketing';
  let secondary = null;

  if (n.match(/somatic|healer|healing|nervous system|trauma|therapist|counselor|mindset|confidence|self.worth|boundaries|self.love|inner child|mental health/)) {
    primary = 'motivation-mindset';
    if (n.match(/coach|consult|business|practice|client|program|course/)) secondary = 'business-marketing';
  } else if (n.match(/fitness|nutrition|weight|diet|workout|gym|yoga|body/)) {
    primary = 'fitness-health';
    if (n.match(/coach|online|business|program/)) secondary = 'business-marketing';
  } else if (n.match(/health|wellness/) && !n.match(/mental health/)) {
    primary = 'fitness-health';
    if (n.match(/coach|consult|business|practice/)) secondary = 'business-marketing';
  } else if (n.match(/money|finance|invest|wealth|budget|trading|crypto|tax/)) {
    primary = 'finance-investing';
  } else if (n.match(/motivat|personal develop|clarity|purpose|life coach|growth/)) {
    primary = 'motivation-mindset';
    if (n.match(/business|entrepreneur|professional/)) secondary = 'business-marketing';
  } else if (n.match(/tech|ai|software|saas|developer|code|app|startup/)) {
    primary = 'tech-ai';
    if (n.match(/market|sell|grow|audience|content/)) secondary = 'business-marketing';
  }

  return { primary, secondary };
}

function nicheToWezualCategory(niche) {
  const cacheK = 'category_' + niche;
  const cached = readCache(cacheK, CACHE_TTL_NICHE);
  if (cached) return cached;

  const prompt = `Given this niche description: "${niche}"

Choose the best 1-2 matching categories from this list:
- business-marketing (coaches, consultants, entrepreneurs, agencies, B2B, content creators, course sellers)
- finance-investing (money, wealth, investing, budgeting, financial freedom, crypto, trading)
- fitness-health (fitness, nutrition, weight loss, diet, physical health, yoga, gym, wellness)
- motivation-mindset (mindset, personal development, healing, somatic work, nervous system, trauma, self-worth, life coaching, mental health, inner work)
- tech-ai (tech, software, SaaS, AI tools, developers, apps, startups)

If the niche spans two categories, respond with: primary,secondary (e.g. "motivation-mindset,business-marketing")
If only one category fits, respond with just the slug.
Respond with ONLY the category slug(s). No explanation. No punctuation other than the comma separator.`;

  try {
    const result = spawnSync('claude', ['--print', '--model', CLAUDE_MODEL_FAST, '--max-tokens', '30'], {
      input: prompt,
      encoding: 'utf8',
      timeout: 10000,
      cwd: HOME
    });
    const raw = (result.stdout || '').trim().toLowerCase();
    const parts = raw.split(',').map(p => p.trim());
    const primary = VALID_CATEGORIES.find(c => parts[0] && parts[0].includes(c));
    const secondary = parts[1] ? VALID_CATEGORIES.find(c => parts[1].includes(c)) : null;
    if (primary) {
      const categories = { primary, secondary: secondary || null };
      writeCache(cacheK, categories);
      return categories;
    }
  } catch (e) { /* fall through */ }

  const fallback = nicheToWezualCategoryRegex(niche);
  writeCache(cacheK, fallback);
  return fallback;
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function extractWezualHooks(html) {
  const allText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const hooks = [];
  const pattern = /\u201C([^\u201C\u201D]{12,130})\u201D Analyze/g;
  let match;
  while ((match = pattern.exec(allText)) !== null) {
    const hook = match[1].trim();
    if (hook && !hook.includes('&amp;') && !hook.includes('http')) {
      hooks.push(hook);
    }
  }
  return hooks;
}

function deduplicate(arr) {
  const seen = new Set();
  return arr.filter(h => {
    const k = h.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// Hook-shape heuristic: keep only strings that look like actual hooks.
// Filters out nav items, CTAs, headings, and other article noise.
function isHookShaped(text) {
  const t = text.trim();
  if (!t) return false;
  // Must start with capital letter or quote
  if (!/^[A-Z"']/.test(t)) return false;
  // At least 4 words
  if (t.split(/\s+/).length < 4) return false;
  // At least one hook signal present
  const hasNumber = /\d/.test(t);
  const hasArticle = /^(The|This|That|These|A|An)\s/i.test(t);
  const hasPersonal = /\b(I |you |your |my |we |our )/i.test(t);
  const hasConditional = /^(If|When|What|Why|How)\s/i.test(t);
  const isQuestion = /\?$/.test(t);
  const hasReversal = /\b(used to|stopped|learned|realized|never|always|until)\b/i.test(t);
  return hasNumber || hasArticle || hasPersonal || hasConditional || isQuestion || hasReversal;
}

// ─── Source 1: Recent hook articles via DDG + Playwright (weekly cache) ────────

async function fetchRecentArticleHooks(niche) {
  const { primary } = nicheToWezualCategoryRegex(niche);
  const cacheK = 'recent_' + primary;
  const cached = readCache(cacheK, CACHE_TTL_RECENT);
  if (cached) return cached;

  const queries = [
    `best ${niche} instagram reel hooks 2025 examples`,
    `viral ${primary.replace('-', ' ')} hooks that stop the scroll examples`
  ];

  let urls = [];
  for (const query of queries) {
    try {
      debug.sources.recent.urls_attempted.push(`DDG: ${query}`);
      const html = await fetchHTML(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
      const matches = html.match(/uddg=([^&"]+)/g) || [];
      const found = [...new Set(
        matches.map(m => decodeURIComponent(m.replace('uddg=', '')))
          .filter(u => !u.includes('duckduckgo') && !u.includes('instagram.com') && !u.includes('tiktok.com') && !u.includes('youtube.com'))
      )];
      urls.push(...found);
      if (urls.length >= 6) break;
    } catch (e) {
      process.stderr.write(`DDG query failed: ${e.message}\n`);
    }
  }
  urls = [...new Set(urls)].slice(0, 4);
  if (!urls.length) { writeCache(cacheK, []); return []; }

  const browser = await chromium.launch({
    headless: true, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  const hooks = [];

  try {
    for (const url of urls.slice(0, 3)) {
      try {
        debug.sources.recent.urls_attempted.push(url);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(800);
        const found = await page.evaluate(() => {
          const results = [], seen = new Set();
          function add(text) {
            const clean = text.trim().replace(/\s+/g, ' ');
            if (clean.length >= 12 && clean.length <= 130 && !seen.has(clean.toLowerCase()) &&
              !clean.toLowerCase().match(/click|subscribe|privacy|cookie|sign up|learn more|read more|follow|pricing|plan|table of contents|in this article|newsletter|join us/)) {
              seen.add(clean.toLowerCase()); results.push(clean);
            }
          }
          document.querySelectorAll('ol li, ul li').forEach(el => {
            if (!el.querySelectorAll('li').length) add(el.innerText || '');
          });
          document.querySelectorAll('blockquote, p > strong, p > b').forEach(el => add(el.innerText || ''));
          return results.slice(0, 20);
        });
        // Apply hook-shape filter -- only keep lines that look like real hooks
        const shaped = found.filter(isHookShaped);
        hooks.push(...shaped);
        debug.sources.recent.urls_succeeded.push(url);
        if (hooks.length >= 20) break;
      } catch (e) {
        process.stderr.write(`Article scrape failed for ${url}: ${e.message}\n`);
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  // Only cache and return if we have enough quality hooks (>= 5)
  const result = deduplicate(hooks).slice(0, 12);
  const toCache = result.length >= 5 ? result : [];
  writeCache(cacheK, toCache);
  debug.sources.recent.hooks_extracted = result.length;
  return result;
}

// ─── Source 2: Wezual viral hook database (dual-category) ─────────────────────

async function fetchWezualHooks(niche) {
  const categories = nicheToWezualCategory(niche);
  const results = [];

  for (const category of [categories.primary, categories.secondary].filter(Boolean)) {
    const cacheK = 'wezual_' + category;
    let hooks = readCache(cacheK, CACHE_TTL_NICHE);

    if (!hooks) {
      hooks = [];
      for (const pageNum of [1, 2]) {
        const url = pageNum === 1
          ? `https://trends.wezual.com/instagram/hooks/${category}`
          : `https://trends.wezual.com/instagram/hooks/${category}?page=2`;
        try {
          const html = await fetchHTML(url);
          hooks.push(...extractWezualHooks(html));
        } catch (e) { /* ignore */ }
        if (hooks.length >= 20) break;
      }
      hooks = deduplicate(hooks).slice(0, 15);
      writeCache(cacheK, hooks);
    }

    if (hooks.length > 0) {
      results.push({ category, hooks });
      debug.sources.wezual.categories.push(category);
      debug.sources.wezual.hooks_extracted += hooks.length;
    }
  }

  return results; // array of { category, hooks }
}

// ─── Source 3a: Instagram captions via Instaloader ────────────────────────────

function fetchInstagramCaptions(handle) {
  const cacheK = 'ig_' + handle;
  const cached = readCache(cacheK, CACHE_TTL_ACCOUNT);
  if (cached !== null) {
    return cached.length > 0 ? { source: 'instagram', hooks: cached, status: 'ok' } : null;
  }

  // The python caption fetcher is optional and not bundled with the public repo.
  // Without it, skip silently and let the YouTube / Wezual / DuckDuckGo paths run.
  if (!fs.existsSync(CAPTION_SCRIPT)) {
    return null;
  }

  const result = spawnSync('python3', [CAPTION_SCRIPT, handle, '18'], {
    encoding: 'utf8',
    timeout: 25000,
    cwd: HOME
  });

  // Differentiated exit codes: 1=not-found, 2=private, 3=rate-limited, 4=other
  if (result.status === 1) {
    writeCache(cacheK, []);
    return { source: null, hooks: [], status: 'not-found' };
  }
  if (result.status === 2) {
    writeCache(cacheK, []);
    return { source: null, hooks: [], status: 'private' };
  }
  if (result.status === 3) {
    // Don't cache rate-limit results -- try again next run
    return { source: null, hooks: [], status: 'rate-limited' };
  }
  if (result.status !== 0 || !result.stdout.trim()) {
    writeCache(cacheK, []);
    return null;
  }

  const lines = result.stdout.trim().split('\n').filter(l => l.trim().length > 8);
  writeCache(cacheK, lines);
  return lines.length > 0 ? { source: 'instagram', hooks: lines.slice(0, 15), status: 'ok' } : null;
}

// ─── Source 3b: YouTube video titles ──────────────────────────────────────────

async function fetchYouTubeTitles(handle) {
  const cacheK = 'yt_' + handle;
  const cached = readCache(cacheK, CACHE_TTL_ACCOUNT);
  if (cached !== null) return cached.length > 0 ? { source: 'youtube-titles', hooks: cached } : null;

  const candidates = [
    `https://www.youtube.com/@${handle}/videos`,
    `https://www.youtube.com/@${handle.replace(/[^a-z0-9]/g, '')}/videos`
  ];

  for (const url of candidates) {
    try {
      const html = await fetchHTML(url);
      const match = html.match(/var ytInitialData = ({.*?});<\/script>/s);
      if (!match) continue;
      const data = JSON.parse(match[1]);
      const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
      const videosTab = tabs.find(t => t.tabRenderer?.title === 'Videos');
      const items = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];
      const titles = items
        .map(item => item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text)
        .filter(t => t && t.length >= 10 && t.length <= 120);
      if (titles.length > 0) {
        writeCache(cacheK, titles.slice(0, 12));
        return { source: 'youtube-titles', hooks: titles.slice(0, 12) };
      }
    } catch (e) { /* try next */ }
  }
  writeCache(cacheK, []);
  return null;
}

async function findCreatorYouTube(handle) {
  try {
    const q = encodeURIComponent(`${handle} site:youtube.com channel OR videos`);
    const html = await fetchHTML(`https://html.duckduckgo.com/html/?q=${q}`);
    const matches = html.match(/uddg=([^&"]+)/g) || [];
    const ytUrl = matches
      .map(m => decodeURIComponent(m.replace('uddg=', '')))
      .find(u => u.includes('youtube.com/@') || u.includes('youtube.com/c/') || u.includes('youtube.com/user/'));
    if (!ytUrl) return null;
    const videosUrl = ytUrl.replace(/\/(featured|about|playlists|community)?$/, '') + '/videos';
    const html2 = await fetchHTML(videosUrl);
    const match = html2.match(/var ytInitialData = ({.*?});<\/script>/s);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    const tabs = data?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const videosTab = tabs.find(t => t.tabRenderer?.title === 'Videos');
    const items = videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];
    const titles = items
      .map(item => item?.richItemRenderer?.content?.videoRenderer?.title?.runs?.[0]?.text)
      .filter(t => t && t.length >= 10 && t.length <= 120);
    return titles.length > 0 ? { source: 'youtube-titles', hooks: titles.slice(0, 12) } : null;
  } catch (e) {
    return null;
  }
}

// ─── Source 4: Article fallback (when Wezual is thin) ─────────────────────────

async function fetchFromArticlesFallback(niche) {
  const q = encodeURIComponent(`best performing ${niche} instagram reel hooks examples 2025`);
  let urls = [];
  try {
    const html = await fetchHTML(`https://html.duckduckgo.com/html/?q=${q}`);
    const matches = html.match(/uddg=([^&"]+)/g) || [];
    urls = [...new Set(
      matches.map(m => decodeURIComponent(m.replace('uddg=', '')))
        .filter(u => !u.includes('duckduckgo') && !u.includes('instagram.com') && !u.includes('tiktok.com'))
    )].slice(0, 4);
  } catch (e) { return []; }
  if (!urls.length) return [];

  const browser = await chromium.launch({
    headless: true, executablePath: CHROME,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();
  const hooks = [];
  try {
    for (const url of urls.slice(0, 2)) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(800);
        const found = await page.evaluate(() => {
          const results = [], seen = new Set();
          function add(text) {
            const clean = text.trim().replace(/\s+/g, ' ');
            if (clean.length >= 12 && clean.length <= 130 && !seen.has(clean.toLowerCase()) &&
              !clean.toLowerCase().match(/click|subscribe|privacy|cookie|sign up|learn more|read more|follow/)) {
              seen.add(clean.toLowerCase()); results.push(clean);
            }
          }
          document.querySelectorAll('ol li, ul li').forEach(el => { if (!el.querySelectorAll('li').length) add(el.innerText || ''); });
          document.querySelectorAll('blockquote, p strong, p b').forEach(el => add(el.innerText || ''));
          return results.slice(0, 12);
        });
        hooks.push(...found.filter(isHookShaped));
        if (hooks.length >= 12) break;
      } catch (e) { /* skip */ }
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return hooks;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  ensureCache();
  const output = [];

  // Track confidence metrics
  let recentCount = 0;
  let wezualCount = 0;
  let accountsFound = 0;
  const accountsTotal = accounts.length;

  // 1. Recent article hooks
  const recentHooks = await fetchRecentArticleHooks(niche).catch((e) => {
    process.stderr.write(`Recent articles failed: ${e.message}\n`);
    return [];
  });
  if (recentHooks.length > 0) {
    output.push('=RECENT:=');
    output.push(...recentHooks);
    recentCount = recentHooks.length;
  }

  // 2. Wezual niche database (dual-category)
  const wezualResults = await fetchWezualHooks(niche).catch((e) => {
    process.stderr.write(`Wezual failed: ${e.message}\n`);
    return [];
  });

  // If all Wezual categories are thin, try article fallback
  const totalWezualHooks = wezualResults.reduce((n, r) => n + r.hooks.length, 0);
  if (totalWezualHooks < 6) {
    const fallback = await fetchFromArticlesFallback(niche).catch(() => []);
    if (fallback.length > 0) {
      const fallbackCategory = wezualResults[0]?.category || 'business-marketing';
      if (wezualResults.length > 0) {
        wezualResults[0].hooks = deduplicate([...wezualResults[0].hooks, ...fallback]).slice(0, 15);
      } else {
        wezualResults.push({ category: fallbackCategory, hooks: fallback.slice(0, 15) });
      }
    }
  }

  for (const { category, hooks } of wezualResults) {
    if (hooks.length > 0) {
      output.push(`=WEZUAL:${category}=`);
      output.push(...hooks);
      wezualCount += hooks.length;
    }
  }

  // 3. Creator accounts
  for (const handle of accounts) {
    debug.sources.accounts[handle] = { status: 'pending' };

    // Try Instagram first
    let igResult = fetchInstagramCaptions(handle);

    // Handle differentiated failure modes
    if (igResult && igResult.status === 'private') {
      output.push(`=ACCOUNT:@${handle}:private=`);
      debug.sources.accounts[handle] = { status: 'private' };
      continue;
    }
    if (igResult && igResult.status === 'rate-limited') {
      output.push(`=ACCOUNT:@${handle}:rate-limited=`);
      debug.sources.accounts[handle] = { status: 'rate-limited' };
      continue;
    }

    if (igResult && igResult.hooks.length > 0) {
      output.push(`=ACCOUNT:@${handle}:instagram=`);
      output.push(...igResult.hooks);
      accountsFound++;
      debug.sources.accounts[handle] = { status: 'ok', source: 'instagram', count: igResult.hooks.length };
      continue;
    }

    // Fall back to YouTube
    let ytResult = await fetchYouTubeTitles(handle).catch(() => null);
    if (!ytResult || ytResult.hooks.length === 0) {
      ytResult = await findCreatorYouTube(handle).catch(() => null);
    }

    if (ytResult && ytResult.hooks.length > 0) {
      output.push(`=ACCOUNT:@${handle}:youtube-titles=`);
      output.push(...ytResult.hooks);
      accountsFound++;
      debug.sources.accounts[handle] = { status: 'ok', source: 'youtube-titles', count: ytResult.hooks.length };
    } else {
      output.push(`=ACCOUNT:@${handle}:not-found=`);
      debug.sources.accounts[handle] = { status: 'not-found' };
    }
  }

  // 4. Confidence signal
  const totalHooks = recentCount + wezualCount;
  let confidenceLevel = 'low';
  if (totalHooks >= 20 || (totalHooks >= 12 && accountsFound > 0)) {
    confidenceLevel = 'high';
  } else if (totalHooks >= 8) {
    confidenceLevel = 'medium';
  }

  if (output.length === 0 || totalHooks === 0) {
    // All sources failed
    process.stdout.write(`=RESEARCH:failed=\nNo hook data could be fetched. Possible causes: DDG rate-limited, Playwright blocked, Wezual unreachable. Try again in 1 hour, or add creator account handles to get direct data.\n`);
  } else {
    output.push(`=CONFIDENCE:${confidenceLevel}=`);
    output.push(`recent:${recentCount},wezual:${wezualCount},accounts:${accountsFound}/${accountsTotal}`);
    process.stdout.write(output.join('\n') + '\n');
  }

  // 5. Write debug log
  try {
    fs.writeFileSync(
      path.join(CACHE_DIR, 'last-run-debug.json'),
      JSON.stringify({ ...debug, confidence: { level: confidenceLevel, recentCount, wezualCount, accountsFound, accountsTotal } }, null, 2)
    );
  } catch (e) { /* ignore */ }
}

main().catch(err => {
  process.stderr.write(`market-research error: ${err.message}\n`);
  process.exit(1);
});
