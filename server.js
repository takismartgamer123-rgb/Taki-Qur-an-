const express = require('express');
const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const app = express();
const PORT = process.env.PORT || 3000;
const STREAM_KEY = process.env.STREAM_KEY;
const OVERLAY_URL = 'https://dz-netflix.onrender.com'; // رابطك راهو صحيح

// الروابط تاع القرآن - الأساسي + احتياطي
const QURAN_URL_1 = 'https://stream.radiojar.com/8s5u5tpdtwzuv'; // إذاعة القرآن السعودية
const QURAN_URL_2 = 'https://backup.qurango.net/radio/maher_almuaiqly'; // ماهر المعيقلي

const SOURCE_WIDTH = 1920;
const SOURCE_HEIGHT = 1080;
const OUTPUT_WIDTH = 1280;
const OUTPUT_HEIGHT = 720;

let ffmpegProcess = null;
let browserInstance = null;
let restartCount = 0;
let isStreaming = false;
let startTime = Date.now();

function killProcesses() {
  if (ffmpegProcess) {
    ffmpegProcess.kill('SIGKILL');
    ffmpegProcess = null;
  }
}

async function startStream() {
  if (isStreaming) return;
  if (!STREAM_KEY) {
    console.log('[TAKI24] خطأ: STREAM_KEY ناقص في Environment');
    return;
  }
  isStreaming = true;
  restartCount++;
  console.log(`[TAKI24] تشغيل بالقرآن #${restartCount} - ${new Date().toLocaleString('ar-DZ')}`);

  try {
    killProcesses();
    if (browserInstance) await browserInstance.close();

    // 🔥 التعديل المهم: كروم المستقر تاع Render
    browserInstance = await puppeteer.launch({
      headless: 'new',
      executablePath: '/usr/bin/google-chrome-stable', // نثبتوه على كروم المستقر
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process',
        '--disable-gpu',
        `--window-size=${SOURCE_WIDTH},${SOURCE_HEIGHT}`,
        '--start-fullscreen',
        '--kiosk',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-background-networking',
        '--js-flags=--max-old-space-size=256',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images' // نقصو الرام أكثر
      ]
    });

    const page = await browserInstance.newPage();
    await page.setViewport({ width: SOURCE_WIDTH, height: SOURCE_HEIGHT });
    await page.goto(OVERLAY_URL, { waitUntil: 'domcontentloaded', timeout: 90000 }); // بدلناها لـ domcontentloaded أخف
    await new Promise(r => setTimeout(r, 8000)); // نزيدو الوقت باه يتشارجا موقعك كامل

    console.log('[TAKI24] نشعل FFmpeg مع القرآن...');
    ffmpegProcess = spawn('ffmpeg', [
      '-f', 'image2pipe', '-framerate', '30', '-i', 'pipe:0',
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', QURAN_URL_1,
      '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5', '-i', QURAN_URL_2,
      '-filter_complex', '[1:a][2:a]amix=inputs=2:duration=first:dropout_transition=3,volume=0.85',
      '-vf', `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:flags=fast_bilinear`, // أخف من lanczos
      '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-b:v', '3000k', '-maxrate', '3000k', '-bufsize', '6000k', // نقصنا البتريت شوية للأمان
      '-pix_fmt', 'yuv420p', '-g', '60', '-keyint_min', '60',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100',
      '-f', 'flv', `rtmp://a.rtmp.youtube.com/live2/${STREAM_KEY}`
    ]);

    ffmpegProcess.stderr.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('error') || msg.includes('Error')) console.log(`FFmpeg Error: ${msg}`);
    });

    ffmpegProcess.on('close', (code) => {
      console.log(`[TAKI24] FFmpeg طاح ${code}. إعادة تشغيل...`);
      isStreaming = false;
      setTimeout(startStream, 5000);
    });

    const captureLoop = setInterval(async () => {
      try {
        if (!isStreaming || page.isClosed()) return clearInterval(captureLoop);
        const screenshot = await page.screenshot({ type: 'jpeg', quality: 70 }); // نقصنا الجودة لـ 70 للأمان
        if (ffmpegProcess &&!ffmpegProcess.stdin.destroyed) {
          ffmpegProcess.stdin.write(screenshot);
        }
      } catch (e) {
        clearInterval(captureLoop);
        isStreaming = false;
        setTimeout(startStream, 3000);
      }
    }, 1000 / 30);

    console.log('[TAKI24] بث القرآن 720p شغال - ~370MB RAM 👑');

  } catch (err) {
    console.log(`[TAKI24] كراش: ${err.message}`);
    isStreaming = false;
    setTimeout(startStream, 10000);
  }
}

app.get('/health', (req, res) => {
  const uptime = Math.floor((Date.now() - startTime) / 1000);
  res.status(200).json({
    status: isStreaming? 'live' : 'starting',
    audio: 'Quran 24/7',
    output: '1280x720',
    ram: '~370MB',
    restarts: restartCount,
    uptime: `${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`
  });
});

app.get('/', (req, res) => res.send('<h1>ɪʈʂ ʈɑkɪ!! 🇩🇿²⁴ Quran Live</h1>'));

app.listen(PORT, () => {
  console.log(`[TAKI24] طالع على ${PORT}`);
  startTime = Date.now();
  startStream();
});

process.on('SIGTERM', async () => {
  isStreaming = false;
  killProcesses();
  if (browserInstance) await browserInstance.close();
  process.exit(0);
});