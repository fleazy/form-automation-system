/**
 * Styx Auto-Save — Content Script
 * 
 * Runs on DataAnnotation task pages. Waits for the page to fully load,
 * then notifies the background service worker to trigger SingleFile.
 */

(function () {
    "use strict";

    const TASK_URL_PATTERN = /app\.dataannotation\.tech\/workers\/tasks\//;

    // Only proceed if we're on a task page
    if (!TASK_URL_PATTERN.test(window.location.href)) {
        return;
    }

    /**
     * Wait for the page to have meaningful content loaded.
     * DataAnnotation uses React, so we need to wait for the dynamic content.
     */
    function waitForContent(callback, maxWait = 15000) {
        const start = Date.now();

        function check() {
            // Look for indicators that the task has loaded:
            // - rendered-markdown sections (the prompt/responses)
            // - radio buttons (the rating form)
            // - gondor-wysiwyg sections (instructions)
            const hasMarkdown = document.querySelectorAll(".rendered-markdown").length > 0;
            const hasRadios = document.querySelectorAll("input[type='radio']").length > 0;
            const hasWysiwyg = document.querySelectorAll(".gondor-wysiwyg").length > 0;

            if (hasMarkdown && hasRadios) {
                callback();
                return;
            }

            if (Date.now() - start > maxWait) {
                callback();
                return;
            }

            // Check again in 500ms
            setTimeout(check, 500);
        }

        check();
    }

    // Wait for content, then signal the background
    waitForContent(() => {
        chrome.runtime.sendMessage(
            { action: "TASK_PAGE_LOADED", url: window.location.href },
            (response) => { }
        );
    });

    // Also watch for SPA navigation (DataAnnotation might use client-side routing)
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            if (TASK_URL_PATTERN.test(lastUrl)) {
                waitForContent(() => {
                    chrome.runtime.sendMessage(
                        { action: "TASK_PAGE_LOADED", url: lastUrl },
                        (response) => { }
                    );
                });
            }
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for the download command from the background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "DOWNLOAD_HTML") {
            // Grab the full HTML
            const html = "<!DOCTYPE html>\n" + document.documentElement.outerHTML;
            const blob = new Blob([html], { type: "text/html" });
            const url = URL.createObjectURL(blob);

            // Create a fake link to trigger the download
            const a = document.createElement("a");
            a.href = url;
            const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
            a.download = `Styx_Task_${timestamp}.html`;

            // Click it to trigger the native browser download
            document.body.appendChild(a);
            a.click();

            // Clean up
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            sendResponse({ status: "success" });
        }
    });

})();
