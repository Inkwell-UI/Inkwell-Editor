package com.inkwell;

import com.jpexs.decompiler.flash.ApplicationInfo;
import com.jpexs.decompiler.flash.SWF;
import com.jpexs.decompiler.flash.importers.AS2ScriptImporter;
import com.jpexs.decompiler.flash.importers.svg.SvgImporter;
import com.jpexs.decompiler.flash.tags.base.ShapeTag;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.LinkedBlockingDeque;

/**
 * Resident FFDec build wrapper. One JSON object per line on stdin, one per line on stdout.
 * In:  {"id":"1","base":"in.swf","shapes":"dir?","scripts":"dir?","out":"out.swf"}  or  {"cmd":"cancel","id":"1"}
 * Out: {"ready":true,"ffdec":"26.3.0","pinned":"26.3.0","match":true}, then {"id":"1","ok":true,"ms":12.3} / {"id":"1","ok":false,"error":"..."}
 * Runs on the user's FFDec (ffdec_lib on the classpath); contains none of it.
 */
public class Wrapper {
    static final String PINNED = "26.3.0";
    static final Map<String, String> POISON = new HashMap<String, String>();
    static PrintStream out;
    static final LinkedBlockingDeque<Map<String, String>> queue = new LinkedBlockingDeque<Map<String, String>>();

    static synchronized void send(String json) { out.println(json); out.flush(); }

    static String q(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static String reply(String id, boolean ok, double ms, String error) {
        return "{\"id\":" + q(id) + ",\"ok\":" + ok + ",\"ms\":" + String.format(Locale.ROOT, "%.1f", ms)
            + (error == null ? "" : ",\"error\":" + q(error)) + "}";
    }

    /** Flat JSON object whose values are strings, numbers or booleans (numbers/booleans kept as raw text). */
    static Map<String, String> parse(String s) {
        Map<String, String> m = new HashMap<String, String>();
        int[] p = {0};
        ws(s, p);
        expect(s, p, '{');
        ws(s, p);
        if (s.charAt(p[0]) == '}') return m;
        while (true) {
            ws(s, p);
            String k = str(s, p);
            ws(s, p);
            expect(s, p, ':');
            ws(s, p);
            if (s.charAt(p[0]) == '"') m.put(k, str(s, p));
            else {
                int a = p[0];
                while (p[0] < s.length() && ",} \t".indexOf(s.charAt(p[0])) < 0) p[0]++;
                m.put(k, s.substring(a, p[0]));
            }
            ws(s, p);
            if (s.charAt(p[0]) == ',') { p[0]++; continue; }
            expect(s, p, '}');
            return m;
        }
    }

    static void ws(String s, int[] p) { while (p[0] < s.length() && Character.isWhitespace(s.charAt(p[0]))) p[0]++; }

    static void expect(String s, int[] p, char c) {
        if (p[0] >= s.length() || s.charAt(p[0]) != c) throw new IllegalArgumentException("bad JSON at " + p[0] + ", expected " + c);
        p[0]++;
    }

    static String str(String s, int[] p) {
        expect(s, p, '"');
        StringBuilder b = new StringBuilder();
        while (s.charAt(p[0]) != '"') {
            char c = s.charAt(p[0]++);
            if (c != '\\') { b.append(c); continue; }
            char e = s.charAt(p[0]++);
            switch (e) {
                case 'n': b.append('\n'); break;
                case 't': b.append('\t'); break;
                case 'r': b.append('\r'); break;
                case 'b': b.append('\b'); break;
                case 'f': b.append('\f'); break;
                case 'u': b.append((char) Integer.parseInt(s.substring(p[0], p[0] + 4), 16)); p[0] += 4; break;
                default: b.append(e);
            }
        }
        p[0]++;
        return b.toString();
    }

    static void build(Map<String, String> job) throws Exception {
        String base = job.get("base"), outPath = job.get("out");
        if (base == null || outPath == null) throw new IllegalArgumentException("job needs base and out");
        SWF swf;
        try (InputStream in = new BufferedInputStream(new FileInputStream(base))) { swf = new SWF(in, false); }
        String shapes = job.get("shapes");
        if (shapes != null) {
            File[] svgs = new File(shapes).listFiles();
            if (svgs == null) throw new IOException("shapes folder not found: " + shapes);
            Arrays.sort(svgs); // deterministic order
            for (File f : svgs) {
                if (!f.getName().endsWith(".svg")) continue;
                int id = Integer.parseInt(f.getName().replace(".svg", "")); // file name = character id
                                Object ch = swf.getCharacter(id);
                if (!(ch instanceof ShapeTag)) throw new IOException("character " + id + " is not a shape (" + f.getName() + ")");
                new SvgImporter().importSvg((ShapeTag) ch, new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8), true);
            }
        }
        String scripts = job.get("scripts");
        if (scripts != null) new AS2ScriptImporter().importScripts(scripts, swf.getASMs(true));
        Path o = Paths.get(outPath), tmp = Paths.get(outPath + ".tmp"); // never leave a half-written output
        try (OutputStream os = new FileOutputStream(tmp.toFile())) { swf.saveTo(os); }
        Files.move(tmp, o, StandardCopyOption.REPLACE_EXISTING);
    }

    public static void main(String[] args) throws Exception {
        out = new PrintStream(new FileOutputStream(FileDescriptor.out), false, "UTF-8");
        System.setOut(System.err); // FFDec prints to stdout; keep the protocol channel clean
        final String ver = ApplicationInfo.version;
        final boolean match = PINNED.equals(ver);
        send("{\"ready\":true,\"ffdec\":" + q(String.valueOf(ver)) + ",\"pinned\":" + q(PINNED) + ",\"match\":" + match + "}");

        Thread worker = new Thread(new Runnable() {
            public void run() {
                try {
                    while (true) {
                        Map<String, String> job = queue.takeFirst();
                        if (job == POISON) return;
                        String id = job.get("id");
                        long t = System.nanoTime();
                        String err = null;
                        try {
                            if (!match) throw new IllegalStateException("FFDec " + ver + " is not the pinned " + PINNED);
                            build(job);
                        } catch (Throwable e) { // a bad job must not kill the process
                            err = e.getClass().getSimpleName() + ": " + e.getMessage();
                        }
                        send(reply(id == null ? "" : id, err == null, (System.nanoTime() - t) / 1e6, err));
                    }
                } catch (InterruptedException e) { /* exit */ }
            }
        });
        worker.start();

        BufferedReader r = new BufferedReader(new InputStreamReader(System.in, "UTF-8"));
        for (String line; (line = r.readLine()) != null; ) {
            if (line.trim().isEmpty()) continue;
            String id = "";
            try {
                Map<String, String> m = parse(line);
                id = m.containsKey("id") ? m.get("id") : "";
                if ("cancel".equals(m.get("cmd"))) {
                    boolean removed = false;
                    synchronized (queue) {
                        for (Iterator<Map<String, String>> it = queue.iterator(); it.hasNext(); ) {
                            if (id.equals(it.next().get("id"))) { it.remove(); removed = true; break; }
                        }
                    }
                    if (removed) send("{\"id\":" + q(id) + ",\"ok\":false,\"cancelled\":true,\"ms\":0.0}");
                } else queue.addLast(m);
            } catch (Throwable e) {
                send(reply(id, false, 0, "bad request: " + e.getMessage()));
            }
        }
        queue.addLast(POISON);
        worker.join();
    }
}
