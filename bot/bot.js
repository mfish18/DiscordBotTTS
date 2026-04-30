require('dotenv').config();
process.env.FFMPEG_PATH = require('ffmpeg-static');
const ffmpeg = require('ffmpeg-static');
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} = require('@discordjs/voice');
const http = require('http');
const { exec } = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const TOKEN = process.env.TOKEN;
const PORT  = process.env.PORT || 3001;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

let currentGuildId = null;
const player = createAudioPlayer();
const queue  = [];
let isPlaying = false;


function speak(text) {
  queue.push(text);
  if (!isPlaying) processQueue();
}

function processQueue() {
  
  if (!queue.length) { isPlaying = false; return; }
  isPlaying = true;
  const text    = queue.shift();
  const tmpFile = path.join(os.tmpdir(), `vb_${Date.now()}.wav`);

  // Windows PowerShell built-in TTS — no extra install needed
  const safe = text.replace(/'/g, "''");
  const cmd  = `powershell -Command "Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${tmpFile}'); $s.Speak('${safe}'); $s.Dispose()"`;

  exec(cmd, (err) => {
  const connection = currentGuildId ? getVoiceConnection(currentGuildId) : null;
  if (!connection) { console.warn('Not in a VC — message dropped'); isPlaying = false; return; }

  const playAudio = () => {
      const resource = createAudioResource(tmpFile);
      player.play(resource);
      connection.subscribe(player);
      player.once(AudioPlayerStatus.Idle, () => {
        fs.unlink(tmpFile, () => {});
        processQueue();
      });
    };

    if (connection.state.status === 'ready') {
      playAudio();
    } else {
      connection.once('stateChange', (_old, newState) => {
        if (newState.status === 'ready') playAudio();
      });
    }
  });
}

// ── Discord events ───────────────────────────────────────
client.once('ready', () => {
  console.log(`✓ Bot online as ${client.user.tag}`);
  console.log(`✓ HTTP server listening on http://localhost:${PORT}`);
  console.log(`  Join a voice channel and type !join in any channel I can see`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.content === '!join') {
    const vc = message.member?.voice?.channel;
    if (!vc) { message.reply('Join a voice channel first!'); return; }
    currentGuildId = message.guild.id;
    joinVoiceChannel({
      channelId:      vc.id,
      guildId:        vc.guild.id,
      adapterCreator: vc.guild.voiceAdapterCreator,
      selfDeaf:       false,
    });
    message.reply(`Joined **${vc.name}** — ready. You can close this chat now.`);
  }

  if (message.content === '!leave') {
    const conn = currentGuildId ? getVoiceConnection(currentGuildId) : null;
    if (conn) { conn.destroy(); currentGuildId = null; }
    message.reply('Left.');
  }
});

// ── Local HTTP server ────────────────────────────────────
// The browser app POSTs { text: "hello" } to http://localhost:3001/speak
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/speak') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text } = JSON.parse(body);
        if (text && text.trim()) {
          speak(text.trim());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(400); res.end(JSON.stringify({ error: 'No text provided' }));
        }
      } catch {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT);
client.login(TOKEN);