<# Reverses exactly what install-fonts.ps1 recorded in its manifest. Supports -WhatIf. #>
[CmdletBinding(SupportsShouldProcess)]
param([string]$Manifest = (Join-Path $env:LOCALAPPDATA 'Inkwell\skyrim-fonts-manifest.json'))
$ErrorActionPreference = 'Stop'
$reg = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Fonts'
if (-not (Test-Path $Manifest)) { Write-Host "No manifest at ${Manifest}: nothing to uninstall."; return }
$m = Get-Content $Manifest -Raw | ConvertFrom-Json
foreach ($it in @($m.installed)) {
  $cur = (Get-ItemProperty -Path $reg -Name $it.regName -ErrorAction SilentlyContinue).($it.regName)
  if ($PSCmdlet.ShouldProcess($it.regName, "remove registry value and delete $($it.file)")) {
    if ($cur -eq $it.file) { Remove-ItemProperty -Path $reg -Name $it.regName } elseif ($cur) { Write-Warning "$($it.regName) now points elsewhere ($cur); left alone." }
    # a font in use may be locked until Figma/Windows restarts; tell the user rather than fail silently
    try { Remove-Item -LiteralPath $it.file -ErrorAction Stop } catch { if (Test-Path $it.file) { Write-Warning "Could not delete $($it.file) (in use?). Close Figma and delete it." } }
    Write-Host "removed $($it.regName)"
  } else { Write-Host "WOULD remove $reg\$($it.regName) and delete $($it.file)" }
}
if ($PSCmdlet.ShouldProcess($Manifest, 'delete manifest')) { Remove-Item -LiteralPath $Manifest } else { Write-Host "WOULD delete manifest ${Manifest}" }
