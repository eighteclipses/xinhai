import { playClick } from '../lib/audio'
export default function Toggle({ on, onChange, label, desc }: { on: boolean; onChange: (v: boolean) => void; label: string; desc?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
      <div style={{minWidth:0,flex:1,paddingRight:12}}>
        <div style={{ fontSize: 13, color: 'var(--ink)' }}>{label}</div>
        {desc && <div style={{ fontSize: 12, color: 'var(--ink-dim)', marginTop: 2 }}>{desc}</div>}
      </div>
      <button
        role="switch" aria-checked={on} aria-label={label}
        onClick={() => {
          playClick()
          onChange(!on)
        }}
        style={{
          width: 44,
          minWidth: 44,
          height: 44,
          minHeight: 44,
          flexShrink: 0,
          padding: 0,
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          position: 'relative',
          transition: 'background 0.15s'
        }}
      >
        <span aria-hidden="true" style={{position:'absolute',left:0,top:11,width:44,height:22,borderRadius:11,border:'1px solid var(--glass-line)',background:on?'color-mix(in srgb,var(--theme-color) 60%,transparent)':'var(--theme-line)',transition:'background .15s'}}/>
        <span
          style={{
            position: 'absolute',
            top: 14,
            left: on ? 24 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s'
          }}
        />
      </button>
    </div>
  )
}
