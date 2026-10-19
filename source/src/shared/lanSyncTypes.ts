export interface SyncConflict {id:string;table:string;field:string;winner:string;other:string}
export interface SyncPeerStatus {id:string;name:string;lastSync:number|null;error:string}
export interface SyncStatus {
 role:'host'|'client';enabled:boolean;deviceId:string;deviceName:string;addresses:string[];
 peers:SyncPeerStatus[];state:'off'|'waiting'|'syncing'|'online'|'offline'|'error';lastSync:number|null;message:string;
 conflicts:SyncConflict[];hasBackup:boolean
}
export type SyncVector=Record<string,number>
export interface SyncRegister {value:unknown;clock:number;device:string;seen:SyncVector}
export interface SyncRecord {table:string;uid:string;fields:Record<string,SyncRegister>;deleted:SyncRegister}
export interface SyncPacket {version:1|2|3;device:string;vector:SyncVector;records:SyncRecord[]}
