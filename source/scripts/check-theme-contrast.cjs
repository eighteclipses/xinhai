const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{buildSync}=require('esbuild')
const run=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'xinhai-theme-contrast-')),compiled=path.join(run,'palette.cjs')
buildSync({entryPoints:[path.resolve('src/shared/themeContrast.ts')],bundle:true,platform:'node',format:'cjs',outfile:compiled})
const {themeTextPalette,colorContrast,TEXT_SURFACE_ALPHA}=require(compiled)
assert.equal(colorContrast('#000000','#ffffff'),21)
assert.equal(colorContrast('#123456','#123456'),1)
assert.equal(TEXT_SURFACE_ALPHA,.84)
const cases=[],values=[0,17,51,85,119,153,187,221,255]
for(const r of values)for(const g of values)for(const b of values){
 const color='#'+[r,g,b].map(n=>n.toString(16).padStart(2,'0')).join(''),result=themeTextPalette(color)
 const accentRatio=colorContrast(result.accent,result.backdrop),mutedRatio=colorContrast(result.muted,result.backdrop),controlRatio=colorContrast(result.controlInk,result.controlFill)
 assert(accentRatio>=4.7&&mutedRatio>=4.7,color+' fails the protected-surface contrast target')
 assert(/^#[0-9a-f]{6}$/.test(result.accent)&&/^#[0-9a-f]{6}$/.test(result.muted))
 assert(controlRatio>=4.7,color+' fails the filled-control contrast target')
 cases.push({color,...result,accentRatio,mutedRatio,controlRatio})
}
assert.deepEqual(themeTextPalette('#00F'),themeTextPalette('#0000ff'))
assert.deepEqual(themeTextPalette('invalid'),themeTextPalette('#21bce7'))
assert(colorContrast('#0000ff',themeTextPalette('#0000ff').backdrop)<4.5,'The original dark-blue text must reproduce the regression')
const result={ok:true,run,checks:['known luminance references','729 RGB samples meet 4.7 on the brightest protected surface','729 filled controls independently meet 4.7','valid normalized hex and invalid-input fallback','old raw blue reproduces insufficient contrast'],scope:'color math only; actual renderer and backdrop checks are separate',minimumAccent:Math.min(...cases.map(c=>c.accentRatio)),minimumMuted:Math.min(...cases.map(c=>c.mutedRatio)),minimumControl:Math.min(...cases.map(c=>c.controlRatio)),cases}
fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({ok:true,result:path.join(run,'result.json'),samples:cases.length,minimumAccent:result.minimumAccent,minimumMuted:result.minimumMuted}))
