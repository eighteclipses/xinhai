import { useEffect, useState } from 'react'
import { useApp } from '../store/app'
import type { FocusCommitResult } from '../../../shared/types'
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

export default function FocusOutcome() {
  const result = useApp(s=>s.focusFinish)
  const allout = useApp(s=>s.settings.focusAlloutEnabled)
  return result ? <SessionOutcome key={result.session.id} result={result} allout={!COMMERCIAL_EDITION&&allout}/> : null
}
