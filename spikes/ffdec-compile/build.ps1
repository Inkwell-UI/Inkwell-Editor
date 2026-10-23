# Builds build/InkwellSpike.swf from committed sources: gen-swf.mjs (skeleton) + src/shapes/*.svg + src/as2/**.
# usage: ./build.ps1 [-FontMode class|define] [-Version 10] [-Out build/InkwellSpike.swf] [-Deploy]
param(
  [string]$FontMode = 'class', [int]$Version = 10, [string]$Out = "$PSScriptRoot\build\InkwellSpike.swf", [switch]$Deploy,
  [string]$FFDec = 'C:\Program Files (x86)\FFDec',
  [string]$DeployDir = 'C:\Modding\MO2\mods\Inkwell Spikes\Interface'  # an MO2 mod folder, never the game's Data folder
)
$ErrorActionPreference = 'Stop'
$b = Split-Path $Out; New-Item -ItemType Directory -Force $b | Out-Null
$base = "$b\base.swf"; $mid = "$b\shapes.swf"
$sw = [Diagnostics.Stopwatch]::StartNew(); $t = @{}
node "$PSScriptRoot\gen-swf.mjs" $base $FontMode $Version;                                   $t.gen = $sw.ElapsedMilliseconds; $sw.Restart()
& "$FFDec\ffdec-cli.exe" -importShapes $base $mid "$PSScriptRoot\src\shapes" | Out-Null;     $t.shapes = $sw.ElapsedMilliseconds; $sw.Restart()
& "$FFDec\ffdec-cli.exe" -importScript $mid $Out "$PSScriptRoot\src\as2" | Out-Null;        $t.script = $sw.ElapsedMilliseconds
if (-not (Test-Path $Out)) { throw 'FFDec produced no output (see FFDec errors above)' }
Write-Host "built $Out ($((Get-Item $Out).Length) bytes) ms: $($t | ConvertTo-Json -Compress)"
if ($Deploy) { New-Item -ItemType Directory -Force $DeployDir | Out-Null; Copy-Item $Out "$DeployDir\InkwellSpike.swf" -Force; Write-Host "deployed to $DeployDir" }
