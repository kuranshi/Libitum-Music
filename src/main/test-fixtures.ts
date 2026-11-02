import type { ApiModule } from './provider'
/** Only selected by the main process in an unpackaged, explicitly flagged E2E run. */
export function createFixtureApi(audioUrl = '', qrScenario = ''): ApiModule {
  const songs = ['晚风经过', '海岸线', '日落之前', '慢慢走', '远方来信', '城市的光'].map((name, i) => ({ id: 1001 + i, name, dt: 20000, ar: [{ id: 301, name: 'Libitum music测试歌手' }], al: { id: 201, name: '一起听见', picUrl: '' } }))
  const user = { userId: 42, nickname: '测试听众', avatarUrl: '' }
  let likes = [1001]
  let subscribed = false
  let albumSubscribed = false
  const ownTracks: typeof songs = []
  let qrChecks = 0, qrKeys = 0, lyricFailures = 0
  const playlist = () => ({ id: 101, name: '晚风与生活', coverImgUrl: '', description: '用于自动验收的本地测试歌单。', trackCount: songs.length, creator: { userId: 43, nickname: 'Libitum music编辑部' }, subscribed, trackIds: songs.map(song => ({ id: song.id })), tracks: songs })
  const album = { id: 201, name: '一起听见', picUrl: '', description: '一张用于验收的测试专辑。', artist: { id: 301, name: 'Libitum music测试歌手' }, size: songs.length }
  const ownPlaylist = () => ({ id: 102, name: '我的测试歌单', creator: { userId: 42, nickname: '测试听众' }, trackCount: ownTracks.length, trackIds: ownTracks.map(s => ({ id: s.id })), tracks: ownTracks })
  const response = (body: Record<string, any>) => Promise.resolve({ body: { code: 200, ...body } })
  const api: ApiModule = {
    login_status: p => Promise.resolve({ body: { code: 200, data: { profile: /(?:^|;\s*)MUSIC_U=fixture(?:;|$)/.test(String(p.cookie)) ? user : null } }, cookie: /(?:^|;\s*)MUSIC_U=fixture(?:;|$)/.test(String(p.cookie)) ? ['__csrf=fixture-csrf; Path=/; HttpOnly'] : [] }),
    login_qr_key: () => response({ data: { unikey: `fixture-qr-${++qrKeys}` } }),
    login_qr_create: p => response({ data: { qrimg: 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><desc>${String(p.key).replace(/[^a-z0-9-]/gi, '')}</desc><rect width="180" height="180" fill="white"/><path d="M10 10h50v50H10zM120 10h50v50h-50zM10 120h50v50H10zM80 80h90v90H80z" fill="black"/></svg>`).toString('base64') } }),
    login_qr_check: () => response({ code: 801 }),
    api: p => {
      if(p.uri==='/api/playlist/subscribe'||p.uri==='/api/playlist/unsubscribe') { subscribed=p.uri==='/api/playlist/subscribe';return response({}) }
      if (p.uri === '/api/v6/playlist/detail') return response({ playlist: String((p.data as any)?.id) === '102' ? ownPlaylist() : playlist() })
      if (p.uri === '/api/playlist/manipulate/tracks') {
        const data = p.data as any
        for (const id of JSON.parse(data.trackIds)) { const song = songs.find(s => String(s.id) === String(id)); if (song && !ownTracks.includes(song)) ownTracks.push(song) }
        return response({})
      }
      if (p.uri === '/api/login/qrcode/client/login') {
        qrChecks++
        if (qrScenario === 'transient' && qrChecks === 1) return Promise.reject({ body: { code: 502, msg: 'read ECONNRESET' } })
        if (qrScenario === 'blocked') return response({ code: 403, message: '设备环境异常' })
        if (qrScenario === 'success') return Promise.resolve({ body: { code: 803 }, cookie: ['MUSIC_U=fixture; Path=/; HttpOnly'] })
        return response({ code: 801 })
      }
      return response({ code: 404 })
    },
    cloudsearch: p => {
      if (p.type === 1 && p.keywords === '双端分页验收') {
        const paged = Array.from({ length: 65 }, (_, index) => ({ ...songs[index % songs.length], id: 2001 + index, name: `分页歌曲 ${index + 1}` }))
        const start = Number(p.offset || 0)
        return response({ result: { songs: paged.slice(start, start + Number(p.limit || 30)), songCount: paged.length } })
      }
      return response({ result: p.type === 1 ? { songs, songCount: songs.length } : p.type === 10 ? { albums: [album], albumCount: 1 } : p.type === 100 ? { artists: [{ id: 301, name: 'Libitum music测试歌手', musicSize: 6 }], artistCount: 1 } : { playlists: [playlist()], playlistCount: 1 } })
    },
    playlist_detail: () => response({ playlist: playlist() }),
    song_detail: p => response({ songs: songs.filter(song => String(p.ids).split(',').includes(String(song.id))) }),
    album: () => response({ album, songs }),
    album_detail_dynamic: () => response({ isSub: albumSubscribed }),
    artist_album:p=>response({artist:{id:301,name:'Libitum music测试歌手'},hotAlbums:Array.from({length:Math.min(30,33-Number(p.offset||0))},(_,i)=>({...album,id:201+Number(p.offset||0)+i,name:Number(p.offset||0)+i===0?'一起听见':`歌手测试专辑 ${Number(p.offset||0)+i+1}`})),more:Number(p.offset||0)+30<33}),
    artists: () => response({ artist: { id: 301, name: 'Libitum music测试歌手' }, hotSongs: songs }),
    recommend_songs: () => response({ data: { dailySongs: songs } }),
    recommend_resource: () => response({ recommend: [playlist()] }), personalized: () => response({ result: [playlist()] }),
    toplist: () => response({ list: [playlist()] }), album_new: () => response({ albums: [album] }),
    likelist: () => response({ ids: likes }), user_playlist: () => response({ playlist: [ownPlaylist(), ...(subscribed ? [playlist()] : [])], more: false }),
    album_sublist: () => response({ data: albumSubscribed ? [{ ...album, subscribed: true }] : [], count: albumSubscribed ? 1 : 0 }),
    like: p => { likes = p.like ? [...new Set([Number(p.id), ...likes])] : likes.filter(id => id !== Number(p.id)); return response({}) },
    playlist_subscribe: p => { subscribed = p.t === 1; return response({}) }, album_sub: p => { albumSubscribed = p.t === 1; return response({}) },
    comment_music: async p => {
      if(audioUrl) { const url=new URL('/comments',audioUrl);url.searchParams.set('id',String(p.id));url.searchParams.set('offset',String(p.offset||0));await fetch(url) }
      const offset=Number(p.offset)||0
      return response({hotComments:offset?[]:[{commentId:1,content:'愿每一段旋律都带来好心情。',user:{nickname:'测试听众',avatarUrl:''},likedCount:128,time:1700000000000}],comments:Array.from({length:Math.min(20,45-offset)},(_,i)=>({commentId:offset+i+2,content:`测试评论 ${offset+i+1}：让音乐陪伴每一天，认真听见每一个音符与故事。`,user:{nickname:'音乐朋友'},likedCount:2,time:1700000001000+i*1000})),total:45,more:offset+20<45})
    },
    lyric: p => String(p.id)==='1005'&&lyricFailures++===0?response({code:403,message:'测试歌词暂不可用'}):String(p.id)==='1006'?response({lrc:{lyric:'没有时间轴的第一句\n没有时间轴的第二句'}}):response({ tlyric:{lyric:'[00:05.00]译文测试行'}, lrc: { lyric: '[00:00.00]晚风轻轻经过\n[00:05.00]音乐在这里停留\n[00:10.00]一起听见生活'+Array.from({length:40},(_,i)=>`\n[01:${String(i).padStart(2,'0')}.00]测试歌词第 ${i+1} 行`).join('') } }),
    personal_fm: () => response({ data: songs }), personal_fm_mode: () => response({ data: songs }), fm_trash: () => response({}), scrobble: () => response({}),
    song_url_v1: p => response({ data: [{ id: p.id, url: audioUrl, level: String(p.id)==='1004'&&p.level==='hires'?'standard':p.level, br: 320000, type: 'wav' }] }),
    song_download_url_v1: p => response({ data: { id: p.id, url: audioUrl, level: p.level, br: 320000, type: 'wav' } })
  }
  return api
}
