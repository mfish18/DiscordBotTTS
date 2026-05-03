require('dotenv').config();
process.env.FFMPEG_PATH = require('ffmpeg-static');

const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
} = require('@discordjs/voice');
const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

const TOKEN = process.env.TOKEN;
const PORT  = process.env.PORT || 3001;

class PersistentTTS extends EventEmitter {
  constructor() {
    super();
    this.ready = false;
    this.ps = null;
    this.start();
  }

  start() {
    this.ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.ps.stdin.write(
      'Add-Type -AssemblyName System.Speech\n' +
      '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer\n' +
      'Write-Output "READY"\n'
    );

    this.ps.stdout.on('data', (data) => {
      const out = data.toString();
      if (out.includes('READY') && !this.ready) {
        this.ready = true;
        console.log('PowerShell TTS engine ready');
      }
      if (out.includes('DONE')) {
        this.emit('done');
      }
    });

    this.ps.stderr.on('data', (data) => {
      console.error('PS error:', data.toString());
    });

    this.ps.on('exit', () => {
      console.log('PowerShell exited, restarting...');
      this.ready = false;
      setTimeout(() => this.start(), 1000);
    });
  }

  browserRateToPS(rate) {
    return Math.round((rate - 1) * 10);
  }

  synthesize(text, outFile, { rate = 1, voice = '' } = {}) {
    return new Promise((resolve, reject) => {
      const psRate   = this.browserRateToPS(rate);
      const safeText = text.replace(/'/g, "''").replace(/"/g, '`"');
      const safeVoice = voice.replace(/'/g, "''");

      let cmd = `$synth.Rate = ${psRate}\n`;
      if (safeVoice) {
        cmd += `try { $synth.SelectVoice('${safeVoice}') } catch {}\n`;
      }
      cmd += `$synth.SetOutputToWaveFile('${outFile}')\n`;
      cmd += `$synth.Speak('${safeText}')\n`;
      cmd += `$synth.SetOutputToDefaultAudioDevice()\n`;
      cmd += `Write-Output "DONE"\n`;

      this.once('done', resolve);
      this.ps.stdin.write(cmd);
    });
  }
}

async function getPSVoices() {
  return new Promise((resolve) => {
    const ps = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Speech; ' +
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ' +
      '$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    let out = '';
    ps.stdout.on('data', d => out += d.toString());
    ps.on('close', () => {
      const voices = out.split('\n').map(v => v.trim()).filter(Boolean);
      resolve(voices);
    });
  });
}

const tts    = new PersistentTTS();
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

function speak(text, options = {}) {
  queue.push({ text, options });
  if (!isPlaying) processQueue();
}

async function processQueue() {
  if (!queue.length) { isPlaying = false; return; }
  isPlaying = true;

  const { text, options } = queue.shift();
  const tmpFile = path.join(os.tmpdir(), 'vb_' + Date.now() + '.wav');

  try {
    await tts.synthesize(text, tmpFile, options);
  } catch (err) {
    console.error('TTS error:', err);
    processQueue();
    return;
  }

  const connection = currentGuildId ? getVoiceConnection(currentGuildId) : null;
  if (!connection) {
    console.warn('Not in a VC — message dropped');
    fs.unlink(tmpFile, () => {});
    isPlaying = false;
    return;
  }

  const playAudio = (file) => {
    const resource = createAudioResource(file);
    player.play(resource);
    connection.subscribe(player);
    player.once(AudioPlayerStatus.Idle, () => {
      fs.unlink(file, () => {});
      processQueue();
    });
  };

  const playOrWait = (file) => {
    if (connection.state.status === 'ready') {
      playAudio(file);
    } else {
      connection.once('stateChange', (_old, newState) => {
        if (newState.status === 'ready') playAudio(file);
      });
    }
  };

  const pitch = options.pitch ?? 1;
  if (Math.abs(pitch - 1) > 0.01) {
    const shiftedFile = tmpFile.replace('.wav', '_p.wav');
    const ff = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-i', tmpFile,
      '-af', `asetrate=44100*${pitch},aresample=44100`,
      shiftedFile,
    ]);
    ff.on('close', () => {
      fs.unlink(tmpFile, () => {});
      playOrWait(shiftedFile);
    });
  } else {
    playOrWait(tmpFile);
  }
}

client.once('ready', () => {
  console.log('Bot online as ' + client.user.tag);
  console.log('HTTP server listening on http://localhost:' + PORT);
  console.log('Join a voice channel and type !join in any channel I can see');
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
  }

  if (message.content === '!leave') {
    const conn = currentGuildId ? getVoiceConnection(currentGuildId) : null;
    if (conn) { conn.destroy(); currentGuildId = null; }
  }
});


const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }


  if (req.method === 'GET' && req.url === '/voices') {
    getPSVoices().then(voices => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(voices));
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/speak') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { text, rate, pitch, voice } = JSON.parse(body);
        if (text && text.trim()) {
          speak(text.trim(), { rate, pitch, voice });
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