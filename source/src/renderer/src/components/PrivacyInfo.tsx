import { useState } from 'react'
import { clearLegacyCloudCache } from '../lib/cloudLibrary'
import '../styles/privacy-info.css'

export default function PrivacyInfo() {
  const [clearing, setClearing] = useState(false)
  const [result, setResult] = useState('')
  async function clearOnlineData() {
    setClearing(true); setResult('')
    try {
      await window.api.clearOnlineMusicData()
      clearLegacyCloudCache()
      setResult('已清理本机旧在线音乐登录与歌单缓存。学习资料、本地音乐和已导出的备份未改动。')
    } catch (e) {
      setResult(`清理未完成，可以重试。${e instanceof Error ? e.message : ''}`)
    } finally { setClearing(false) }
  }
  return (
    <section className="glass privacy-info" aria-labelledby="privacy-info-heading">
      <header className="privacy-info-header">
        <div>
          <span className="privacy-info-eyebrow">LOCAL FIRST · DATA BOUNDARY</span>
          <h2 id="privacy-info-heading">本地资料与联网说明</h2>
        </div>
        <span className="privacy-info-badge">无需联网即可查阅</span>
      </header>

      <p className="privacy-info-intro">
        心海的学习资料主要保存在自己的 Windows 或 Android 设备上。下面按“什么时候会联网、哪些资料会离开本机”说明当前商业版的实际边界；内容随应用提供，打开或展开时不需要访问网页。
      </p>

      <div className="privacy-info-callout" role="note">
        <strong>默认离线可用</strong>
        <span>日记、专注、任务、习惯、日程和本地规则评分无需联网或模型账号。本版本已关闭云模型接入。</span>
      </div>

      <div className="privacy-info-overview" aria-label="资料与连接概览">
        <div>
          <strong>留在本机使用</strong>
          <span>学习记录、主题设置、草稿，以及你导入的壁纸、音乐和已授权知识库。</span>
        </div>
        <div>
          <strong>按需开启连接</strong>
          <span>局域网同步为可选功能；配对并开启同步后可能自动交换资料。</span>
        </div>
        <div>
          <strong>旧配置可清理</strong>
          <span>旧测试版模型密钥保留在本机保护存储中，不再用于请求，可在设置中移除。</span>
        </div>
        <div>
          <strong>备份先看范围</strong>
          <span>完整备份未加密，可能包含正文、附件、隐藏文件和撤销快照。</span>
        </div>
      </div>

      <div className="privacy-info-details" aria-label="详细说明">
        <details>
          <summary>日记分析与旧测试版记录</summary>
          <div className="privacy-info-detail-body">
            <p>
              本版本使用本机规则分析日记，不发送模型请求，也不提供模型配置或连接测试。规则可能漏判或误判，请对照记录确认，按实际经历调整分数。
            </p>
            <ul>
              <li>从旧测试版升级后，已有日记、摘要和 AI 来源标记继续保留，不会被改写为本地分析结果。</li>
              <li>旧模型密钥由本机保护能力保存，不随完整备份或局域网同步迁移。设置中的“旧测试版模型配置”可明确移除本机配置。</li>
              <li>旧版本曾发给第三方的内容无法通过本次升级撤回；服务商对既有内容的处理仍取决于其规则。</li>
            </ul>
          </div>
        </details>

        <details>
          <summary>本地音乐与旧版本缓存</summary>
          <div className="privacy-info-detail-body">
            <p>
              本版本提供音乐文件导入与本地播放，不提供网易云登录、歌单读取、分享链接解析或在线歌曲播放。请导入你有权使用的文件；原文件保留在你选择的位置，应用会保存导入副本。
            </p>
            <p>从旧测试版升级或恢复旧备份后，在线音乐的账号、歌单和歌曲元数据可能仍留在本机，但不会加入播放列表或恢复在线播放。下方按钮可清理这部分缓存及应用内旧登录状态，不会注销网易云账号，也不会改动学习记录、本地音乐或已导出的备份。</p>
            <button className="privacy-info-cleanup" disabled={clearing} onClick={() => void clearOnlineData()}>{clearing ? '正在清理旧音乐缓存…' : '清理旧在线音乐登录与缓存'}</button>
            {result && <p className="privacy-info-cleanup-result" role="status">{result}</p>}
          </div>
        </details>

        <details>
          <summary>局域网同步：默认关闭，配对后自动交换</summary>
          <div className="privacy-info-detail-body">
            <p>
              局域网同步默认关闭。你需要在同一局域网手动配对；启用后，应用会在配对设备可用时自动重连并同步日记正文/摘要/评分、专注、任务、习惯、日程、复习和成长记录。传输使用配对后的加密认证连接，接收者是你自己的另一台设备。
            </p>
            <ul>
              <li>配对码和状态可能包含设备名、随机设备标识与局域网地址。</li>
              <li>壁纸、音乐文件、模型配置、布局和 Markdown 知识库不在同步范围内。</li>
              <li>关闭同步会停止后续交换；解除配对不会自动删除另一台设备已经收到的记录。</li>
            </ul>
          </div>
        </details>

        <details>
          <summary>备份、删除与外部文件</summary>
          <div className="privacy-info-detail-body">
            <p>
              完整备份是未加密文件，可能包含学习记录、草稿、壁纸和音乐、知识库附件、隐藏普通文件，以及撤销快照中的旧内容；尚未清理的旧在线歌单元数据也可能进入备份。它不包含模型 Key、模型地址/名称配置、登录 Cookie、局域网配对密钥或同步历史。
            </p>
            <ul>
              <li>如果在系统文件选择器中选了网盘或其他文件提供程序，文件之后由该提供程序处理；主动打开浏览器、Obsidian 等外部链接也由对应应用处理。</li>
              <li>清除成长或练习记录不等于从所有副本彻底删除，撤销快照和已复制的媒体可能仍保留。</li>
              <li>下方“清空本应用资料”会删除应用保存的记录、快照、凭据和导入副本，先查看范围再确认。它不会删除应用目录之外的知识库、已导出备份、系统日志、云盘副本或另一台设备上的资料。</li>
            </ul>
          </div>
        </details>
      </div>

      <p className="privacy-info-boundary">
        <strong>内部测试版：</strong>本页说明当前功能的数据范围，正式销售文件待渠道条件确认。支持与隐私联系：GitHub Issues。当前应用未加入广告、行为统计或主动上传崩溃报告的功能；操作系统、文件提供程序和分发平台有各自的处理规则。
      </p>
    </section>
  )
}
