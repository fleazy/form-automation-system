let nativePort = null;

function connectToNativeApp() {
  try {
    nativePort = chrome.runtime.connectNative('com.scrolldetector.host');
    
    nativePort.onMessage.addListener((message) => {
      if (message.type === 'PING') {
        nativePort.postMessage({ type: 'PONG' });
      }
    });
    
    nativePort.onDisconnect.addListener(() => {
      nativePort = null;
      setTimeout(connectToNativeApp, 1000);
    });
  } catch (error) {
    setTimeout(connectToNativeApp, 1000);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BOTTOM_REACHED' || message.type === 'SCROLL_UPDATE') {
    if (nativePort) {
      nativePort.postMessage({
        type: message.type,
        scrollPercent: message.scrollPercent,
        isAtBottom: message.isAtBottom || false,
        tabId: sender.tab.id,
        url: sender.tab.url
      });
    }
  }
});

connectToNativeApp();