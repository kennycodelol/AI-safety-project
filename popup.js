const analyzeBtn = document.getElementById('analyzeBtn');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const progressEl = document.getElementById('progress');

const AVAILABILITY_OPTS = {
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
};

let aiSession = null;

function setStatus(message) {
  statusEl.textContent = message;
}

function showResult(text, isError = false) {
  resultEl.textContent = text;
  resultEl.classList.add('visible');
  resultEl.classList.toggle('error', isError);
}

function showProgress(value) {
  progressEl.hidden = false;
  if (value < 0) {
    progressEl.removeAttribute('value');
  } else {
    progressEl.value = value;
  }
}

function hideProgress() {
  progressEl.hidden = true;
  progressEl.value = 0;
}

function isModelReady(availability) {
  return availability === 'available' || availability === 'readily';
}

function isModelPending(availability) {
  return availability === 'downloadable' || availability === 'downloading';
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ success: false, needsInject: true, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response ?? { success: false, error: 'No response from page.' });
    });
  });
}

async function getPageText(tabId) {
  let response = await sendTabMessage(tabId, { action: 'scanPage' });

  if (response.needsInject) {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    response = await sendTabMessage(tabId, { action: 'scanPage' });
  }

  if (!response?.success) {
    throw new Error(response?.error ?? 'Could not read page. Try refreshing the tab.');
  }

  if (!response.content?.trim()) {
    throw new Error('Page has no readable text to analyze.');
  }

  return response.content;
}

async function waitForBackgroundDownload(onProgress) {
  let availability = await LanguageModel.availability(AVAILABILITY_OPTS);

  while (availability === 'downloading') {
    onProgress('Chrome is downloading Gemini Nano in the background (see chrome://components)…');
    showProgress(-1);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    availability = await LanguageModel.availability(AVAILABILITY_OPTS);
  }

  return availability;
}

async function getOrCreateSession(onProgress) {
  if (!('LanguageModel' in self)) {
    throw new Error('Gemini Nano requires Google Chrome 138+.');
  }

  if (aiSession) {
    return aiSession;
  }

  onProgress('Checking Gemini Nano availability…');

  let availability = await withTimeout(
    LanguageModel.availability(AVAILABILITY_OPTS),
    15000,
    'Timed out checking model availability. Enable chrome://flags/#prompt-api-for-gemini-nano and reload Chrome.'
  );

  if (availability === 'unavailable') {
    throw new Error(
      'Gemini Nano is unavailable on this device. Check chrome://flags, chrome://components, and hardware requirements (22GB disk, 4GB+ VRAM or 16GB RAM).'
    );
  }

  if (availability === 'downloading') {
    availability = await waitForBackgroundDownload(onProgress);
  }

  if (isModelPending(availability)) {
    onProgress('Starting Gemini Nano download…');
    showProgress(0);
  } else {
    onProgress('Loading Gemini Nano…');
    showProgress(-1);
  }

  aiSession = await withTimeout(
    LanguageModel.create({
      ...AVAILABILITY_OPTS,
      initialPrompts: [{
        role: 'system',
        content: 'You are a moral decision assistant. Analyze situations for ethical implications. Be concise and practical.',
      }],
      monitor(m) {
        m.addEventListener('downloadprogress', (e) => {
          const percent = Math.round(e.loaded * 100);
          showProgress(e.loaded);
          onProgress(`Downloading model… ${percent}%`);

          if (e.loaded >= 1) {
            onProgress('Download complete — loading model into memory…');
            showProgress(-1);
          }
        });
      },
    }),
    600000,
    'Model download timed out after 10 minutes. Open chrome://components and update Optimization Guide On Device Model.'
  );

  hideProgress();
  return aiSession;
}

async function analyzeActiveTab(onProgress) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error('No active tab found.');
  }

  const blockedPrefixes = ['chrome://', 'chrome-extension://', 'opera://', 'edge://', 'devtools://'];
  if (blockedPrefixes.some((prefix) => tab.url?.startsWith(prefix))) {
    throw new Error('Cannot analyze browser internal pages. Open a regular website first.');
  }

  const session = await getOrCreateSession(onProgress);

  onProgress('Reading page text…');
  const pageText = await getPageText(tab.id);

  onProgress('Analyzing page with Gemini Nano…');
  showProgress(-1);

  const analysis = await withTimeout(
    session.prompt(
      `Analyze this page content for moral or ethical decisions the user might face. Be concise.\n\n${pageText}`
    ),
    120000,
    'Analysis timed out after 2 minutes. Try a shorter page or reload the extension.'
  );

  hideProgress();
  return analysis;
}

if (!('LanguageModel' in self)) {
  showResult(
    'Gemini Nano only works in Google Chrome (138+), not Opera GX. Switch to Chrome with the Prompt API flags enabled to use analysis.',
    true
  );
  analyzeBtn.disabled = true;
}

analyzeBtn.addEventListener('click', async () => {
  analyzeBtn.disabled = true;
  resultEl.classList.remove('visible', 'error');
  hideProgress();

  try {
    const analysis = await analyzeActiveTab(setStatus);
    setStatus('');
    showResult(analysis);
  } catch (err) {
    setStatus('');
    showResult(err.message, true);
  } finally {
    hideProgress();
    analyzeBtn.disabled = !('LanguageModel' in self);
  }
});
