# Compiles src/Inkwell_SpikeWidget.psc with russo-2025's papyrus.exe against the original stubs. usage: ./compile.ps1 -Papyrus <path to papyrus.exe> -Out <dir>
param([Parameter(Mandatory)][string]$Papyrus, [Parameter(Mandatory)][string]$Out)
New-Item -ItemType Directory -Force $Out | Out-Null
& $Papyrus compile -nocache -h "$PSScriptRoot\stubs" -i "$PSScriptRoot\src" -o $Out
