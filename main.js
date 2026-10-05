// ── Constants ──────────────────────────────────────────────────────────────
const SR      = 16_000 // 16 kHz — speech quality, ~58 MB/hour
const CHUNK   = 4_096  // ScriptProcessor buffer size
const API_URL = 'https://api.assemblyai.com'

const SPEAKER_COLORS = {
  A: '#3b82f6', B: '#ef4444', C: '#22c55e', D: '#f59e0b',
  E: '#a855f7', F: '#06b6d4', G: '#f43f5e', H: '#84cc16',
}

// ── State ──────────────────────────────────────────────────────────────────
let micStream = null, sysStream = null
let audioCtx  = null, scriptNode = null, analyser = null
let micSrc    = null, sysSrc    = null
let chunks    = [], totalSamples = 0
let isRec     = false
let startTime = null, timerInt = null, rafId = null
let wavBuf    = null
let utterances = []
let pollTimer  = null

// ── DOM refs ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id)

const micDot  = $('micDot')
const micTxt  = $('micTxt')
const micBtn  = $('micBtn')
const sysDot  = $('sysDot')
const sysTxt  = $('sysTxt')
const sysBtn  = $('sysBtn')
const recBtn  = $('recBtn')
const recLbl  = $('recLbl')
const timerEl = $('timer')
const canvas  = $('waveCanvas')
const c2d     = canvas.getContext('2d')

// ── API key — persisted in localStorage ───────────────────────────────────
const keyInput = $('keyInput')
keyInput.value = localStorage.getItem('aai_key') || ''
keyInput.addEventListener('input', () => localStorage.setItem('aai_key', keyInput.value.trim()))

$('keyToggle').addEventListener('click', () => {
  const el = keyInput
  const isHidden = el.type === 'password'
  el.type = isHidden ? 'text' : 'password'
  $('keyToggle').textContent = isHidden ? 'hide' : 'show'
})

const apiKey = () => keyInput.value.trim()

// ── Connect microphone ─────────────────────────────────────────────────────
micBtn.addEventListener('click', async () => {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    const label = micStream.getAudioTracks()[0]?.label || 'microphone'
    micDot.className   = 'dot on'
    micTxt.textContent = label.length > 32 ? label.slice(0, 32) + '\u2026' : label
    micBtn.textContent = 'connected'
    micBtn.disabled    = true
    checkReady()
  } catch {
    micDot.className   = 'dot err'
    micTxt.textContent = 'access denied'
  }
})

// ── Connect PC audio ───────────────────────────────────────────────────────
sysBtn.addEventListener('click', async () => {
  try {
    try {
      sysStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })
    } catch {
      sysStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true, video: { width: 1, height: 1, frameRate: 1 },
      })
      sysStream.getVideoTracks().forEach(t => t.stop())
    }

    const audioTracks = sysStream.getAudioTracks()
    if (!audioTracks.length) {
      sysStream.getTracks().forEach(t => t.stop())
      sysStream = null
      sysDot.className   = 'dot err'
      sysTxt.textContent = 'no audio \u2014 check \u201cShare system audio\u201d'
      return
    }

    audioTracks[0].addEventListener('ended', () => {
      sysStream = null
      sysDot.className   = 'dot'
      sysTxt.textContent = 'disconnected'
      sysBtn.textContent = 'connect'
      sysBtn.disabled    = false
      checkReady()
    })

    sysDot.className   = 'dot on'
    sysTxt.textContent = 'system audio'
    sysBtn.textContent = 'connected'
    sysBtn.disabled    = true
    checkReady()

  } catch (e) {
    if (e.name !== 'NotAllowedError') {
      sysDot.className   = 'dot err'
      sysTxt.textContent = 'could not connect'
    }
  }
})

// ── Ready check ────────────────────────────────────────────────────────────
function checkReady() {
  recBtn.disabled = !(micStream || sysStream)
}

// ── Record button ──────────────────────────────────────────────────────────
recBtn.addEventListener('click', () => isRec ? stopRec() : startRec())

// ── Start recording ────────────────────────────────────────────────────────
function startRec() {
  wavBuf = null; chunks = []; totalSamples = 0; utterances = []; isRec = true

  recBtn.classList.add('recording')
  recLbl.hidden = true   // timer takes over as status
  show('recUI')
  hide('dlCard'); hide('txCard'); hide('newWrap')
  timerEl.textContent = '00:00:00'

  // Build audio graph
  audioCtx   = new AudioContext({ sampleRate: SR })
  audioCtx.resume()
  analyser   = audioCtx.createAnalyser()
  analyser.fftSize = 512
  scriptNode = audioCtx.createScriptProcessor(CHUNK, 1, 1)

  if (micStream) {
    micSrc = audioCtx.createMediaStreamSource(micStream)
    micSrc.connect(analyser)
    micSrc.connect(scriptNode)
  }
  if (sysStream) {
    sysSrc = audioCtx.createMediaStreamSource(sysStream)
    sysSrc.connect(analyser)
    sysSrc.connect(scriptNode)
  }

  // Muted gain node — keeps ScriptProcessor alive without echo through headphones
  const silencer = audioCtx.createGain()
  silencer.gain.value = 0
  scriptNode.connect(silencer)
  silencer.connect(audioCtx.destination)

  scriptNode.onaudioprocess = e => {
    if (!isRec) return
    const raw  = e.inputBuffer.getChannelData(0)
    const copy = new Float32Array(raw.length)
    for (let i = 0; i < raw.length; i++) copy[i] = Math.max(-1, Math.min(1, raw[i]))
    chunks.push(copy)
    totalSamples += copy.length
  }

  startTime = Date.now()
  timerInt  = setInterval(tick, 500)
  drawWave()
}

// ── Stop recording ─────────────────────────────────────────────────────────
function stopRec() {
  isRec = false
  clearInterval(timerInt)
  cancelAnimationFrame(rafId)

  if (micSrc) { micSrc.disconnect(); micSrc = null }
  if (sysSrc) { sysSrc.disconnect(); sysSrc = null }
  scriptNode.disconnect()
  audioCtx.close()
  audioCtx = null; scriptNode = null; analyser = null

  // Encode WAV
  wavBuf = encodeWAV()
  const dur  = Math.floor(totalSamples / SR)
  const mb   = (wavBuf.byteLength / 1e6).toFixed(1)
  const date = new Date().toISOString().slice(0, 10)

  recBtn.classList.remove('recording')
  recLbl.hidden       = false
  recLbl.textContent  = 'click to record'
  hide('recUI')
  show('dlCard'); show('newWrap')
  $('dlName').textContent = `meeting-${date}.wav`
  $('dlMeta').textContent = `${fmtSec(dur)} \u00b7 ${mb}\u00a0MB \u00b7 16\u00a0kHz mono`

  // Auto-start transcription if key is set
  if (apiKey()) {
    show('txCard')
    show('txProgress'); hide('txContent')
    setTxStatus('Uploading audio\u2026')
    startTranscription()
  }
}

// ── Timer ──────────────────────────────────────────────────────────────────
function tick() {
  timerEl.textContent = fmtSec(Math.floor((Date.now() - startTime) / 1000))
}

function fmtSec(s) {
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60]
    .map(v => String(v).padStart(2, '0')).join(':')
}

// ── Waveform ───────────────────────────────────────────────────────────────
function drawWave() {
  if (!isRec || !analyser) return
  const W = canvas.clientWidth || 460
  if (canvas.width !== W) canvas.width = W
  const H = canvas.height
  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteTimeDomainData(data)
  c2d.clearRect(0, 0, W, H)
  c2d.strokeStyle = '#e5293e'
  c2d.lineWidth   = 1.5
  c2d.beginPath()
  const step = W / data.length
  for (let i = 0; i < data.length; i++) {
    const y = (data[i] / 128 - 1) * (H / 2.4) + H / 2
    i === 0 ? c2d.moveTo(0, y) : c2d.lineTo(i * step, y)
  }
  c2d.stroke()
  rafId = requestAnimationFrame(drawWave)
}

// ── WAV encoding ───────────────────────────────────────────────────────────
function encodeWAV() {
  const buf  = new ArrayBuffer(44 + totalSamples * 2)
  const view = new DataView(buf)
  const ws   = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)) }

  ws(0, 'RIFF'); view.setUint32(4, 36 + totalSamples * 2, true)
  ws(8, 'WAVE'); ws(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1,  true)
  view.setUint16(22, 1,  true)
  view.setUint32(24, SR, true)
  view.setUint32(28, SR * 2, true)
  view.setUint16(32, 2,  true)
  view.setUint16(34, 16, true)
  ws(36, 'data'); view.setUint32(40, totalSamples * 2, true)

  let off = 44
  for (const ch of chunks) {
    for (let i = 0; i < ch.length; i++) {
      view.setInt16(off, ch[i] < 0 ? ch[i] * 0x8000 : ch[i] * 0x7FFF, true)
      off += 2
    }
  }
  return buf
}

// ── WAV download ───────────────────────────────────────────────────────────
$('dlBtn').addEventListener('click', async () => {
  if (!wavBuf) return
  const filename = $('dlName').textContent
  const blob     = new Blob([wavBuf], { type: 'audio/wav' })

  if ('showSaveFilePicker' in window) {
    try {
      const handle   = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'WAV Audio', accept: { 'audio/wav': ['.wav'] } }] })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return
    } catch (e) { if (e.name === 'AbortError') return }
  }

  const url = URL.createObjectURL(blob)
  const a   = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.style.display = 'none'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
})

// ── AssemblyAI API helpers ─────────────────────────────────────────────────
async function aaiPost(path, body, isBlob = false) {
  const headers = { Authorization: apiKey() }
  if (!isBlob) headers['Content-Type'] = 'application/json'
  const res = await fetch(API_URL + path, {
    method: 'POST', headers,
    body: isBlob ? body : JSON.stringify(body),
  })
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || `HTTP ${res.status}`) }
  return res.json()
}

async function aaiGet(path) {
  const res = await fetch(API_URL + path, { headers: { Authorization: apiKey() } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Transcription flow ─────────────────────────────────────────────────────
async function startTranscription() {
  try {
    setTxStatus('Uploading audio\u2026')
    const blob = new Blob([wavBuf], { type: 'audio/wav' })
    const { upload_url } = await aaiPost('/v2/upload', blob, true)

    setTxStatus('Queuing transcription\u2026')
    const { id } = await aaiPost('/v2/transcript', { audio_url: upload_url, speaker_labels: true })

    setTxStatus('Transcribing\u2026 (1\u20133 min depending on length)')
    pollTimer = setInterval(async () => {
      try {
        const data = await aaiGet(`/v2/transcript/${id}`)
        if (data.status === 'completed') { clearInterval(pollTimer); renderTranscript(data) }
        else if (data.status === 'error') { clearInterval(pollTimer); setTxStatus('Error: ' + data.error, 'err') }
      } catch (e) { clearInterval(pollTimer); setTxStatus(e.message, 'err') }
    }, 3_000)
  } catch (e) {
    setTxStatus(e.message, 'err')
  }
}

function setTxStatus(msg, cls = '') {
  const el = $('txStatusTxt')
  el.textContent = msg
  el.className   = 'tx-status-txt ' + cls
  $('txSpinner').style.display = cls ? 'none' : 'block'
}

// ── Render transcript ──────────────────────────────────────────────────────
function colorOf(s) { return SPEAKER_COLORS[s] || '#9ca3af' }

function fmtMs(ms) {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function renderTranscript(data) {
  utterances = data.utterances || []
  const spks = [...new Set(utterances.map(u => u.speaker))].length
  const dur  = utterances.length ? fmtMs(utterances[utterances.length - 1].end) : '?'
  $('txMeta').textContent = `${utterances.length} segments \u00b7 ${spks} speaker${spks !== 1 ? 's' : ''} \u00b7 ${dur}`

  const scroll = $('txScroll')
  scroll.innerHTML = ''
  for (const u of utterances) {
    const c   = colorOf(u.speaker)
    const row = document.createElement('div'); row.className = 'tx-line'
    const b   = document.createElement('span'); b.className = 'spk-badge'
    b.style.cssText = `background:${c}18;color:${c};border-color:${c}44`
    b.textContent   = `Spk ${u.speaker}`
    const t   = document.createElement('span'); t.className = 'tx-time'; t.textContent = fmtMs(u.start)
    const tx  = document.createElement('span'); tx.className = 'tx-text'; tx.textContent = u.text
    row.append(b, t, tx)
    scroll.appendChild(row)
  }

  hide('txProgress'); show('txContent')
}

// ── Export transcript ──────────────────────────────────────────────────────
function toText() {
  const spks = [...new Set(utterances.map(u => u.speaker))].join(', ')
  const dur  = utterances.length ? fmtMs(utterances[utterances.length - 1].end) : '?'
  return [
    'MEETING TRANSCRIPT',
    `Date:     ${new Date().toISOString().slice(0, 10)}`,
    `File:     ${$('dlName').textContent}`,
    `Duration: ${dur}`,
    `Speakers: ${spks}`,
    '',
    ...utterances.map(u => `[${fmtMs(u.start)}] Speaker ${u.speaker}: ${u.text}`),
  ].join('\n')
}

$('copyBtn').addEventListener('click', () => {
  navigator.clipboard.writeText(toText()).then(() => {
    $('copyBtn').textContent = 'copied!'
    setTimeout(() => { $('copyBtn').textContent = 'copy for claude' }, 2_000)
  })
})

$('saveTxtBtn').addEventListener('click', () => {
  const a = Object.assign(document.createElement('a'), {
    href:     URL.createObjectURL(new Blob([toText()], { type: 'text/plain' })),
    download: $('dlName').textContent.replace('.wav', '.txt'),
  })
  a.style.display = 'none'
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
})

// ── New recording ──────────────────────────────────────────────────────────
$('newBtn').addEventListener('click', () => {
  if (pollTimer) clearInterval(pollTimer)
  wavBuf = null; chunks = []; totalSamples = 0; utterances = []
  hide('dlCard'); hide('txCard'); hide('newWrap'); hide('recUI')
  recLbl.hidden = false
  recLbl.textContent = 'click to record'
  timerEl.textContent = '00:00:00'
  checkReady()
})

// ── Utility ────────────────────────────────────────────────────────────────
function show(id) { $(id).hidden = false }
function hide(id) { $(id).hidden = true  }
