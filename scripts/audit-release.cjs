// A release gate, not a credential scanner output: never print matched values.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process')
const root=path.resolve(__dirname,'..')
const allowed=new Set(['.gitignore','LICENSE','README.md','CHANGELOG.md','VALIDATION.md','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','tsconfig.json','electron.vite.config.ts','playwright.config.ts','docs/user-guide.md','docs/development.md','docs/screenshots.md','docs/images/home.png','docs/images/listening.png','docs/images/equalizer.png','docs/images/mini-player.png'])
for(const name of ['platform-accounts.png','search-netease.png','search-qq.png'])allowed.add(`docs/images/${name}`)
const files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))]
const privatePath=new RegExp('/'+'home/'+'[^/\\s"\']+|/'+'Users/'+'[^/\\s"\']+')
const patterns=[/qqmusic_session\s*=\s*[A-Za-z0-9_.:-]{40,}/,/MUSIC_[UA]\s*=\s*[A-Za-z0-9%+/=_-]{40,}/,/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,privatePath]
const findings=[]
for(const name of files){
  const known=allowed.has(name)||/^vitest(?:\.[a-z]+)?\.config\.ts$/.test(name)||/^(?:src|tests)\/.*\.(?:ts|tsx|css|html)$/.test(name)||/^scripts\/.*\.(?:cjs|py)$/.test(name)||['resources/icon.png'].includes(name)
  if(!known){findings.push({file:name,reason:'outside publication allowlist'});continue}
  const file=path.join(root,name)
  if(!fs.existsSync(file))continue
  if(fs.lstatSync(file).isSymbolicLink()){findings.push({file:name,reason:'symbolic link'});continue}
  if(name.endsWith('.png'))continue
  if(patterns.some(pattern=>pattern.test(fs.readFileSync(file,'utf8'))))findings.push({file:name,reason:'possible credential or private path'})
}
let archiveChecked=false
if(process.argv.includes('--packaged')){
  const asar=require('@electron/asar'),archive=path.join(root,'release/linux-unpacked/resources/app.asar')
  for(const name of asar.listPackage(archive)){
    const normalized=name.replaceAll('\\','/').replace(/^\//,'')
    if(!normalized.includes('/')&&!['out','resources','node_modules','package.json','LICENSE','THIRD_PARTY_NOTICES.md'].includes(normalized))findings.push({file:normalized,reason:'unexpected packaged root'})
    if(/^(?:out|resources)\//.test(normalized)&&/(?:^|\/)(?:session\.json|client\.json|downloads\.json|queue\.json|Cookies|History|media|user-data)(?:\/|$)/i.test(normalized))findings.push({file:normalized,reason:'private runtime data in package'})
    if (/^out\/.*\.(?:js|css|html)$/.test(normalized) || normalized==='package.json') {
      if(patterns.some(pattern=>pattern.test(asar.extractFile(archive,normalized).toString('utf8'))))findings.push({file:normalized,reason:'possible credential or private path in application bundle'})
    }
  }
  archiveChecked=true
}
console.log(JSON.stringify({sourceFiles:files.length,archiveChecked,findings},null,2))
if(findings.length)process.exitCode=1
