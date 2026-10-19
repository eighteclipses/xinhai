import {create} from 'zustand'
import {useEffect} from 'react'
import {useApp} from './app'
import type {LearningCategory} from '../../../shared/learningCategories'
export const useLearningCategoryStore=create<{categories:LearningCategory[];loaded:boolean;error:string;revision:number}>(()=>({categories:[],loaded:false,error:'',revision:0}))
let pending:Promise<void>|null=null
export function refreshLearningCategories():Promise<void>{
 if(pending)return pending
 pending=window.api.learningCategoriesList().then(categories=>useLearningCategoryStore.setState(s=>({categories,loaded:true,error:'',revision:s.revision+1}))).catch(error=>{useLearningCategoryStore.setState({error:error instanceof Error?error.message:'学习分类读取失败'});throw error}).finally(()=>{pending=null})
 return pending
}
export function useLearningCategories(){
 const sync=useApp(s=>s.dataSyncVersion),reset=useApp(s=>s.dataResetVersion)
 const state=useLearningCategoryStore()
 useEffect(()=>{void refreshLearningCategories().catch(()=>undefined)},[sync,reset])
 return state
}
