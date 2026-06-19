chrome.webNavigation.onCompleted.addListener((details) => {
  if (details.frameId !== 0) return;

  chrome.storage.local.get(['actionLog'], (result) => {
    const logs = result.actionLog || [];
    logs.push({ url: details.url, timestamp: Date.now() });
    chrome.storage.local.set({ actionLog: logs });
  });
});

// Chrome side panel (not supported in Opera GX)
if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
}
