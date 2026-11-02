// Run with the packaged Electron's embedded Node, in a disposable container only.
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path')
const { spawn, execFile } = require('node:child_process'), { promisify } = require('node:util')
const exec = promisify(execFile), delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function main() {
  await fs.access('/.dockerenv') // Never weaken sandboxing for a normal desktop session.
  const executable = process.argv[2] || '/opt/cloud-music-player/cloud-music-player'
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'libitum-compat-'))
  let child, socket
  try {
    const reservation = require('node:net').createServer()
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
    const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve))
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
    child = spawn(executable, ['--no-sandbox', '--disable-gpu', '--ozone-platform=headless', '--password-store=basic', `--remote-debugging-port=${port}`, `--user-data-dir=${directory}`], { env, stdio: 'ignore' })
    let page
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`Application exited: ${child.exitCode}`)
      try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.type === 'page'); if (page) break } catch {}
      await delay(200)
    }
    if (!page) throw new Error('Application debugging endpoint did not start')
    socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
    let serial = 0
    async function evaluate(expression) {
      const id = ++serial
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error('Renderer request timed out')) }, 20000)
        function receive(event) {
          const data = JSON.parse(event.data); if (data.id !== id) return
          clearTimeout(timer); socket.removeEventListener('message', receive)
          if (data.error || data.result?.exceptionDetails) reject(new Error('Renderer evaluation failed'))
          else resolve(data.result.result.value)
        }
        socket.addEventListener('message', receive)
        socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
      })
    }
    let bootstrap
    for (let i = 0; i < 80; i++) {
      bootstrap = await evaluate(`window.music ? window.music.invoke('app.bootstrap') : null`)
      if (bootstrap?.ok && bootstrap.data.player.available) break
      await delay(200)
    }
    if (!bootstrap?.ok || !bootstrap.data.player.available || bootstrap.data.sessions.netease.user !== null) throw new Error('Clean packaged startup or mpv initialization failed')
    const appearance = await evaluate(`window.music.invoke('settings.update',{theme:'dark',panelBlur:8})`)
    if (!appearance?.ok) throw new Error('Settings IPC failed')
    const wav = path.join(directory, 'tone.wav'), video = path.join(directory, 'background.mp4')
    await exec('ffmpeg', ['-v','error','-f','lavfi','-i','sine=frequency=1000:duration=0.3','-y',wav])
    await exec('mpv', ['--no-config','--ao=null','--vo=null','--af=lavfi=[volume=-3dB,equalizer=f=1000:t=q:w=1:g=3,bass=f=100:t=q:w=1:g=2,treble=f=8000:t=q:w=1:g=-2]',wav], { timeout: 15000 })
    await exec('ffmpeg', ['-v','error','-f','lavfi','-i','color=c=blue:s=128x128:d=0.2','-an','-vf',"scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",'-r','30','-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-movflags','+faststart','-y',video])
    const pactl = (await exec('pactl', ['--help'])).stdout
    if (!pactl.includes('json')) throw new Error('pactl JSON output is not supported')
    await exec('parec', ['--version']); await exec('fc-list', ['--format=%{family}\n'])
    const release = await fs.readFile('/etc/os-release','utf8')
    console.log(JSON.stringify({ system: release.match(/^PRETTY_NAME="?(.*?)"?$/m)?.[1], version: bootstrap.data.version, cleanProfile: true, startup: 'passed', mpv: (await exec('mpv',['--version'])).stdout.split('\n')[0], peq: 'passed', videoH264: 'passed', pulseTools: 'passed', fonts: 'passed', boundary: 'headless; no hardware, keyring or desktop compositor verification' }))
    await evaluate(`setTimeout(()=>window.music.invoke('app.quit'),50);true`).catch(() => {})
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(3000)])
  } finally {
    socket?.close()
    if (child && child.exitCode === null) { child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(1000)]) }
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
