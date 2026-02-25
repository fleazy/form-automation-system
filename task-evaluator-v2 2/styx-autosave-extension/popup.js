/**
 * Styx Auto-Save — Popup Script
 */

document.addEventListener("DOMContentLoaded", () => {
    const enabledToggle = document.getElementById("enabledToggle");
    const delayInput = document.getElementById("delayInput");
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");

    // Load settings
    chrome.storage.local.get({ enabled: true, saveDelay: 5000 }, (settings) => {
        enabledToggle.checked = settings.enabled;
        delayInput.value = Math.round(settings.saveDelay / 1000);
        updateStatus(settings.enabled);
    });

    // Toggle auto-save
    enabledToggle.addEventListener("change", () => {
        const enabled = enabledToggle.checked;
        chrome.storage.local.set({ enabled });
        updateStatus(enabled);
    });

    // Update delay
    delayInput.addEventListener("change", () => {
        let seconds = parseInt(delayInput.value, 10);
        if (isNaN(seconds) || seconds < 1) seconds = 1;
        if (seconds > 30) seconds = 30;
        delayInput.value = seconds;
        chrome.storage.local.set({ saveDelay: seconds * 1000 });
    });

    function updateStatus(enabled) {
        statusDot.className = "status-dot " + (enabled ? "on" : "off");
        statusText.textContent = enabled
            ? "Watching for task pages..."
            : "Auto-save paused";
    }
});
