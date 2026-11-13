# AS2 coverage: what the nodes can do

Where each ActionScript 2 capability lives in the node editor. "Bundled" packs ship with the editor (`resources/packs/bundled`, loaded after core; a pack your project locks in `packs.lock` replaces the bundled one of the same id). When no node fits, **Raw AS2** (statements) and **Raw AS2 Value** (an expression) run your own code; the editor still compiles it with FFDec and a syntax error fails the build.

| AS2 capability | Nodes | Pack |
| --- | --- | --- |
| Variables, typed, menu / graph / saved scope | Get/Set Variable, Toggle, Counter | core |
| `if` / `switch` / sequence | Branch, Switch, Sequence, Do Once | core |
| Loops, `break`, `continue` | Loop, For, For Each, Break, Continue | core |
| Timers, `setInterval`, delay | Delay, Cancel Delay, On Timer, On Update, Stop Timer, Get Time | core |
| `try` / `catch` / `throw` | Try Catch, Throw, Assert | core |
| Functions | function graphs, Call Function | core |
| Operators `+ - * /`, comparison, `&& \|\| !`, `?:` | Add, Subtract, Multiply, Divide, Arithmetic, Compare, And, Or, Not, Select | core |
| Bitwise `& \| ^ ~ << >>` | Bit And, Bit Or, Bit Xor, Bit Not, Shift Left, Shift Right | mathutils |
| `Math.*` | Abs, Floor, Ceil, Round, Sqrt, Power, trig, Min, Max, Random, Clamp, Lerp, Remap, ... | mathutils |
| Strings | Concat, Format, Substring, Replace, Split, Join, To Upper/Lower, Text Length | core |
| Strings (more) | Trim, Pad, Index Of, Char At, Starts/Ends With, Contains, Left, Right, Truncate Text, ... | stringutils |
| Arrays | Array Length/Get/Push/Sort By Field | core |
| Arrays (more) | Insert, Remove At, Remove Value, Slice, Array Reverse, Array Concat, Array Index Of, Array Contains, Unique, Sort, Shuffle, Range, Sum, ... | objectutils |
| Objects | Make Object, Get Field, Set Field | core |
| Objects (more) | Has Field, Keys, Values, Merge, Remove Field, Clone | objectutils |
| `Date` | Now, Make Timestamp, Get Date Part, durations, time of day, names | datetimeutils |
| Colour maths | Make Color, Get Channel, Lerp Color, Brightness, Hex To Color, ... | colorutils |
| Layer position, size, scale, rotation, alpha, visibility | Get/Set Position, Get/Set Size, Get Scale, Set Scale, Get/Set Rotation, Get/Set Alpha, Get/Set Visible | core |
| Tint, text colour and format | Set Tint (clips), Set Text Color, Set Text Format | core |
| Depth, mask, blend mode | Bring To Front, Swap Depths, Set Mask, Clear Mask, Set Blend Mode | core |
| Timeline | Play, Stop, Goto And Play, Set State (`gotoAndStop`) | core |
| Tweens and fades | Tween, Fade, Stop Tweens | core |
| Text, images, buttons, lists, scrolling | Set/Get Text, Set Image, Set Enabled, Set Items, Get Selected, Scroll To, Focus nodes | core |
| Creating layers at run time | Create Component, Remove Component, Clear Child Components | core |
| Input | On Input (game actions), On Click, On Hover, On Focus, On Key (raw key codes) | core |
| Skyrim / SKSE bridge | Send Mod Event, Call Runtime, Open/Close Menu, Play Sound, Get Setting, Get Input Device | core |
| Themes and languages | Get/Set Theme, Cycle Theme, Get Theme Variable, On Theme Changed, Get Localized Text | core |

## By design not covered (use Raw AS2)

XML, the drawing API (`lineTo`, `beginFill`), `getURL` / `fscommand` / `loadVariables`, `LocalConnection`, `SharedObject` (use saved variables), runtime `flash.filters` (GFx has none), a per-frame `onEnterFrame` (use On Update; V13.4), `while` without a bound (Loop has a round limit as a safety stop), and anything of the Skyrim UI that only a menu replacement reaches (its contract pack has nodes).

## Not verified in game

Set Mask, Clear Mask, Set Blend Mode, Play, Stop, Goto And Play, Bring To Front, Swap Depths, Set Text Format and On Key are plain Flash 8 calls that compile; whether GFx honours them is on the owner's list (`TEST-IN-GAME-PARITY.md`, workspace root).
