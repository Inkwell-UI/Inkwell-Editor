# Date spike

A one-screen custom menu that shows whether Flash's `Date` class works in Skyrim's Scaleform AS2. It decides whether the Date nodes of the DateTimeUtils pack (Now, Get Date Part, Make Timestamp, planned for 0.2.0) can ship. One graph: On Open, then one Raw AS2 node that fills seven text lines, each probe in its own try/catch.

Deploy (needs Java, FFDec and the wrapper jar like the other samples; writes only into the MO2 mod folder `Inkwell Date Spike`): `yarn deploy:menu-date-spike` (`--to <...\mods\name>` and `--dll` as in `menuDeploy.ts`). Enable the mod, start Skyrim, press **E**.

What the lines should say (a line that says `undefined` or `ERROR` means that part of `Date` is missing):

1. `typeof Date: function`
2. `now ms:` a 13-digit number near the real time (about 1.79e12 in late 2026)
3. `UTC now:` the real UTC date and time
4. `local:` the local date and time, `tz` is the offset in minutes
5. `Date.UTC(2024,1,29): 1709164800000 want 1709164800000`
6. `epoch 0 year/weekday: 1970/4 want 1970/4`
7. `getTimer:` milliseconds since the movie started (a control: this one is known to work)

Report the seven lines (a photo or typed). If they match, Date is usable; if line 3 or 4 is frozen or wrong, say so.
