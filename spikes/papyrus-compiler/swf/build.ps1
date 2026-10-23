# Builds swf/build/InkwellSpikeWidget.swf from committed sources (gen-widget.mjs + src/shapes + src/as2); needs Node and user-installed FFDec.
# usage: ./build.ps1 [-Deploy]   (deploys to an MO2 mod folder, never the game's Data folder)
param([switch]$Deploy, [string]$FFDec = 'C:\Program Files (x86)\FFDec',
  [string]$DeployDir = 'C:\Modding\MO2\mods\Inkwell Spikes\Interface\exported\widgets\Inkwell')
$ErrorActionPreference = 'Stop'
$b = "$PSScriptRoot\build"; New-Item -ItemType Directory -Force $b | Out-Null
$out = "$b\InkwellSpikeWidget.swf"
node "$PSScriptRoot\gen-widget.mjs" "$b\base.swf" 10
& "$FFDec\ffdec-cli.exe" -importShapes "$b\base.swf" "$b\shapes.swf" "$PSScriptRoot\src\shapes" | Out-Null
& "$FFDec\ffdec-cli.exe" -importScript "$b\shapes.swf" $out "$PSScriptRoot\src\as2" | Out-Null
if (-not (Test-Path $out)) { throw 'FFDec produced no output' }
Write-Host "built $out ($((Get-Item $out).Length) bytes)"
if ($Deploy) { New-Item -ItemType Directory -Force $DeployDir | Out-Null; Copy-Item $out "$DeployDir\InkwellSpikeWidget.swf" -Force; Write-Host "deployed to $DeployDir" }
