# Cold (fresh JVM per ffdec-cli call) vs warm (one JVM, Nashorn + ffdec_lib, see warm.js) build timings.
# usage: ./bench.ps1 [-Runs 10]
param([int]$Runs = 10, [string]$FFDec = 'C:\Program Files (x86)\FFDec',
  [string]$Jre = 'C:\Program Files\Eclipse Adoptium\jre-8.0.504.1-hotspot')
$ErrorActionPreference = 'Stop'
$w = "$PSScriptRoot\build\bench"; New-Item -ItemType Directory -Force $w | Out-Null
node "$PSScriptRoot\gen-swf.mjs" "$w\base.swf" class 10
$sh = "$PSScriptRoot\src\shapes"; $as = "$PSScriptRoot\src\as2"
function Stats($name, $v) { $s = $v | Sort-Object; $m = if ($s.Count % 2) { $s[[int][math]::Floor($s.Count/2)] } else { ($s[$s.Count/2-1]+$s[$s.Count/2])/2 }
  "{0}: n={1} min={2:N0} median={3:N0} max={4:N0} ms  raw=[{5}]" -f $name, $s.Count, $s[0], $m, $s[-1], (($v | % { [int]$_ }) -join ',') }
$exe = foreach ($i in 1..$Runs) { (Measure-Command { & "$FFDec\ffdec-cli.exe" -importShapes "$w\base.swf" "$w\m.swf" $sh | Out-Null; & "$FFDec\ffdec-cli.exe" -importScript "$w\m.swf" "$w\o.swf" $as | Out-Null }).TotalMilliseconds }
Stats 'COLD ffdec-cli.exe x2 (shapes+script)' $exe
$jar = foreach ($i in 1..$Runs) { (Measure-Command { & "$Jre\bin\java.exe" -jar "$FFDec\ffdec.jar" -importShapes "$w\base.swf" "$w\m.swf" $sh | Out-Null; & "$Jre\bin\java.exe" -jar "$FFDec\ffdec.jar" -importScript "$w\m.swf" "$w\o.swf" $as | Out-Null }).TotalMilliseconds }
Stats 'COLD java -jar ffdec.jar x2' $jar
$one = foreach ($i in 1..$Runs) { (Measure-Command { & "$FFDec\ffdec-cli.exe" -importScript "$w\base.swf" "$w\o.swf" $as | Out-Null }).TotalMilliseconds }
Stats 'COLD ffdec-cli.exe x1 (script only)' $one
$cp = "$FFDec\ffdec.jar;$FFDec\lib\*"
$o = & "$Jre\bin\jjs.exe" "-J-cp" "-J$cp" "$PSScriptRoot\warm.js" -- "$w\base.swf" $sh $as "$w\warm.swf" 30
$o | Select-Object -First 4; '...'
$ms = $o | % { if ($_ -match 'ms=([\d.]+)') { [double]$Matches[1] } }
Stats 'WARM run 1 (JIT cold, same JVM start incl.)' @($ms[0]); Stats 'WARM runs 2..N (steady)' ($ms | Select-Object -Skip 1)
Stats 'WARM runs 11..N (JIT warmed)' ($ms | Select-Object -Skip 10)
# stdin job protocol round-trip (jobs file written without BOM, fed via cmd redirection)
$jobs = "$w\jobs.txt"; [IO.File]::WriteAllLines($jobs, [string[]](1..5 | % { "$w\base.swf|$sh|$as|$w\stdin_out.swf" }))
$o2 = cmd /c "`"$Jre\bin\jjs.exe`" -J-cp `"-J$cp`" `"$PSScriptRoot\warm.js`" -- --stdin < `"$jobs`""
"stdin protocol replies: $($o2 -join '; ')"
