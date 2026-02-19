// Helper: generate unique ID
function generateId(url) {
  return btoa(url).replace(/=/g, '');
}

function getFavicon(url) {
  try {
    const u = new URL(url);
    return u.origin + '/favicon.ico';
  } catch {
    return 'icons/icon16.png';
  }
}

// Add site
document.getElementById("addSite").addEventListener("click", async () => {
  const url = document.getElementById("url").value.trim();
  const name = document.getElementById("name").value.trim() || url;
  if (!url) return alert("Enter a valid URL!");

  chrome.storage.local.get({ monitoredSites: [] }, ({ monitoredSites }) => {
    const id = generateId(url);
    let site = monitoredSites.find(s => s.id === id);
    if (!site) {
      site = { id, url, name, bookmarked: true };
      monitoredSites.push(site);
    } else {
      site.bookmarked = true;
      site.name = name;
    }
    chrome.runtime.sendMessage({ type: "addSite", site }, () => {
      document.getElementById("message").textContent = "Site added/bookmarked!";
      renderBookmarks();
    });
  });
});

// Enable/disable Add Site button based on URL input
function updateAddButton() {
  const url = document.getElementById("url").value.trim();
  const addButton = document.getElementById("addSite");
  addButton.disabled = !url;
}

// Add input event listeners to enable/disable button
document.addEventListener('DOMContentLoaded', () => {
  const urlInput = document.getElementById("url");
  const nameInput = document.getElementById("name");
  
  urlInput.addEventListener('input', updateAddButton);
  nameInput.addEventListener('input', updateAddButton);
  
  // Initial state
  updateAddButton();
});

// Render bookmarks
function renderBookmarks() {
  chrome.storage.local.get({ monitoredSites: [] }, ({ monitoredSites }) => {
    const bookmarks = monitoredSites.filter(s => s.bookmarked);
    const container = document.getElementById("bookmarks");
    container.innerHTML = "";
    if (bookmarks.length === 0) {
      container.textContent = "No bookmarks yet.";
      return;
    }
    bookmarks.forEach(site => {
      const div = document.createElement("div");
      div.className = "site-item";
      // Use <a> for clickable name or URL, open in new tab, and remove underline with inline style
      div.innerHTML = `
        <span class="site-icon"><img class="favicon" data-src="${getFavicon(site.url)}" width="20" height="20"></span>
        <a class="site-name" title="${site.url}" href="${site.url}" target="_blank" style="text-decoration:none; color:inherit;">${site.name || site.url}</a>
        <span class="site-actions">
          <button data-id="${site.id}" class="remove">Remove</button>
        </span>
      `;
      container.appendChild(div);
    });
    container.querySelectorAll('.favicon').forEach(img => {
      img.src = img.dataset.src;
      img.onerror = () => { img.src = 'icons/icon16.png'; };
    });    
    // Remove handler
    container.querySelectorAll(".remove").forEach(btn => {
      btn.onclick = function() {
        const id = this.getAttribute("data-id");
        chrome.storage.local.get({ monitoredSites: [] }, ({ monitoredSites }) => {
          const idx = monitoredSites.findIndex(s => s.id === id);
          if (idx !== -1) {
            // Remove the site completely from monitoring
            monitoredSites.splice(idx, 1);
            chrome.storage.local.set({ monitoredSites }, () => {
              // Stop the alarm for this site
              chrome.alarms.clear(`check-site-${id}`);
              renderBookmarks();
            });
          }
        });
      };
    });
  });
}

// Toggle history modal open/close
const historyModal = document.getElementById("historyModal");
const showHistoryBtn = document.getElementById("showHistory");
const closeHistoryBtn = document.getElementById("closeHistory");

showHistoryBtn.onclick = function() {
  if (historyModal.style.display === "block") {
    historyModal.style.display = "none";
  } else {
    renderHistory();
    historyModal.style.display = "block";
  }
};
closeHistoryBtn.onclick = function() {
  historyModal.style.display = "none";
};

// Render history
function renderHistory() {
  chrome.storage.local.get({ monitoredSites: [] }, ({ monitoredSites }) => {
    const history = monitoredSites.filter(s => s.unseenUpdate);
    const container = document.getElementById("historyList");
    container.innerHTML = "";
    if (history.length === 0) {
      container.textContent = "No unseen updates.";
      return;
    }
    history.forEach(site => {
      const div = document.createElement("div");
      div.className = "site-item";
      div.innerHTML = `
        <span class="site-icon"><img src="${getFavicon(site.url)}" onerror="this.src='icons/icon16.png'" width="20" height="20"></span>
        <a class="site-name" title="${site.url}" href="${site.url}" target="_blank" data-id="${site.id}">${site.name}</a>
        <span style="font-size:11px; color:#888; margin-left:8px;">${new Date(site.unseenUpdate.timestamp).toLocaleString()}</span>
        <span class="site-actions">
          <button data-id="${site.id}" class="view-update">View</button>
          <button data-id="${site.id}" class="clear-history">Mark as Read</button>
        </span>
      `;
      container.appendChild(div);
    });
    // Mark as read handler
    container.querySelectorAll(".clear-history").forEach(btn => {
      btn.onclick = function() {
        const id = this.getAttribute("data-id");
        markAsRead(id);
      };
    });
    // View handler
    container.querySelectorAll(".view-update").forEach(btn => {
      btn.onclick = function() {
        const id = this.getAttribute("data-id");
        chrome.storage.local.get({ monitoredSites: [] }, ({ monitoredSites }) => {
          const site = monitoredSites.find(s => s.id === id);
          if (site && site.unseenUpdate) {
            alert(site.unseenUpdate.content.slice(0, 1000) + (site.unseenUpdate.content.length > 1000 ? "..." : ""));
            markAsRead(id);
          }
        });
      };
    });
    // Href handler (site name)
    container.querySelectorAll(".site-name").forEach(link => {
      link.onclick = function(e) {
        const id = this.getAttribute("data-id");
        markAsRead(id);
        // Let the link open in a new tab as normal
      };
    });
  });
}

function markAsRead(id) {
  chrome.storage.local.get({ monitoredSites: [] }, ({ monitoredSites }) => {
    const idx = monitoredSites.findIndex(s => s.id === id);
    if (idx !== -1) {
      delete monitoredSites[idx].unseenUpdate;
      chrome.storage.local.set({ monitoredSites }, renderHistory);
    }
  });
}

// Initial render
renderBookmarks();

// Autofill URL input with current tab's URL
window.addEventListener('DOMContentLoaded', () => {
  chrome.tabs && chrome.tabs.query && chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (tabs && tabs[0] && tabs[0].url) {
      document.getElementById('url').value = tabs[0].url;
      updateAddButton(); // Enable button after autofill
    }
  });
});