// background.js - Service Worker for Block Extension v1.1
// Features:
// 1. Manual blocking via user patterns (blockedEntries)
// 2. Optional adult / unsafe content auto blocking (heuristic + Safe Browsing malware check)
// 3. Per-site daily time limits with automatic blocking when exceeded
// 4. Migration from legacy blockedUrls (array of strings)

// ---- Storage Keys ----
// blockedEntries: Array<{ id: string, pattern: string, dailyLimitMinutes: number|null }>
// autoBlockedPatterns: Array<string> (patterns auto discovered via adult filter / malware)
// enableAdultFilter: boolean
// safeBrowsingApiKey: string (optional)
// usageToday: { date: 'YYYY-MM-DD', usage: { [pattern: string]: number /* ms */ } }
// runtimeState: { activeTabId?: number, activePattern?: string, activeStart?: number }
// (legacy) blockedUrls: Array<string>

// ---- Constants ----
const ADULT_KEYWORDS = [
    'porn', 'sex', 'xxx', 'xvideos', 'redtube', 'brazzers', 'youporn', 'xnxx', 'hentai', 'anal', 'escort', 'camgirl', 'camwhores', 'nsfw'
];
const BLOCK_REDIRECT_PAGE = chrome.runtime.getURL('blocked.html');

// Cache for Safe Browsing results to avoid quota overuse
// safeBrowsingCache: { [domain]: { safe: boolean, ts: number } }
let safeBrowsingCache = {};
const SAFE_BROWSING_TTL = 24 * 60 * 60 * 1000; // 24h

// In-memory quick copies (will be hydrated and kept in sync)
let blockedEntries = []; // manual entries
let autoBlockedPatterns = []; // auto patterns
let enableAdultFilter = false;

// Utility: today string
function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

// Migration from legacy blockedUrls -> blockedEntries
async function migrateIfNeeded() {
    const {blockedEntries: be, blockedUrls} = await chrome.storage.local.get(['blockedEntries', 'blockedUrls']);
    if (!be && Array.isArray(blockedUrls)) {
        const migrated = blockedUrls.map(p => ({id: crypto.randomUUID(), pattern: p, dailyLimitMinutes: null}));
        await chrome.storage.local.set({blockedEntries: migrated});
    }
}

// Load initial config into memory
async function hydrate() {
    await migrateIfNeeded();
    const data = await chrome.storage.local.get([
        'blockedEntries', 'autoBlockedPatterns', 'enableAdultFilter'
    ]);
    blockedEntries = data.blockedEntries || [];
    autoBlockedPatterns = data.autoBlockedPatterns || [];
    enableAdultFilter = !!data.enableAdultFilter;
}

// Persist usage accumulation
async function addUsage(pattern, deltaMs) {
    if (!pattern || deltaMs <= 0) return;
    const {usageToday} = await chrome.storage.local.get('usageToday');
    const t = todayStr();
    let usageObj = usageToday && usageToday.date === t ? usageToday : {date: t, usage: {}};
    usageObj.usage[pattern] = (usageObj.usage[pattern] || 0) + deltaMs;
    await chrome.storage.local.set({usageToday: usageObj});
}

// Retrieve usage quickly
async function getUsage(pattern) {
    const {usageToday} = await chrome.storage.local.get('usageToday');
    if (!usageToday || usageToday.date !== todayStr()) return 0;
    return usageToday.usage[pattern] || 0;
}

// Determine if pattern exceeded time
async function isTimeExceeded(entry) {
    if (!entry.dailyLimitMinutes) return false;
    const usedMs = await getUsage(entry.pattern);
    return usedMs >= entry.dailyLimitMinutes * 60000;
}

// Build & install dynamic rules for manual + exceeded + auto patterns
async function updateBlockingRules() {
    await hydrate();
    const manualAlways = []; // entries without limit => always blocked
    const timeExceeded = []; // entries with limit exceeded

    for (const e of blockedEntries) {
        if (!e.dailyLimitMinutes) {
            manualAlways.push(e.pattern);
        } else if (await isTimeExceeded(e)) {
            timeExceeded.push(e.pattern);
        }
    }

    // Normalize auto patterns (support legacy string array)
    const autoPatterns = (autoBlockedPatterns || []).map(p => typeof p === 'string' ? p : (p && p.pattern) || '').filter(Boolean);

    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const existingIds = existing.map(r => r.id);

    let ruleId = 0;
    const newRules = [];

    function pushRule(pattern, reason) {
        ruleId += 1;
        newRules.push({
            id: ruleId,
            priority: 1,
            action: {
                type: 'redirect',
                redirect: {extensionPath: '/blocked.html?reason=' + encodeURIComponent(reason) + '&pattern=' + encodeURIComponent(pattern)}
            },
            condition: {urlFilter: `*${pattern}*`, resourceTypes: ['main_frame']}
        });
    }

    manualAlways.forEach(p => pushRule(p, 'manual'));
    timeExceeded.forEach(p => pushRule(p, 'time'));
    autoPatterns.forEach(p => pushRule(p, 'auto'));

    await chrome.declarativeNetRequest.updateDynamicRules({removeRuleIds: existingIds, addRules: newRules});
}

// Evaluate adult / unsafe content heuristically
function looksAdult(url) {
    try {
        const u = new URL(url);
        return ADULT_KEYWORDS.some(k => u.hostname.toLowerCase().includes(k) || u.pathname.toLowerCase().includes(k));
    } catch {
        return false;
    }
}

function getDomain(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return '';
    }
}

async function safeBrowsingCheck(url) {
    const {safeBrowsingApiKey} = await chrome.storage.local.get('safeBrowsingApiKey');
    if (!safeBrowsingApiKey) return {malware: false};
    const domain = getDomain(url);
    if (!domain) return {malware: false};
    const cached = safeBrowsingCache[domain];
    const now = Date.now();
    if (cached && now - cached.ts < SAFE_BROWSING_TTL) return {malware: !cached.safe};

    try {
        const body = {
            client: {clientId: 'block-extension', clientVersion: '1.1'},
            threats: {
                platformTypes: ['ANY_PLATFORM'],
                threatEntryTypes: ['URL'],
                threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION']
            },
            threatInfo: {threatEntries: [{url}]}
        };
        // v4 threatMatches: https://safebrowsing.googleapis.com/v4/threatMatches:find
        const resp = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${safeBrowsingApiKey}`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)
        });
        const json = await resp.json();
        const malware = !!(json && json.matches && json.matches.length);
        safeBrowsingCache[domain] = {safe: !malware, ts: now};
        return {malware};
    } catch (e) {
        return {malware: false};
    }
}

// Decide if URL should be auto blocked (returns pattern if yes)
async function evaluateAndMaybeAutoBlock(url) {
    if (!enableAdultFilter) return null;
    const domain = getDomain(url);
    if (!domain) return null;
    // Skip if already manually blocked or auto blocked
    if (blockedEntries.some(e => domain.includes(e.pattern)) || autoBlockedPatterns.some(p => domain.includes(p))) return null;

    let reason = null;
    if (looksAdult(url)) reason = 'adult';
    const sb = await safeBrowsingCheck(url);
    if (sb.malware) reason = reason || 'malware';
    if (!reason) return null;

    // Add domain as auto block pattern
    autoBlockedPatterns.push(domain);
    await chrome.storage.local.set({autoBlockedPatterns});
    await updateBlockingRules();
    return {pattern: domain, reason};
}

// Redirect helper
async function redirectTab(tabId, reason, pattern) {
    const target = `${BLOCK_REDIRECT_PAGE}?reason=${encodeURIComponent(reason)}&pattern=${encodeURIComponent(pattern || '')}`;
    try {
        await chrome.tabs.update(tabId, {url: target});
    } catch {
    }
}

// Active usage tracking
async function updateActiveUsage() { // removed unused eventSource param
    const state = await chrome.storage.local.get('runtimeState');
    const rs = state.runtimeState || {};
    const now = Date.now();
    if (rs.activePattern && rs.activeStart) {
        const delta = now - rs.activeStart;
        if (delta > 0) await addUsage(rs.activePattern, delta);
    }
    // Determine current active tab & pattern
    let activeTabs;
    try {
        activeTabs = await chrome.tabs.query({active: true, lastFocusedWindow: true});
    } catch {
        activeTabs = [];
    }
    const activeTab = activeTabs[0];
    let newPattern = null;
    if (activeTab && activeTab.url && /^https?:/i.test(activeTab.url)) {
        for (const e of blockedEntries) {
            if (activeTab.url.includes(e.pattern)) {
                newPattern = e.pattern;
                break;
            }
        }
    }
    await chrome.storage.local.set({
        runtimeState: {
            activeTabId: activeTab ? activeTab.id : null,
            activePattern: newPattern,
            activeStart: newPattern ? now : null
        }
    });

    // After updating usage, check time limits and enforce if exceeded for currently open tabs
    for (const e of blockedEntries) {
        if (await isTimeExceeded(e)) {
            // Ensure rule is applied (updateRules will include pattern anyway)
            // If active tab matches this pattern, redirect
            if (activeTab && activeTab.url && activeTab.url.includes(e.pattern)) {
                await redirectTab(activeTab.id, 'time', e.pattern);
            }
        }
    }
    await updateBlockingRules();
}

// Navigation interception for auto blocking (adult filter)
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
    if (details.frameId !== 0) return; // main frame only
    await hydrate();
    const url = details.url;
    const auto = await evaluateAndMaybeAutoBlock(url);
    if (auto) {
        await redirectTab(details.tabId, auto.reason, auto.pattern);
    }
});

// Tab activation & updates -> usage tracking
chrome.tabs.onActivated.addListener(() => updateActiveUsage());
chrome.tabs.onRemoved.addListener(() => updateActiveUsage());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete') updateActiveUsage();
});
chrome.windows.onFocusChanged.addListener(() => updateActiveUsage());

// Heartbeat from content script to keep counting while user stays on a page
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'heartbeat') {
        updateActiveUsage();
        sendResponse({ok: true});
    }
});

// Storage change reactions
chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let needsRules = false;
    if (changes.blockedEntries) {
        blockedEntries = changes.blockedEntries.newValue || [];
        needsRules = true;
    }
    if (changes.autoBlockedPatterns) {
        autoBlockedPatterns = changes.autoBlockedPatterns.newValue || [];
        needsRules = true;
    }
    if (changes.enableAdultFilter) {
        enableAdultFilter = !!changes.enableAdultFilter.newValue;
    }
    if (needsRules) updateBlockingRules();
});

// Installation / Startup
chrome.runtime.onInstalled.addListener(async () => {
    await hydrate();
    await updateBlockingRules();
});
chrome.runtime.onStartup.addListener(async () => {
    await hydrate();
    await updateBlockingRules();
});

// Fallback: periodic alarm to ensure usage recorded even if events missed
chrome.alarms.create('usagePulse', {periodInMinutes: 1});
chrome.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === 'usagePulse') updateActiveUsage();
});

// Initial hydrate
hydrate().then(() => updateBlockingRules());
