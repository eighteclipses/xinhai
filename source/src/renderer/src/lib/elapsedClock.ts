// Android's elapsedRealtime includes deep sleep and is unaffected by wall-clock edits.
export function elapsedNow():number {
  if(window.XinhaiNative){const result=JSON.parse(window.XinhaiNative.call('elapsedRealtime','{}'));if(result.ok&&Number.isFinite(result.value))return result.value}
  return performance.now()
}
