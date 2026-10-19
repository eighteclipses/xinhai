import {useLayoutEffect,useState} from 'react'
import type {CharacterViewport} from '../../../shared/characterPlacement'
export function readCharacterViewport():CharacterViewport {
 if(typeof window==='undefined')return {width:1280,height:800,top:44,bottom:90}
 const shell=document.querySelector('.study-shell'),style=getComputedStyle(shell??document.documentElement)
 const px=(name:string,fallback:number)=>{const value=parseFloat(style.getPropertyValue(name));return Number.isFinite(value)?value:fallback}
 return {width:window.innerWidth,height:window.innerHeight,top:Math.max(12,px('--title-height',44)+8),bottom:Math.max(12,px('--nav-height',42)+px('--music-height',48)-10)}
}
export function useCharacterViewport():CharacterViewport {
 const [viewport,setViewport]=useState(readCharacterViewport)
 useLayoutEffect(()=>{const update=()=>setViewport(readCharacterViewport());update();window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);return()=>{window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update)}},[])
 return viewport
}
