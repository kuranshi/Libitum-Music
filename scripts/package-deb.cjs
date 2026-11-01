// Build Debian metadata locally; no invented project homepage or FPM download.
const fs = require('node:fs/promises')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const manifest = require('../package.json')
async function main() {
  const root = path.resolve(__dirname, '..'), output = path.join(root, 'release')
  const stage = path.join(output, 'deb-staging'), source = path.join(output, 'linux-unpacked')
  await fs.access(path.join(source, 'cloud-music-player'))
  await fs.rm(stage, { recursive: true, force: true })
  const install = path.join(stage, 'opt/cloud-music-player')
  await fs.mkdir(path.join(stage, 'DEBIAN'), { recursive: true })
  await fs.cp(source, install, { recursive: true, preserveTimestamps: true })
  await fs.chmod(path.join(install, 'chrome-sandbox'), 0o4755)
  const size = Number(execFileSync('du', ['-sk', install], { encoding: 'utf8' }).split(/\s/)[0])
  const dependencyFields = ['depends','recommends'].map(field => `${field[0].toUpperCase()+field.slice(1)}: ${manifest.build.deb[field].join(', ')}`).join('\n')
  // Debian's tilde sorts prereleases before the eventual stable version.
  const debVersion = manifest.version.replace('-', '~')
  const control = `Package: cloud-music-player\nVersion: ${debVersion}\nSection: sound\nPriority: optional\nArchitecture: amd64\nMaintainer: Libitum music contributors\nInstalled-Size: ${size}\n${dependencyFields}\nDescription: Libitum music - NetEase Cloud Music and QQ Music desktop client\n A Chinese-language Linux music player with account login, recommendations,\n collections, native mpv playback, audio output selection and downloads.\n`
  await fs.writeFile(path.join(stage, 'DEBIAN/control'), control)
  await fs.mkdir(path.join(stage, 'usr/share/applications'), { recursive: true })
  await fs.writeFile(path.join(stage, 'usr/share/applications/cloud-music-player.desktop'), '[Desktop Entry]\nType=Application\nName=Libitum music\nName[en]=Libitum music\nComment=网易云音乐与 QQ 音乐桌面客户端\nExec=/opt/cloud-music-player/cloud-music-player %U\nIcon=cloud-music-player\nTerminal=false\nCategories=AudioVideo;Audio;Player;\nStartupWMClass=cloud-music-player\nKeywords=Music;NetEase;QQ;Audio;\n')
  await fs.mkdir(path.join(stage, 'usr/share/icons/hicolor/512x512/apps'), { recursive: true })
  await fs.copyFile(path.join(root, 'resources/icon.png'), path.join(stage, 'usr/share/icons/hicolor/512x512/apps/cloud-music-player.png'))
  const docs = path.join(stage, 'usr/share/doc/cloud-music-player')
  for (const file of ['README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'VALIDATION.md',
    'docs/user-guide.md', 'docs/development.md', 'docs/screenshots.md',
    'docs/images/home.png', 'docs/images/listening.png', 'docs/images/equalizer.png', 'docs/images/mini-player.png',
    'resources/icon.png']) {
    const target = path.join(docs, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.copyFile(path.join(root, file), target)
  }
  await fs.mkdir(path.join(stage, 'usr/bin'), { recursive: true })
  await fs.symlink('/opt/cloud-music-player/cloud-music-player', path.join(stage, 'usr/bin/cloud-music-player'))
  const target = path.join(output, `libitum-music-${manifest.version}-amd64.deb`)
  execFileSync('dpkg-deb', ['--root-owner-group', '--build', stage, target], { stdio: 'inherit' })
  await fs.rm(stage, { recursive: true, force: true })
  console.log(`Debian package: ${target}`)
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
