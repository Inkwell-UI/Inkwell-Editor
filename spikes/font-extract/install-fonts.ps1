<# Per-user install of the fonts in out/fonts. No admin. Supports -WhatIf (prints what it would do).
   Copies to %LOCALAPPDATA%\Microsoft\Windows\Fonts and registers under HKCU\...\Fonts; records every change in a manifest. #>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Source = (Join-Path $PSScriptRoot 'out\fonts'),
  [string]$Manifest = (Join-Path $env:LOCALAPPDATA 'Inkwell\skyrim-fonts-manifest.json')
)
$ErrorActionPreference = 'Stop'
$reg = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
$destDir = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
$info = Get-Content (Join-Path $Source 'fonts.json') -Raw | ConvertFrom-Json
Write-Host $info.notice
if (Test-Path $Manifest) { throw "Manifest ${Manifest} exists: run uninstall-fonts.ps1 first." }
$items = @()
foreach ($f in $info.fonts) {
  $name = "$($f.family) $($f.style) (TrueType)"
  $dest = Join-Path $destDir ("Inkwell-" + $f.file)
  if ((Test-Path $dest) -or (Get-ItemProperty -Path $reg -Name $name -ErrorAction SilentlyContinue)) { throw "Refusing to overwrite existing '$dest' or registry value '$name'." }
  $items += [pscustomobject]@{ file = $dest; regName = $name }
}
if ($PSCmdlet.ShouldProcess($destDir, "install $($items.Count) fonts (per-user)")) {
  New-Item -ItemType Directory -Force -Path $destDir | Out-Null
  New-Item -ItemType Directory -Force -Path (Split-Path $Manifest) | Out-Null
  $done = @()
  try {
    for ($i = 0; $i -lt $items.Count; $i++) {
      Copy-Item (Join-Path $Source $info.fonts[$i].file) $items[$i].file
      New-ItemProperty -Path $reg -Name $items[$i].regName -Value $items[$i].file -PropertyType String | Out-Null
      $done += $items[$i]
      Write-Host "installed $($items[$i].regName)"
    }
  } finally {
    # manifest is written even on partial failure so uninstall can reverse exactly what happened
    @{ installed = $done } | ConvertTo-Json -Depth 4 | Set-Content -Encoding ASCII $Manifest
  }
  Write-Host "Done. Fully quit and restart Figma desktop."
} else {
  foreach ($it in $items) { Write-Host "WOULD copy -> $($it.file) and set $reg\$($it.regName)" }
  Write-Host "WOULD write manifest ${Manifest}"
}
