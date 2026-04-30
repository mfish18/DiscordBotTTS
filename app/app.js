const voiceSelect = document.getElementById('voiceSelect');
const rateSlider  = document.getElementById('rate');
const pitchSlider = document.getElementById('pitch');
const rateVal     = document.getElementById('rate-val');
const pitchVal    = document.getElementById('pitch-val');
const msgBox      = document.getElementById('msg');
const dot         = document.getElementById('dot');
const statusText  = document.getElementById('status-text');

let voices = [];

function setStatus(state, msg) {
  dot.className = 'dot' + (state ? ' ' + state : '');
  statusText.textContent = msg;
}

function loadVoices() {
  voices = speechSynthesis.getVoices();
  if (!voices.length) return;

  voiceSelect.innerHTML = '';
  voices.forEach((v, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${v.name} (${v.lang})`;
    voiceSelect.appendChild(opt);
  });

  // Default to first English voice
  const en = voices.findIndex(v => v.lang.startsWith('en'));
  if (en >= 0) voiceSelect.value = en;
}

speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

rateSlider.addEventListener('input',  () => rateVal.textContent  = parseFloat(rateSlider.value).toFixed(2) + '×');
pitchSlider.addEventListener('input', () => pitchVal.textContent = parseFloat(pitchSlider.value).toFixed(2));

function speak() {
  const text = msgBox.value.trim();
  
  if (!text) return;

  speechSynthesis.cancel();

  const utt   = new SpeechSynthesisUtterance(text);
  utt.voice   = voices[voiceSelect.value];
  utt.rate    = parseFloat(rateSlider.value);
  utt.pitch   = parseFloat(pitchSlider.value);
  utt.onstart = () => setStatus('speaking', 'Speaking...');
  utt.onend   = () => setStatus('active', 'Done');
  utt.onerror = (e) => setStatus('error', 'Speech error: ' + e.error);

  speechSynthesis.speak(utt);

  sendToBot(text);
}

function stopSpeaking() {
  speechSynthesis.cancel();
  setStatus('active', 'Stopped');
}

async function sendToBot(text) {
  const port = document.getElementById('botPort').value || 3001;
  try {
    const res = await fetch(`http://localhost:${port}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (res.ok) setStatus('active', 'Sent to Discord');
    else        setStatus('error', 'Bot error: ' + res.status);
  } catch (e) {
    setStatus('error', 'Bot not reachable — is it running?');
  }
}

function toggleWebhook() {
  document.getElementById('webhookSection').classList.toggle('open');
}

msgBox.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    speak();
  }
});