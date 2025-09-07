import React, { useEffect, useState } from "react";
import LegacyApp from "./AppLegacy.jsx";

// --- Helper to wrap JSON in a Response (used by the adapter) ---
function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

/* --------------------------------------------------
   ✨ Visual FX CSS (scoped globals for this file)
   -------------------------------------------------- */
const FXStyles = () => (
  <style>{`
    @keyframes fx-shimmer {
      0% { background-position: 0% 50%; }
      100% { background-position: 200% 50%; }
    }
    @keyframes fx-flicker {
      0%, 19%, 22%, 62%, 64%, 70%, 100% { opacity: 1; }
      20%, 21%, 63% { opacity: .65; }
      65% { opacity: .85; }
    }
    @keyframes fx-eq {
      0%   { transform: scaleY(0.3); }
      25%  { transform: scaleY(0.9); }
      50%  { transform: scaleY(0.5); }
      75%  { transform: scaleY(1.0); }
      100% { transform: scaleY(0.3); }
    }
    .fx-card {
      position: relative;
      border-radius: 1rem; /* rounded-2xl */
      overflow: hidden;
      isolation: isolate; /* keep glows contained */
    }
    .fx-border {
      position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
      background: conic-gradient(from 180deg,
        rgba(99,102,241,.0) 0deg,
        rgba(99,102,241,.35) 40deg,
        rgba(236,72,153,.45) 110deg,
        rgba(99,102,241,.35) 210deg,
        rgba(99,102,241,.0) 360deg);
      background-size: 200% 200%;
      padding: 2px; /* visual border thickness */
      /* mask the middle so only the edge shows */
      -webkit-mask: 
        linear-gradient(#000 0 0) content-box, 
        linear-gradient(#000 0 0);
      -webkit-mask-composite: xor; mask-composite: exclude;
      animation: fx-shimmer 3.2s linear infinite;
      opacity: .35;
      filter: drop-shadow(0 0 12px rgba(99,102,241,.35));
    }
    .fx-card:hover .fx-border { opacity: .9; animation-duration: 1.6s; }
    .fx-card:active .fx-border { filter: drop-shadow(0 0 18px rgba(236,72,153,.6)); }

    /* Subtle CRT-ish flicker on hover */
    .fx-flicker { animation: fx-flicker 2.4s infinite; }

    /* Corner accents */
    .fx-corner { position: absolute; width: 18px; height: 18px; pointer-events: none; opacity: .75; }
    .fx-corner::before, .fx-corner::after {
      content: ""; position: absolute; background: currentColor; border-radius: 9999px;
    }
    .fx-corner::before { width: 14px; height: 2px; }
    .fx-corner::after  { width: 2px; height: 14px; }
    .fx-corner.tl { left: 10px; top: 10px; color: rgba(99,102,241, .9); }
    .fx-corner.tr { right: 10px; top: 10px; color: rgba(236,72,153,.9); }
    .fx-corner.bl { left: 10px; bottom: 10px; color: rgba(20,184,166,.9); }
    .fx-corner.br { right: 10px; bottom: 10px; color: rgba(168,85,247,.9); }
    .fx-card:hover .fx-corner::before { width: 24px; transition: width .25s ease; }
    .fx-card:hover .fx-corner::after  { height: 24px; transition: height .25s ease; }

    /* Tiny equalizer bars along the edges (sound-like hover) */
    .fx-eq {
      position: absolute; inset-inline: 14px; bottom: 10px; height: 10px; display: flex; gap: 3px; pointer-events: none;
      opacity: 0; transform: translateY(2px);
      transition: opacity .2s ease, transform .2s ease;
    }
    .fx-card:hover .fx-eq { opacity: .9; transform: translateY(0); }
    .fx-eq span { width: 2px; background: rgba(255,255,255,.75); transform-origin: 50% 100%; animation: fx-eq 900ms ease-in-out infinite; }
    .fx-eq span:nth-child(1){ animation-delay: 0ms; }
    .fx-eq span:nth-child(2){ animation-delay: 90ms; }
    .fx-eq span:nth-child(3){ animation-delay: 180ms; }
    .fx-eq span:nth-child(4){ animation-delay: 270ms; }
    .fx-eq span:nth-child(5){ animation-delay: 360ms; }

    /* Grid background for the picker page */
    .fx-grid {
      background-image: radial-gradient(rgba(148,163,184,.18) 1px, transparent 1px);
      background-size: 18px 18px;
      background-position: -1px -1px;
    }
    /* High-visibility mode */
    .hv .fx-card { outline: 2px solid rgba(255,255,255,.25); }
    .hv .fx-border { opacity: .95; filter: drop-shadow(0 0 18px rgba(236,72,153,.55)); }
    .hv .fx-eq span { height: 10px; }
    .hv .fx-card .text-sm { font-size: 0.95rem; }
    .hv .fx-card .text-xl { font-size: 1.4rem; }
  `}</style>
);

/* Resolve base path */
const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL)
  || (typeof process !== "undefined" && process.env && process.env.PUBLIC_URL)
  || "/";

const MANIFEST_URL = `${BASE}data/weeks.json`;

/* ------------ Utilities ------------ */
async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}\n${txt.slice(0, 200)}`);
  }
  if (!ct.includes("application/json")) {
    const txt = await res.text();
    throw new Error(`Expected JSON from ${url} but got ${ct}:\n${txt.slice(0, 200)}`);
  }
  return res.json();
}

const TOPIC_KEYS = ["topic", "topic_name", "topic_title", "subject"];
const SUBTOPIC_KEYS = ["subtopic", "name", "title", "section"];
function pickFirst(obj, keys){
  for (const k of keys) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return null;
}
function normalizeDifficulty(d){
  if (!d) return "Medium";
  const s = String(d).toLowerCase();
  if (s.startsWith("eas")) return "Easy";
  if (s.startsWith("har")) return "Hard";
  return "Medium";
}
function isVignette(q){
  const stem = q?.stem || "";
  if (q?.long_form === true) return true;
  if (stem.length > 280) return true;
  return false;
}
function toLettersMap(arrOrMap){
  if (!arrOrMap) return {};
  if (Array.isArray(arrOrMap)) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const out = {};
    arrOrMap.forEach((it, i) => {
      out[letters[i]] = typeof it === "string" ? it : (it?.text || it?.label || it?.value || "");
    });
    return out;
  }
  if (typeof arrOrMap === "object") return { ...arrOrMap };
  return {};
}

/* ------------ Builders (Compact -> Legacy) ------------ */
function buildLegacyNotes(notes){
  if (Array.isArray(notes?.lectures)) {
    return {
      lectures: notes.lectures.map((lec) => ({
        topic: String(lec?.topic || "Untitled"),
        subtopics: Array.isArray(lec?.subtopics) ? lec.subtopics.map((s) => ({
          name: String(s?.name || "Untitled"),
          content: typeof s?.content === "string" ? s.content : "",
          explain_like_i_am_stupid: String(s?.explain_like_i_am_stupid || ""),
          mnemonic: String(s?.mnemonic || ""),
          high_yield: typeof s?.high_yield === "boolean" ? s.high_yield : true,
        })) : []
      }))
    };
  }
  const para =
    Array.isArray(notes?.paragraphs) ? notes.paragraphs.join("\n\n")
  : (typeof notes?.content === "string" ? notes.content
    : (Array.isArray(notes?.lectures)
      ? notes.lectures
          .flatMap(l => Array.isArray(l?.subtopics) ? l.subtopics.map(s => (typeof s?.content === "string" ? s.content : "")) : [])
          .filter(Boolean).join("\n\n")
      : ""));
  return {
    lectures: [
      { topic: "General", subtopics: [{ name: "All", content: para, explain_like_i_am_stupid: "", mnemonic: "", high_yield: true }] }
    ]
  };
}

function buildLegacyQbanks(qbank){
  const qs = Array.isArray(qbank?.questions) ? qbank.questions : [];

  const byTopic = new Map();       // regular
  const byTopicLong = new Map();   // long (vignettes)

  qs.forEach((q, i) => {
    const norm = {
      id: q.id || `W6_Q${i+1}`,
      difficulty: normalizeDifficulty(q.difficulty),
      long_form: !!(q.long_form || q.vignette || (String(q.stem||"").length > 320)),
      stem: q.stem || "",
      options: toLettersMap(q.options),
      answer: q.answer,
      explanation: q.expl || q.explanation || (q.rationales ? JSON.stringify(q.rationales) : ""),
      image: q.image || null
    };
    const t = String(pickFirst(q, TOPIC_KEYS) || "General");
    const s = String(pickFirst(q, SUBTOPIC_KEYS) || "All");

    if (!byTopic.has(t)) byTopic.set(t, new Map());
    if (!byTopicLong.has(t)) byTopicLong.set(t, new Map());
    if (!byTopic.get(t).has(s)) byTopic.get(t).set(s, []);
    if (!byTopicLong.get(t).has(s)) byTopicLong.get(t).set(s, []);

    byTopic.get(t).get(s).push({ ...norm, long_form: false });
    byTopicLong.get(t).get(s).push({ ...norm, long_form: true });
    });

  const toLecture = (map, long=false) => {
    const out = [];
    map.forEach((subMap, topic) => {
      const subs = [];
      subMap.forEach((arr, name) => {
        const count = Array.isArray(arr) ? arr.length : 0;
        if (count > 0) {
          subs.push(long ? { name, question_count: count, long_questions: arr }
                         : { name, question_count: count, questions: arr });
        }
      });
      if (subs.length > 0) out.push({ topic, subtopics: subs });
    });
    // Sort topics alphabetically, keep "General" first
    out.sort((a, b) => {
      if (a.topic === "General") return -1;
      if (b.topic === "General") return 1;
      return a.topic.localeCompare(b.topic);
    });
    return out;
  };

  const flat = [];
  byTopic.forEach((subs, topic) => {
    subs.forEach((arr, name) => {
      arr.forEach(q => flat.push({ ...q, topic, subtopic: name }));
    });
  });

  return {
    REGULAR: { lectures: toLecture(byTopic, false) },
    LONG:    { lectures: toLecture(byTopicLong, true) },
    FLAT:    { questions: flat }
  };
}

/* ------------ Generic JSON Week Adapter (fetch-only, unify questions + vignettes) ------------ */

function normalizeQbank(qbank) {
  // Case 1: flat questions array
  if (qbank.questions) {
    return buildLegacyQbanks(qbank);
  }

  // Case 2: already in lectures format
  if (qbank.lectures) {
    return { REGULAR: qbank, LONG: qbank, FLAT: qbank };
  }

  // Case 3: nested object (Week 6 shape, preserve order with loops)
  if (typeof qbank === "object" && !Array.isArray(qbank)) {
    const lectures = [];
    for (const topic of Object.keys(qbank)) {
      const subtopics = [];
      for (const name of Object.keys(qbank[topic])) {
        const questions = qbank[topic][name];
        subtopics.push({
          name,
          questions: Array.isArray(questions) ? questions : [],
          long_questions: Array.isArray(questions) ? questions : [],
          question_count: Array.isArray(questions) ? questions.length : 0
        });
      }
      lectures.push({ topic, subtopics });
    }
    return { REGULAR: { lectures }, LONG: { lectures }, FLAT: { lectures } };
  }

  // Fallback
  return { REGULAR: { lectures: [] }, LONG: { lectures: [] }, FLAT: { lectures: [] } };
}

function useJsonWeekAdapter(currentWeek, setAdapterReady) {
  useEffect(() => {
    if (!currentWeek || currentWeek.kind !== "json") return;

    let cache = { built: null };
    const origFetch = window.fetch;

    async function ensureBuilt() {
      if (cache.built) return cache.built;

      const notesUrl = (currentWeek.notes?.startsWith("http")
        ? currentWeek.notes
        : `${BASE}data/${currentWeek.notes}`);

      const qbankUrl = (currentWeek.qbank?.startsWith("http")
        ? currentWeek.qbank
        : `${BASE}data/${currentWeek.qbank}`);

      const [notes, qbank] = await Promise.all([
        fetchJSON(notesUrl),
        fetchJSON(qbankUrl)
      ]);

      const notesLegacy = buildLegacyNotes(notes);
      const qb = normalizeQbank(qbank);

      // ✅ Force REGULAR and LONG to be identical
      const unifiedLectures = qb.REGULAR.lectures.map(topic => ({
        ...topic,
        subtopics: topic.subtopics.map(s => {
          const allQs = (s.questions || []).concat(s.long_questions || []);
          return {
            ...s,
            questions: allQs,
            long_questions: allQs,
            question_count: allQs.length
          };
        })
      }));

      cache.built = {
        NOTES: notesLegacy,
        REGULAR: { lectures: unifiedLectures },
        LONG: { lectures: unifiedLectures },
        FLAT: qb.FLAT
      };

      console.log("[DEBUG] unified lectures order:", unifiedLectures.map(l => l.topic));

      return cache.built;
    }

    function needsVirtual(u) {
      const file = String(u || "").split("/").pop().toLowerCase();
      return file.startsWith("master_notes")
        || file.startsWith("master_nbme_questions_long_layer")
        || file.startsWith("master_nbme_questions_layer_classified_with_counts")
        || file.startsWith("master_nbme_questions_layer_classified")
        || file.startsWith("master_nbme_questions");
    }

    window.fetch = async function(input, init) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      if (!needsVirtual(url)) {
        return origFetch(input, init);
      }
      try {
        const built = await ensureBuilt();
        const file = url.split("/").pop().toLowerCase();
        let payload = null;

        if (file.startsWith("master_notes")) {
          payload = built.NOTES;
        } else if (file.startsWith("master_nbme_questions_long_layer")) {
          payload = built.LONG;
        } else if (file.startsWith("master_nbme_questions_layer_classified_with_counts")) {
          payload = built.LONG;
        } else if (file.startsWith("master_nbme_questions_layer_classified")) {
          payload = built.LONG;
        } else if (file.startsWith("master_nbme_questions")) {
          payload = { ...built.REGULAR, ...built.FLAT };
        }

        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        console.error("[JSON Week Adapter]", err);
        return new Response(JSON.stringify({ lectures: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    };

    if (setAdapterReady) setAdapterReady(true);

    return () => {
      window.fetch = origFetch;
      if (setAdapterReady) setAdapterReady(false);
    };
  }, [currentWeek, setAdapterReady]);
}









/* ------------ UI ------------ */
function WeekPicker({ weeks, onPick, highVis=false, onToggleHighVis=()=>{}, theme='dark', onToggleTheme=()=>{} }){
  return (
    <div className={"min-h-screen fx-grid flex items-center justify-center p-6 " + (highVis ? "hv" : "")}>
      <div className="max-w-4xl w-full">
        <div className="flex items-center justify-between mb-6">
          <div className="text-left">
            <h1 className="text-3xl md:text-4xl font-black tracking-tight">
              Pick your <span className="text-indigo-500 fx-flicker">week</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleTheme}
              className="px-3 py-1.5 rounded-full border text-sm bg-slate-900 text-white dark:bg-slate-800 dark:text-slate-100 border-slate-700 hover:opacity-90">
              {theme === 'dark' ? 'Dark' : 'Light'}
            </button>
            <button
              onClick={onToggleHighVis}
              className={"px-3 py-1.5 rounded-full border text-sm transition " + (highVis ? "bg-amber-400 text-black border-amber-500" : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800")}>
              High Vis
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {weeks.map((w) => (
            <button
              key={w.id}
              onClick={() => onPick(w.id)}
              className="group fx-card w-full text-left bg-white/70 dark:bg-slate-900/70 backdrop-blur border border-slate-200/60 dark:border-slate-700/60 p-5 shadow-sm hover:shadow-xl transition duration-200">
              <div className="fx-border" />
              <span className="fx-corner tl" />
              <span className="fx-corner tr" />
              <span className="fx-corner bl" />
              <span className="fx-corner br" />

              <div className="flex items-start justify-between gap-3 relative z-[1]">
                <div>
  <div className="text-xs uppercase tracking-wider opacity-60">Week {w.id}</div>
  <div className="text-xl font-semibold mt-0.5">{w.label || `Week ${w.id}`}</div>
  {w.subtitle && (
    <div className="text-sm opacity-70">{w.subtitle}</div>
  )}
</div>

                <div className="text-2xl opacity-60 group-hover:opacity-100 translate-x-0 group-hover:translate-x-1 transition">→</div>
              </div>

              <div className="fx-eq">
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PodcastSwitcher({ items, activeWeek }){
  const [idx, setIdx] = React.useState(0);
  React.useEffect(() => { setIdx(0); }, [activeWeek?.id]);
  if (!Array.isArray(items) || items.length === 0) return null;
  const onPick = (i) => {
    setIdx(i);
    try {
      const cur = items[i] || {};
      const url = (cur?.src?.startsWith('http') ? cur.src : `${BASE}data/${cur?.src}`);
      // Try to find the legacy audio player and swap its source
      const root = document.getElementById("legacy-root");
      if (root) {
        const audio = root.querySelector("audio");
        if (audio && url) {
          const srcEl = audio.querySelector("source") || document.createElement("source");
          srcEl.src = url;
          if (!srcEl.parentElement) audio.appendChild(srcEl);
          audio.load();
          // do not auto-play to avoid UX surprises
        }
      }
    } catch {}
  };
  return (
    <div className="mx-auto max-w-3xl mt-4 mb-2">
      <div className="flex items-center justify-end gap-2 flex-wrap">
        {items.map((p, i) => (
          <button key={i} onClick={() => onPick(i)}
            className={"px-3 py-1.5 rounded-full border text-sm transition " + (i===idx ? "bg-indigo-600 text-white border-indigo-600" : "border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-800")}> 
            {p.title || `Podcast ${i+1}`}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [weeks, setWeeks] = useState(null);
  const [week, setWeek] = useState(null);
  const [theme, setTheme] = useState('dark');
  const [highVis, setHighVis] = useState(true);

  // NEW: adapterReady flag
  const [adapterReady, setAdapterReady] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
  }, [theme]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const manifest = await fetchJSON(MANIFEST_URL);
        if (!alive) return;
        setWeeks(manifest?.weeks || []);
      } catch (e) {
        console.error("Failed to load weeks manifest:", e);
        setWeeks([
  {
    id: 6,
    label: "Week 6 — Immunology",
    kind: "json",
    notes: "week6_notes.json",
    qbank: "week6_qbank.json"
  },
  { id: 5, label: "Week 5 (Legacy)", kind: "legacy" }
]);

      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const current = weeks?.find(w => Number(w.id) === Number(week)) || null;

  // Pass in setAdapterReady so LegacyApp waits for patch
  useJsonWeekAdapter(current, setAdapterReady);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <FXStyles />
      {!current && weeks && (
        <WeekPicker
          weeks={weeks}
          onPick={setWeek}
          highVis={highVis}
          onToggleHighVis={() => setHighVis(v => !v)}
          theme={theme}
          onToggleTheme={() => setTheme(t => (t === 'dark' ? 'light' : 'dark'))}
        />
      )}
      {current && (current.kind === "legacy" || adapterReady) && (
  <div className="p-2">
    <button
      onClick={() => setWeek(null)}
      className="mb-3 text-sm opacity-70 hover:opacity-100"
    >
      ← Back
    </button>
    <LegacyApp activeWeek={current} />
  </div>
)}

    </div>
  );
}

