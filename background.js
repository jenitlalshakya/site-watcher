const CHECK_INTERVAL_MINUTES = 10; // Check every ten minutes
const UNSEEN_EXPIRY_DAYS = 3;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('monitoredSites', ({ monitoredSites }) => {
    if (!monitoredSites) {
      chrome.storage.local.set({ monitoredSites: [] });
    }
  });

  // Create a repeating alarm for all monitored sites
  chrome.storage.local.get('monitoredSites', ({ monitoredSites }) => {
    if (monitoredSites && monitoredSites.length > 0) {
      monitoredSites.forEach(site => {
        chrome.alarms.create(`check-site-${site.id}`, {
          periodInMinutes: CHECK_INTERVAL_MINUTES
        });
      });
    }
  });
});

// Hash function to create SHA-256 hash of content
async function hashContent(content) {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Fallback sync hash (not cryptographically strong, used only when needed)
function hashContentSync(content) {
  let hash = 0, i, chr;
  if (content.length === 0) return hash.toString();
  for (i = 0; i < content.length; i++) {
    chr = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString();
}

// Check site using fetch()
async function checkSiteWithFetch(site) {
  try {
    const response = await fetch(site.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
    const html = await response.text();
    return html;
  } catch (e) {
    console.warn(`Fetch failed for ${site.url}, falling back to scripting:`, e);
    return null;
  }
}

// Check site using scripting (injecting script in tab)
function checkSiteWithScripting(site) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url: site.url, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      // Wait 6 seconds to allow page scripts to load content
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => {
            // Remove common dynamic elements (timestamps, counters, etc.)
            const selectors = [
              '.time', '.date', '.clock', '.counter', '.updated', '.timestamp',
              '[class*="time"]', '[class*="date"]', '[class*="clock"]', '[class*="counter"]', '[class*="updated"]', '[class*="stamp"]',
              '[id*="time"]', '[id*="date"]', '[id*="clock"]', '[id*="counter"]', '[id*="updated"]', '[id*="stamp"]'
            ];
            selectors.forEach(sel => {
              document.querySelectorAll(sel).forEach(el => el.remove());
            });
            return document.body.innerText || "";
          }
        }, async (results) => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            chrome.tabs.remove(tab.id);
            return;
          }
          const pageText = results[0]?.result || "";
          chrome.tabs.remove(tab.id);
          resolve(pageText);
        });
      }, 6000); // 6 seconds delay, adjust if needed
    });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('check-site-')) return;

  const siteId = alarm.name.split('-')[2];
  chrome.storage.local.get('monitoredSites', async ({ monitoredSites }) => {
    const site = monitoredSites.find(s => s.id === siteId);
    if (!site) return;

    // Cleanup old unseen updates (> UNSEEN_EXPIRY_DAYS)
    if (site.unseenUpdate && (Date.now() - site.unseenUpdate.timestamp) > UNSEEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000) {
      delete site.unseenUpdate;
    }

    // Try fetch first
    let content = await checkSiteWithFetch(site);
    // If fetch fails or returns null, fallback to scripting
    if (!content) {
      try {
        content = await checkSiteWithScripting(site);
      } catch (e) {
        console.error(`Scripting check failed for ${site.url}:`, e);
        return; // Can't check this time
      }
    }

    if (!content) return; // Nothing to compare

    const newHash = await hashContent(content);

    if (newHash !== site.lastHash) {
      // New update found
      site.unseenUpdate = {
        content: content,
        timestamp: Date.now()
      };

      chrome.notifications.create(site.url, {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Website Update Detected!',
        message: `Update detected on "${site.name}"`,
        priority: 1
      });
    }

    // Always update the lastHash and lastChecked, even if no update was found
    site.lastHash = newHash;
    site.lastChecked = new Date().toISOString();
    monitoredSites.splice(monitoredSites.findIndex(s => s.id === site.id), 1, site);
    chrome.storage.local.set({ monitoredSites });
  });
});

chrome.notifications.onClicked.addListener((siteUrl) => {
  chrome.storage.local.get('monitoredSites', ({ monitoredSites }) => {
    const index = monitoredSites.findIndex(s => s.url === siteUrl);
    if (index !== -1 && monitoredSites[index].unseenUpdate) {
      // Mark update as seen: update lastHash and delete unseenUpdate
      const content = monitoredSites[index].unseenUpdate.content;
      monitoredSites[index].lastHash = hashContentSync(content);
      delete monitoredSites[index].unseenUpdate;
      chrome.storage.local.set({ monitoredSites });
    }
  });
});

chrome.runtime.onInstalled.addListener(() => {
  // Create a repeating alarm for all monitored sites every 4 hours
  chrome.storage.local.get('monitoredSites', ({ monitoredSites }) => {
    if (monitoredSites && monitoredSites.length > 0) {
      monitoredSites.forEach(site => {
        chrome.alarms.create(`check-site-${site.id}`, { periodInMinutes: CHECK_INTERVAL_MINUTES });
      });
    }
  });
});

// Add or update a site (called from popup.js)
async function addOrUpdateSite(site) {
  chrome.storage.local.get('monitoredSites', ({ monitoredSites }) => {
    const sites = monitoredSites || [];
    const index = sites.findIndex(s => s.id === site.id);
    if (index >= 0) {
      // Only update the relevant site, keep others unchanged
      sites[index] = { ...sites[index], ...site };
    } else {
      sites.push(site);
    }
    chrome.storage.local.set({ monitoredSites: sites }, () => {
      // Create/update alarm for this site
      chrome.alarms.create(`check-site-${site.id}`, {
        delayInMinutes: 1,
        periodInMinutes: CHECK_INTERVAL_MINUTES
      });
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'addSite') {
    addOrUpdateSite(message.site).then(() => sendResponse({ status: 'ok' }));
    return true; // async response
  }
  else if (message.type === 'getSites') {
    chrome.storage.local.get('monitoredSites', ({ monitoredSites }) => {
      sendResponse(monitoredSites || []);
    });
    return true;
  }
});
