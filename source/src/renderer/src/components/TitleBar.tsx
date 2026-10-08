import type {CSSProperties} from 'react'
export default function TitleBar({ onHideUI }: { onHideUI: () => void }){
 return <header className="window-bar" style={{WebkitAppRegion:'drag'} as CSSProperties}><div className="window-brand"><img className="brand-logo" src="design/app-icon.svg" alt="" /><strong>心海共学</strong><span>STUDY IN THE BLUE</span></div><div className="window-controls" style={{WebkitAppRegion:'no-drag'} as CSSProperties}><button className="hide-ui" title="欣赏壁纸；双击背景或按 Esc 返回" onClick={onHideUI}>欣赏壁纸</button><button aria-label="最小化" onClick={()=>window.api.winMinimize()}>—</button><button aria-label="最大化或还原" onClick={()=>window.api.winMaximize()}>□</button><button className="close" aria-label="关闭窗口" onClick={()=>window.api.winClose()}>×</button></div></header>
}
