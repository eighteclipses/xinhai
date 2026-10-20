export default function UpdateGuide() {
  return <section className="glass update-guide" id="settings-update-guide" tabIndex={-1} style={{ padding: '22px 26px', fontSize: 13, lineHeight: 1.8 }} aria-labelledby="update-guide-title">
    <h2 id="update-guide-title" style={{ fontSize: 15, fontWeight: 500, color: 'var(--cyan)', margin: '0 0 12px' }}>电脑怎么更新？</h2>
    <p>不用先卸载旧版。建议先在「完整备份」导出一份资料，再按下载的包更新。</p>
    <ul style={{ paddingLeft: 20, margin: '10px 0' }}>
      <li><strong>安装版：</strong>关闭心海，运行新版安装程序，按原来的安装位置覆盖安装。</li>
      <li><strong>便携版：</strong>把新版完整解压到一个新文件夹，运行里面的 xinhai-source.exe。不要只复制一个 EXE。</li>
    </ul>
    <p>本源码版使用独立的 xinhai-source 资料目录；请按同一种源码版更新，保留原有学习记录和外观。完整个人版、测试版和源码版的资料身份分开。</p>
    <p style={{ color: 'var(--ink-dim)', marginBottom: 0 }}>旧安装包可以清理；如果你曾把笔记、音乐等自己的文件放进旧解压目录，请先另存这些文件，再整理旧目录。</p>
  </section>
}
