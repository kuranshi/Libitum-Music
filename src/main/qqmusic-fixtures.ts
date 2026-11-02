import type { QqMusicRequest, QqMusicTransport } from './qqmusic-runtime'

/** Explicit unpackaged E2E data only; no upstream connections or real account writes. */
export function createQqMusicFixture(audioUrl = '', qrScenario = ''): QqMusicTransport {
  const names = ['QQ晚风经过', 'QQ海岸线', 'QQ日落之前', 'QQ慢慢走', 'QQ远方来信', 'QQ城市的光']
  const songs = names.map((title, index) => ({ id: 1001 + index, mid: `QqSong${1001 + index}`, title, interval: 90, singer: [{ id: 301, mid: 'QqArtist301', name: 'QQ测试歌手' }], album: { id: 201, mid: 'QqAlbum201', name: 'QQ一起听见' }, file: { media_mid: `QqMedia${1001 + index}`, size_128mp3: 1000, size_320mp3: 3000, size_flac: 6000 } }))
  const token = 'fixture-qq-session'
  const cookie = `qqmusic_session=${token}`
  const profile = { musicid: '84', str_musicid: '84', info: { nick: 'QQ测试听众' } }
  const likes = new Set(['QqSong1001'])
  const owned: typeof songs = []
  let subscribed = false, albumSubscribed = false, checks = 0
  const shared = () => ({ tid: 902, title: 'QQ晚风与生活', desc: '用于自动验收的 QQ 音乐示例歌单。', songnum: songs.length, creator: { nick: 'QQ音乐编辑部' }, subscribed })
  const own = () => ({ tid: 901, dirId: 10, dirType: 0, title: '我的QQ歌单', songnum: owned.length, creator: { nick: 'QQ测试听众' } })
  const album = () => ({ mid: 'QqAlbum201', name: 'QQ一起听见', singers: [{ name: 'QQ测试歌手' }], subscribed: albumSubscribed })
  const valid = (options: QqMusicRequest) => options.token === token
  return {
    async request(path, options = {}) {
      const q = options.query || {}, offset = Number(q.offset || 0), limit = Number(q.limit || 100), body = options.body as Record<string, any> | undefined
      const ok = (body: Record<string, any>) => ({ status: 200, body })
      const auth = () => ({ status: 401, body: { code: 401, errorKey: 'auth.required' } })
      if (path === '/login/qr/key') return ok({ code: 200, data: { unikey: 'fixture-qq-qr' } })
      if (path === '/login/qr/create') return ok({ code: 200, data: { qrimg: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/><path d="M10 10h50v50H10zM120 10h50v50h-50zM10 120h50v50H10zM80 80h90v90H80z" fill="black"/></svg>').toString('base64') } })
      if (path === '/login/qr/cancel') return ok({ code: 200 })
      if (path === '/login/qr/check') {
        checks++
        if (qrScenario === 'transient' && checks === 1) throw new Error('Synthetic connection reset')
        if (qrScenario === 'blocked') return ok({ code: 800, upstreamErrorKey: 'auth.account-restricted' })
        return ok(['success', 'transient'].includes(qrScenario) ? { code: 803, cookie } : { code: 801 })
      }
      if (path === '/login/status') return ok({ code: 200, data: valid(options) ? { profile } : {} })
      if (path === '/login/refresh') return valid(options) ? ok({ code: 200, data: { token, rotated: false } }) : auth()
      if (path === '/logout') return ok({ code: 200 })
      if ((path.startsWith('/user/') || path.startsWith('/getMusicPlay/')) && !valid(options)) return auth()
      if (path === '/search') {
        if (q.keyword === '双端错误隔离验收') return { status: 403, body: { code: 403, errorKey: 'upstream.business-rejected' } }
        const searchSongs = q.keyword === '双端分页验收' ? Array.from({ length: 65 }, (_, index) => ({ ...songs[index % songs.length], id: 3001 + index, mid: `QqPage${3001 + index}`, title: `QQ分页歌曲 ${index + 1}` })) : songs
        const items = q.type === 'song' ? searchSongs : q.type === 'album' ? [album()] : q.type === 'singer' ? [{ mid: 'QqArtist301', name: 'QQ测试歌手' }] : [shared()]
        const page = Number(q.page || 1), start = (page - 1) * limit
        return ok({ code: 200, items: items.slice(start, start + limit), total: items.length, more: start + limit < items.length })
      }
      if (path.startsWith('/getSongInfo/')) return ok({ response: { code: 0, songinfo: { code: 0, data: { track_info: songs.find(song => song.mid === path.split('/').pop()) } } } })
      if (path === '/getAlbumInfo') return ok({ response: { code: 0, data: { ...album(), list: songs } } })
      if (path === '/getSingerAlbum') return ok({ response: { code: 0, singer: { code: 0, data: { list: [album()], total: 1 } } } })
      if (path === '/singer/detail') return ok({ code: 200, singer: { mid: 'QqArtist301', name: 'QQ测试歌手', desc: 'QQ 音乐示例歌手' } })
      if (path === '/singer/songs') return ok({ code: 200, songs: songs.slice(offset, offset + limit), total: songs.length })
      if (path.startsWith('/getSongListDetail/')) return ok({ response: { code: 0, cdlist: [{ ...shared(), songlist: songs, total_song_num: songs.length }] } })
      if (path === '/recommend/playlists') return ok({ code: 200, playlists: [shared()], more: false })
      if (path === '/recommend/new-albums') return ok({ code: 200, albums: [album()], total: 1, more: false })
      if (path === '/recommend/toplists') return ok({ code: 200, groups: [{ id: 1, name: 'QQ榜单', toplists: [{ id: 26, title: 'QQ热歌榜', total: songs.length }] }] })
      if (path === '/recommend/toplist') return ok({ code: 200, toplist: { id: 26, title: 'QQ热歌榜' }, songs: songs.slice(offset, offset + limit), total: songs.length, more: false })
      if (path === '/user/daily-songs' || path === '/user/guess-you-like' || path === '/recommend/radar') return ok({ code: 200, songs })
      if (path === '/user/liked-songs') { const liked = songs.filter(song => likes.has(song.mid)); return ok({ code: 200, songs: liked.slice(offset, offset + limit), total: liked.length, more: offset + limit < liked.length }) }
      if (path === '/user/playlist') return ok({ code: 200, playlist: [own(), ...(subscribed ? [shared()] : [])], total: subscribed ? 2 : 1, more: false })
      if (path === '/user/playlist-detail') return ok({ code: 200, songs: owned.slice(offset, offset + limit), total: owned.length, more: false })
      if (path === '/user/albums') return ok({ code: 200, albums: albumSubscribed ? [album()] : [], total: albumSubscribed ? 1 : 0, more: false })
      if (path === '/user/subscription-status') return ok({ code: 200, items: [{ id: String(q.ids), status: (q.type === 'album' ? albumSubscribed : subscribed) ? 'subscribed' : 'not-subscribed' }] })
      if (path === '/user/song/like') { if (body?.liked) likes.add(body.song.mid); else likes.delete(body?.song.mid); return ok({ code: 200, liked: !!body?.liked }) }
      if (path === '/user/playlist/subscribe') { subscribed = !!body?.subscribed; return ok({ code: 200, subscribed }) }
      if (path === '/user/album/subscribe') { albumSubscribed = !!body?.subscribed; return ok({ code: 200, subscribed: albumSubscribed }) }
      if (path === '/user/playlist/tracks') { for (const item of body?.songs || []) { const song = songs.find(song => song.id === item.songId); if (song && !owned.includes(song)) owned.push(song) } return ok({ code: 200, changed: true }) }
      if (path.startsWith('/getMusicPlay/')) return ok({ data: { playUrl: { [path.split('/').pop()!]: { url: audioUrl, error: false, quality: q.quality } } } })
      if (path === '/getLyric') return ok({ response: { code: 0, lyric: '[00:00.00]QQ晚风轻轻经过\n[00:05.00]QQ音乐在这里停留\n[00:10.00]一起听见生活', trans: Buffer.from('[00:05.00]QQ歌词译文').toString('base64') } })
      if (path === '/comment/hot') return ok({ code: 200, comments: [{ id: 'qq-hot', content: 'QQ音乐也有好心情。', nick: 'QQ测试听众', praiseCount: 128, time: 1700000000 }], total: 1, more: false })
      if (path === '/comment/new') return ok({ code: 200, comments: [{ id: 'qq-new', content: 'QQ音乐示例评论', nick: 'QQ音乐朋友', praiseCount: 2, time: 1700000001 }], total: 1, more: false })
      return { status: 501, body: { code: 501, errorKey: 'feature.unavailable' } }
    }
  }
}
