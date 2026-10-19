import type { KnowledgeNote } from './types'

export function extractKnowledgeLinks(content:string):string[] {
  return [...new Set(Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g),match=>match[1].split('|')[0].split('#')[0]))].filter(Boolean)
}

export function createKnowledgeLinkResolver(notes:KnowledgeNote[]):(link:string)=>KnowledgeNote|undefined {
  const paths=new Map<string,KnowledgeNote|null>(),titles=new Map<string,KnowledgeNote|null>()
  for(const note of notes){
    const path=note.path.replace(/\.md$/i,'')
    paths.set(path,paths.has(path)?null:note)
    titles.set(note.title,titles.has(note.title)?null:note)
  }
  return link=>{const key=link.replace(/\.md$/i,'');return (paths.has(key)?paths.get(key):titles.get(key))??undefined}
}

export function resolveKnowledgeLink(notes:KnowledgeNote[],link:string):KnowledgeNote|undefined {
  return createKnowledgeLinkResolver(notes)(link)
}

export function knowledgeBacklinks(notes:KnowledgeNote[],selectedPath:string|undefined):KnowledgeNote[] {
  if(!selectedPath)return []
  const resolve=createKnowledgeLinkResolver(notes)
  return notes.filter(note=>note.path!==selectedPath&&extractKnowledgeLinks(note.content).some(link=>resolve(link)?.path===selectedPath))
}
