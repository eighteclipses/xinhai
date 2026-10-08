import { ONLINE_MUSIC_ENABLED } from './edition'
export function requireOnlineMusic(): void {
  if (!ONLINE_MUSIC_ENABLED) throw Error('本版本提供本地音乐，未提供在线音乐接入。')
}
