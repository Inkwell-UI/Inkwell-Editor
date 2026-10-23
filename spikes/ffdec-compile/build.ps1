# Builds the test variants build/InkwellSpike{A,B,C}.swf from committed sources: gen-swf.mjs (skeleton) + src/shapes/*.svg + src/as2/**.
# A = vanilla font import (gfxfontlib.swf/$EverywhereMediumFont), B = original fontClass build, C = local zero-glyph $EverywhereFont.
# usage: ./build.ps1 [-Version 10] [-Deploy]
param(
  [int]$Version = 10, [switch]$Deploy,
  [string]$FFDec = 'C:\Program Files (x86)\FFDec',
  [string]$DeployDir = 'C:\Modding\MO2\mods\Inkwell Spikes\Interface'  # an MO2 mod folder, never the game's Data folder
)
$ErrorActionPreference = 'Stop'
$b = "$PSScriptRoot\build"; New-Item -ItemType Directory -Force $b | Out-Null
foreach ($v in @{ A = 'import'; B = 'class'; C = 'define' }.GetEnumerator() | Sort-Object Name) {
  $base = "$b\base-$($v.Name).swf"; $mid = "$b\shapes-$($v.Name).swf"; $out = "$b\InkwellSpike$($v.Name).swf"; $as2 = "$b\as2-$($v.Name)"
  # per-variant copy of the AS2 tree with the VARIANT tag prepended to the frame script
  Remove-Item -Recurse -Force $as2 -ErrorAction SilentlyContinue; Copy-Item -Recurse "$PSScriptRoot\src\as2" $as2
  $fs = "$as2\frame_1\DoAction.as"; [IO.File]::WriteAllText($fs, "var VARIANT = `"$($v.Name)`";`n" + [IO.File]::ReadAllText($fs))  # no BOM
  Remove-Item $out -ErrorAction SilentlyContinue
  $sw = [Diagnostics.Stopwatch]::StartNew()
  node "$PSScriptRoot\gen-swf.mjs" $base $v.Value $Version
  & "$FFDec\ffdec-cli.exe" -importShapes $base $mid "$PSScriptRoot\src\shapes" | Out-Null
  & "$FFDec\ffdec-cli.exe" -importScript $mid $out $as2 | Out-Null
  if (-not (Test-Path $out)) { throw "FFDec produced no output for variant $($v.Name) (see FFDec errors above)" }
  Write-Host "built $out (font=$($v.Value), $((Get-Item $out).Length) bytes, $($sw.ElapsedMilliseconds) ms)"
  if ($Deploy) { New-Item -ItemType Directory -Force $DeployDir | Out-Null; Copy-Item $out $DeployDir -Force }
}
if ($Deploy) { Remove-Item "$DeployDir\InkwellSpike.swf" -ErrorAction SilentlyContinue; Write-Host "deployed to $DeployDir (old InkwellSpike.swf removed; B is its successor)" }
