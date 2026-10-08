export const GENERATED_COPY_NOTICE = '【AI 生成／辅助分析】选文中的回响与说明来自模型分析流程，可能包含本地补充；日记原文由用户输入。'

// Only a non-empty overlap with marked text counts. Merely touching the edge of
// the next AI paragraph must not label a selection of the user's own writing.
export function selectionIncludesGeneratedText(scope:HTMLElement,selection:Selection):boolean {
  const doc=scope.ownerDocument
  for(let i=0;i<selection.rangeCount;i++){
    const range=selection.getRangeAt(i)
    if(range.collapsed)continue
    const start=range.cloneRange(),end=range.cloneRange()
    start.collapse(true);end.collapse(false)
    for(const element of scope.querySelectorAll('[data-ai-generated="true"]')){
      const walker=doc.createTreeWalker(element,NodeFilter.SHOW_TEXT)
      for(let node=walker.nextNode();node;node=walker.nextNode()){
        if(!node.textContent?.length)continue
        const nodeStart=doc.createRange();nodeStart.selectNodeContents(node)
        const nodeEnd=nodeStart.cloneRange();nodeStart.collapse(true);nodeEnd.collapse(false)
        if(start.compareBoundaryPoints(Range.START_TO_START,nodeEnd)<0&&end.compareBoundaryPoints(Range.START_TO_START,nodeStart)>0)return true
      }
    }
  }
  return false
}

const editable=(element:Element|null)=>!!element?.closest('input,textarea,[contenteditable]:not([contenteditable="false"])')
const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!))

export function retainGeneratedCopy(event:ClipboardEvent,scope:HTMLElement):boolean {
  if(event.defaultPrevented||!event.clipboardData||editable(scope.ownerDocument.activeElement)||editable(event.target instanceof Element?event.target:null))return false
  const selection=scope.ownerDocument.getSelection(),text=selection?.toString()??''
  if(!selection||!text.trim()||!selectionIncludesGeneratedText(scope,selection))return false
  const marked=GENERATED_COPY_NOTICE+'\n\n'+text
  // Both clipboard formats carry the notice. No asynchronous clipboard access,
  // permission prompt, or change to the stored journal is needed.
  event.clipboardData.setData('text/plain',marked)
  event.clipboardData.setData('text/html','<div>'+escapeHtml(marked).replace(/\r\n|\r|\n/g,'<br>')+'</div>')
  event.preventDefault()
  return true
}
