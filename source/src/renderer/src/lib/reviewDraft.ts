import type { ReviewDraft } from '../../../shared/types'
const key='xinhai-review-draft-v1'
export function readReviewDraft():ReviewDraft|null {
 try{const d=JSON.parse(localStorage.getItem(key)||'null');return d&&typeof d.id==='string'&&typeof d.question==='string'&&typeof d.answer==='string'&&Number.isSafeInteger(d.version)?d:null}catch{return null}
}
export function writeReviewDraft(d:ReviewDraft|null):void {if(d)localStorage.setItem(key,JSON.stringify(d));else localStorage.removeItem(key)}
export function newReviewDraft():ReviewDraft{return {id:crypto.randomUUID(),question:'',answer:'',topic:'',sourceRoot:'',sourcePath:'',version:0}}
