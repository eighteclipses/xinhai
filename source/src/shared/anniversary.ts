export function isMarchFifth(date:Date):boolean{return date.getMonth()===2&&date.getDate()===5}
export function marchMemoryKey(date:Date):string{return 'xinhai-march-fifth-'+date.getFullYear()}
