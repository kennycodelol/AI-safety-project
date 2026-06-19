chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scanPage') {
    const pageText = document.body?.innerText ?? '';
    sendResponse({ success: true, content: pageText.slice(0, 8000) });
  }
});
