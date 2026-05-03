const voiceSelect = document.getElementById('voiceSelect');
const rateSlider  = document.getElementById('rate');
const pitchSlider = document.getElementById('pitch');
const rateVal     = document.getElementById('rate-val');
const pitchVal    = document.getElementById('pitch-val');
const msgBox      = document.getElementById('msg');
const dot         = document.getElementById('dot');
const statusText  = document.getElementById('status-text');

function setStatus(state, msg) {
  dot.className = 'dot' + (state ? ' ' + state : '');
  statusText.textContent = msg;
}

let availableVoices = [];

async function loadVoices() {
  const port = document.getElementById('botPort').value || 3001;
  try {
    const res = await fetch(`http://localhost:${port}/voices`);
    if (!res.ok) throw new Error();
    availableVoices = await res.json(); 

    voiceSelect.innerHTML = '';
    availableVoices.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      voiceSelect.appendChild(opt);
    });

    const en = availableVoices.find(v => /english/i.test(v));
    if (en) voiceSelect.value = en;

    setStatus('active', 'Ready');
  } catch {
    setStatus('error', 'Could not load voices — is the bot running?');
  }
}

rateSlider.addEventListener('input',  () => rateVal.textContent  = parseFloat(rateSlider.value).toFixed(2) + '×');
pitchSlider.addEventListener('input', () => pitchVal.textContent = parseFloat(pitchSlider.value).toFixed(2));

function speak() {
  const text = msgBox.value.trim();
  if (!text) return;
  sendToBot(text);
}

function stopSpeaking() {
  setStatus('active', 'Stopped');
}

async function sendToBot(text) {
  const port = document.getElementById('botPort').value || 3001;
  setStatus('speaking', 'Sending...');
  try {
    const res = await fetch(`http://localhost:${port}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        rate:  parseFloat(rateSlider.value),
        pitch: parseFloat(pitchSlider.value),
        voice: voiceSelect.value,
      }),
    });
    if (res.ok) setStatus('active', 'Sent to Discord');
    else        setStatus('error', 'Bot error: ' + res.status);
  } catch {
    setStatus('error', 'Bot not reachable — is it running?');
  }
}

function toggleWebhook() {
  const section = document.getElementById('webhookSection');
  section.classList.toggle('open');
  if (section.classList.contains('open')) loadVoices(); 
}

msgBox.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    speak();
  }
});

document.getElementById('botPort').addEventListener('change', loadVoices);
loadVoices();