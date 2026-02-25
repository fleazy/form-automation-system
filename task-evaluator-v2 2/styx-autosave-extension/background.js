/**
 * Styx Auto-Save — Background Service Worker
 * 
 * Listens for messages from the content script when a DataAnnotation task page
 * finishes loading, then triggers SingleFile to save the page.
 */

// SingleFile's Chrome Web Store extension ID
const SINGLEFILE_EXTENSION_ID = "mpiodijhokgodhhofbcjdecpffjipkle";

// Configurable delay (ms) before triggering save — gives page time to fully render
const DEFAULT_SAVE_DELAY = 5000;

// Track which tabs we've already saved to avoid duplicates
const savedTabs = new Set();

/**
 * Listen for messages from our content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "TASK_PAGE_LOADED" && sender.tab) {
        const tabId = sender.tab.id;
        const url = sender.tab.url || message.url;

        // Check if we already saved this tab (avoid double-saves on SPA navigation)
        if (savedTabs.has(tabId)) {
            sendResponse({ status: "skipped" });
            return;
        }

        // Check if auto-save is enabled
        chrome.storage.local.get({ enabled: true, saveDelay: DEFAULT_SAVE_DELAY }, (settings) => {
            if (!settings.enabled) {
                sendResponse({ status: "disabled" });
                return;
            }

            // Delay to let the page fully render (React/dynamic content)
            setTimeout(() => {
                triggerSingleFileSave(tabId, url);
            }, settings.saveDelay);
        });

        // Return true to indicate async response
        return true;
    }
});

/**
 * When a tab navigates away or closes, remove it from the saved set
 * so it can be saved again if the user returns.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
    savedTabs.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) {
        // URL changed — allow re-saving
        savedTabs.delete(tabId);
    }
});

/**
 * Trigger the content script to download its own HTML.
 */
function triggerSingleFileSave(tabId, url) {
    chrome.tabs.sendMessage(tabId, { action: "DOWNLOAD_HTML" }, (response) => {
        if (chrome.runtime.lastError) {
            showBadge(tabId, "!", "#f7768e");
        } else {
            savedTabs.add(tabId);
            showBadge(tabId, "✓", "#9ece6a");
        }
    });
}

/**
 * Show a brief badge on the extension icon
 */
function showBadge(tabId, text, color) {
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color, tabId });

    // Clear after 3 seconds
    setTimeout(() => {
        chrome.action.setBadgeText({ text: "", tabId });
    }, 3000);
}
