import { useEffect, useState } from 'react'
import { useApp } from '../store/app'
import type { FocusCommitResult,FocusRewardPresentation } from '../../../shared/types'
import AlloutFinish from './AlloutFinish'
import { COMMERCIAL_EDITION } from '../../../shared/edition'
import { GrowthMoment } from './GrowthOverlay'

// Each saved session owns its presentation stage; subsequent sessions start fresh.
function SessionOutcome({result,allout}:{result:FocusCommitResult;allout:boolean}) {
  const [stage,setStage] = useState<'allout'|'growth'>(()=>allout?'allout':'growth')
  const hasGrowth = result.growth.events.length > 0
  const finish = () => useApp.setState({focusFinish:null})
  useEffect(()=>{if(stage==='growth'&&!hasGrowth)finish()},[stage,hasGrowth])
  if(stage==='allout')return <AlloutFinish seconds={result.session.seconds??result.session.minutes*60} task={result.session.taskLabel} onDone={()=>setStage('growth')}/>
  if(!hasGrowth)return null
  return <GrowthMoment current={{dimension:'knowledge',points:result.session.minutes,levelUp:result.growth.levelUps.length>0,before:result.before,after:result.growth.stats}} onDone={finish}/>
}

function RewardOutcome({reward}:{reward:FocusRewardPresentation}){
 const [error,setError]=useState(''),[busy,setBusy]=useState(false)
 async function finish(){if(busy)return;setBusy(true);try{await window.api.ackFocusRewards(reward.token,reward.blockIds);useApp.setState({focusRewardPresentation:null})}catch{setError('音符已入账，但收下状态尚未保存。可以重试确认；不会重复加分。');setBusy(false)}}
 if(error)return <section className="growth-stage" role="dialog" aria-label="确认收下学习音符"><p>{error}</p><button disabled={busy} onClick={()=>void finish()}>重试确认</button></section>
 return <GrowthMoment current={{dimension:'knowledge',points:reward.notes,noteCount:reward.notes,levelUp:false,before:reward.before,after:reward.after}} onDone={()=>void finish()}/>
}

export default function FocusOutcome() {
  const result = useApp(s=>s.focusFinish)
  const reward=useApp(s=>s.focusRewardPresentation)
  const allout = useApp(s=>s.settings.focusAlloutEnabled)
  const [visible,setVisible]=useState(!document.hidden)
  useEffect(()=>{let paused=false;const sync=()=>setVisible(!paused&&!document.hidden),pause=()=>{paused=true;sync()},resume=()=>{paused=false;sync()};document.addEventListener('visibilitychange',sync);window.addEventListener('xinhai-pause',pause);window.addEventListener('xinhai-resume',resume);return()=>{document.removeEventListener('visibilitychange',sync);window.removeEventListener('xinhai-pause',pause);window.removeEventListener('xinhai-resume',resume)}},[])
  if(reward)return visible?<RewardOutcome key={reward.blockIds.join(',')} reward={reward}/>:null
  return result ? <SessionOutcome key={result.session.id} result={result} allout={!COMMERCIAL_EDITION&&allout}/> : null
}
