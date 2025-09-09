import React, { useEffect, useState, useMemo, useRef } from "react";


/* =================== Data file locations (served from /public) =================== */

// Vite will inject the correct base ("/medquest/") from vite.config.mjs
const BASE = import.meta.env.BASE_URL || "/";

// Notes (Learn)
const NOTES_URL = `${BASE}data/master_notes.json`;

// Regular NBME Qbank (Battle)
const REGULAR_QBANK_URL = `${BASE}data/master_nbme_questions.json`;

// Clinical Vignettes (long) — patched to only use the file we actually have
const LONG_QBANK_URLS = [
  `${BASE}data/master_nbme_questions_LONG_LAYER.json`
];

// Podcast
const PODCAST_URL = `${BASE}data/Unraveling_Cancer__From_Molecular_Code_to_Personalized_Cures.mp3`;



// Podcast audio (served from /public/data)

/* =================== Required Topic Order =================== */
const TOPIC_ORDER = [
  "Introduction to Neoplasia",
  "Genetic Testing for Familial Cancer Syndromes",
  "Molecular Diagnostics",
  "Cytogenetics",
  "Introduction to Carcinogenesis",
  "Nucleotide Metabolism",
  "Cytogenetics of Cancer",
  "Foundations of Cancer Screening & Diagnosis",
  "Foundations of Cancer Therapy",
  "Cancer Survival Mechanisms",
  "Individualizing Care of Cancer Patient",
  "Genetic Counseling of Familial Cancers",
];

/* =================== Helpers =================== */
const nz = (x, d = "") => (x ?? d);
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// === Topic aliasing (maps qbank topic names to canonical notes topic names) ===
const TOPIC_ALIASES = new Map([
  
]);
const normTopicWithAlias = (s) => {
  const n = norm(s);
  const hit = TOPIC_ALIASES.get(n);
  return hit ? norm(hit) : n;
};
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const mapImg = (p) => (p ? p.replace("sandbox:/mnt/data/", "/qimages/") : null);

async function fetchJSON(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
  return res.json();
}

/* =================== Ordering =================== */
function orderTopics(list) {
  const wanted = new Map(TOPIC_ORDER.map((t, i) => [t, i]));
  const [inOrder, rest] = list.reduce(
    (acc, t) => {
      (wanted.has(t.name) ? acc[0] : acc[1]).push(t);
      return acc;
    },
    [[], []]
  );
  inOrder.sort((a, b) => wanted.get(a.name) - wanted.get(b.name));
  rest.sort((a, b) => a.name.localeCompare(b.name));
  return [...inOrder, ...rest];
}

/* =================== Notes Index (supports multiple shapes) =================== */
function buildNotesIndex(notesJson) {
  const lectures = Array.isArray(notesJson?.lectures)
    ? notesJson.lectures
    : Array.isArray(notesJson?.topics)
    ? notesJson.topics.map((t) => ({
        topic: t.topic_title ?? t.topic ?? t.name,
        subtopics: t.subtopics ?? [],
      }))
    : [];

  const topicList = [];
  const topicMap = new Map(); // normTopic -> { topic, subMap: Map(normSub -> subObj) }

  for (const lec of lectures) {
       const topicName = lec.topic ?? lec.topic_title ?? lec.name ?? "Untitled Topic";
    const nTopic = normTopicWithAlias(topicName);
    const subMap = new Map();

    for (const raw of lec.subtopics ?? []) {
      const subName = raw.name ?? raw.subtopic ?? raw.title ?? "Untitled Subtopic";

      // Rich content for Learn
      let content = raw.content ?? raw.notes ?? raw.description ?? "";
      const bullets = Array.isArray(raw.high_yield)
        ? raw.high_yield.map((x) => `• ${x}`).join("\n")
        : "";
      if (!content && bullets) content = bullets;
      if (raw.eli5) content += (content ? "\n\nELI5: " : "ELI5: ") + raw.eli5;
      if (raw.mnemonic) content += (content ? "\n\nMnemonic: " : "Mnemonic: ") + raw.mnemonic;
      if (Array.isArray(raw.connections) && raw.connections.length) {
        content +=
          (content ? "\n\nConnections:\n" : "Connections:\n") +
          raw.connections
            .map(
              (c) =>
                `• ${c.topic}${c.subtopic ? ` — ${c.subtopic}` : ""}${
                  c.reason ? ` (${c.reason})` : ""
                }`
            )
            .join("\n");
      }

      const slideRef =
        raw.slide_reference ??
        raw.slide_ref ??
        (Array.isArray(raw.slides) ? raw.slides.join(", ") : undefined) ??
        "";

      subMap.set(norm(subName), {
        name: subName,
        content: nz(content, ""),
        slide_reference: nz(slideRef, ""),
        _raw: raw,
      });
    }

    topicMap.set(nTopic, { topic: topicName, subMap });
    topicList.push({ name: topicName, subtopics: Array.from(subMap.values()) });
  }

 return { topicList, topicMap }; // keep adapter order
}

/* =================== QBank Index (Clinical Vignettes = all questions) =================== */
function buildQuestionIndex(bankJson, prop = "questions") {
  let lectures = Array.isArray(bankJson?.lectures) ? bankJson.lectures : [];
  // Support nested { lectures: [...] } wrappers
  if (lectures.length && lectures.some(x => Array.isArray(x?.lectures))) {
    lectures = lectures.flatMap(x =>
      Array.isArray(x?.lectures) ? x.lectures : (x ? [x] : [])
    );
  }
  const map = new Map(); // normTopic -> Map(normSub -> Array<q>)

  for (const lec of lectures) {
    const topicName = lec.topic ?? lec.topic_title ?? lec.name ?? "";
    const nTopic = normTopicWithAlias(topicName);
    if (!map.has(nTopic)) map.set(nTopic, new Map());
    const subMap = map.get(nTopic);

    for (const st of lec.subtopics ?? []) {
      const subName = st.name ?? st.subtopic ?? st.title ?? "";
      const nSub = norm(subName);

      // Which keys to check
      const propList = Array.isArray(prop)
        ? prop
        : prop === "long_questions"
? ["long_questions", "long", "long_form_questions", "vignettes", "questions"] 
: ["questions", "regular_questions", "items"];


      // Gather
      let rawArr = [];
      for (const p of propList) {
        if (Array.isArray(st?.[p]) && st[p].length) {
          rawArr = st[p];
          break;
        }
      }

      // No filtering here — let Clinical Vignettes show *all* questions
      const arr = rawArr.map((q) =>
        normalizeQuestion(q, topicName, subName)
      );
      subMap.set(nSub, arr);
    }
  }
  return map;
}


function normalizeQuestion(q, topicName, subName) {
  const stem = q.stem ?? q.question ?? q.prompt ?? "";

  // options handling
  let options = {};
  if (q.options && typeof q.options === "object" && !Array.isArray(q.options)) {
    options = { ...q.options };
  } else if (Array.isArray(q.options)) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    q.options.forEach((it, i) => {
      if (typeof it === "string") options[letters[i]] = it;
      else options[letters[i]] = it.text ?? it.label ?? it.value ?? "";
    });
  } else if (Array.isArray(q.choices)) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    q.choices.forEach((it, i) => {
      if (typeof it === "string") options[letters[i]] = it;
      else options[letters[i]] = it.text ?? it.label ?? it.value ?? "";
    });
  }

  let answer = q.answer ?? q.correct ?? q.correct_answer ?? "";
  if (answer && typeof answer === "string" && options[answer] === undefined) {
    const aNorm = norm(answer);
    const hit = Object.entries(options).find(([L, txt]) => norm(txt) === aNorm);
    if (hit) answer = hit[0];
  }

  const image = mapImg(q.image ?? q.img ?? null);
  const slide_reference = q.slide_reference ?? q.slide_ref ?? "";
  const difficultyRaw = (q.difficulty || q.level || q.Difficulty || "").toString().toLowerCase();
  const difficulty =
    difficultyRaw.startsWith("eas") || difficultyRaw === "1" || difficultyRaw === "low"
      ? "easy"
      : difficultyRaw.startsWith("har") || difficultyRaw === "3" || difficultyRaw === "high"
      ? "hard"
      : "medium";

  return {
    ...q,
    topic: topicName || q.topic,
    subtopic: subName || q.subtopic,
    stem,
    options,
    answer,
    image,
    slide_reference,
    difficulty,
  };
}

/* =================== UI atoms =================== */
const NavIcon = ({ active, onClick, label, icon, id }) => (
  <button
    id={id}
    onClick={onClick}
    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition
      ${active ? "bg-indigo-600 text-white" : "hover:bg-slate-100 dark:hover:bg-slate-800"}
    `}
    title={label}
  >
    <div className={`text-xl ${active ? "" : "opacity-90"}`}>{icon}</div>
    <div className="font-semibold">{label}</div>
  </button>
);

const Pill = ({ children, onClick, active, className = "", ...r }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1 rounded-full text-xs font-semibold border transition shadow-sm
      ${active ? "bg-indigo-600 text-white border-indigo-600" : "bg-white/90 dark:bg-slate-900/90 border-slate-300 dark:border-slate-600 text-slate-800 dark:text-slate-100"}
      hover:-translate-y-0.5 hover:shadow ${className}`}
    {...r}
  >
    {children}
  </button>
);

const Btn = ({ children, onClick, kind = "primary", className = "", ...r }) => {
  const base = "px-4 py-2 rounded-xl font-semibold transition shadow hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0";
  const kindCls =
    kind === "primary"
      ? "text-white bg-indigo-600 hover:bg-indigo-500"
      : kind === "outline"
      ? "border border-indigo-300 text-indigo-700 dark:text-indigo-300 bg-transparent hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
      : "border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800";
  return (
    <button onClick={onClick} className={`${base} ${kindCls} ${className}`} {...r}>
      {children}
    </button>
  );
};

const Card = ({ children, className = "" }) => (
  <div
    className={`relative overflow-hidden rounded-2xl p-5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow transition-transform hover:-translate-y-0.5 ${className}`}
  >
    {children}
  </div>
);


/** Generic modal: allow custom z-index so Learn can appear above Quiz **/
const Modal = ({ open, onClose, title, wide = false, children, z = 1000 }) => {
  if (!open) return null;
  return (
    <div className={`fixed inset-0`} style={{ zIndex: z }}>
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className={`absolute left-1/2 top-6 -translate-x-1/2 ${wide ? "w-[min(1100px,92vw)]" : "w-[min(800px,92vw)]"} rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-2xl`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <div className="text-lg font-bold">{title}</div>
          <button className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose}>✕</button>
        </div>
        <div className="p-6 max-h-[75vh] overflow-auto">{children}</div>
      </div>
    </div>
  );
};

/** Single-color ring (kept for small usages) */
const Ring = ({ value = 0, size = 56, thick = 8, showText = true, className = "" }) => {
  const v = clamp01(value);
  const r = (size - thick) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - v);
  return (
    <div className={`relative inline-block ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={thick} stroke="var(--ring-bg, #e5e7eb)" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={thick}
          stroke="var(--ring-fg, #6366f1)"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {showText && <div className="absolute inset-0 grid place-items-center text-xs font-bold">{Math.round(v * 100)}%</div>}
    </div>
  );
};

/** Compact, locked circular progress ring (no hover drift). */
const HoverBiRing = ({
  correct = 0,
  attempted = 0,
  size = 41,     // smaller so it never crowds the tile
  thick = 6,
  className = ""
}) => {
  const pct = attempted > 0 ? Math.max(0, Math.min(1, correct / attempted)) : 0;
  const pct100 = Math.round(pct * 100);
  const deg = Math.round(360 * pct);

  const isEmpty = attempted === 0;
  const ringStyle = isEmpty
    ? { background: "conic-gradient(#94a3b8 0deg, #94a3b8 360deg)" } // neutral when 0/0
    : { background: `conic-gradient(#22c55e 0deg, #22c55e ${deg}deg, #ef4444 ${deg}deg, #ef4444 360deg)` };

  const inset = Math.max(6, Math.floor(thick));

  return (
    <div className={`flex flex-col items-center ${className}`} style={{ width: size }}>
      <div className="relative" style={{ width: size, height: size }}>
        <div className="absolute inset-0 rounded-full" style={ringStyle} />
        <div
          className="absolute rounded-full bg-white dark:bg-slate-900 grid place-items-center"
          style={{ inset }}
          aria-label={`Accuracy ${pct100}% (${correct} correct out of ${attempted})`}
          role="img"
          title={`${correct}/${attempted} correct`}
        >
          <div className="text-sm font-bold">{pct100}%</div>
        </div>
      </div>
      <div className="mt-1 text-[10px] opacity-75">
        {correct}/{attempted}
      </div>
    </div>
  );
};


/* =================== Learn content colorizer =================== */
function renderLearnContent(raw) {
  if (!raw) return <p>No notes yet.</p>;
  const lines = String(raw).split(/\n/);
  return (
    <div className="space-y-2">
      {lines.map((ln, i) => {
        let cls = "";
        let text = ln;

        // Skip lines starting with "Mnemonic:"
        if (/^\s*Mnemonic:/i.test(ln)) {
          return null;
        }

        // Explain Like I Am Stupid / ELI5
        if (/^\s*ELI5:/i.test(ln)) {
          cls =
            "bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-800";
          text = ln.replace(/^\s*ELI5:\s*/i, "");
          return (
            <div key={i} className={`p-3 rounded border ${cls}`}>
              <span className="font-bold text-amber-700 dark:text-amber-300 mr-2">
                💡 Explain Like I Am Stupid:
              </span>
              <span>{text}</span>
            </div>
          );
        }

        // Clinical Pearl
        if (/^\s*Clinical Pearl:/i.test(ln)) {
          cls =
            "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-800";
          text = ln.replace(/^\s*Clinical Pearl:\s*/i, "");
          return (
            <div key={i} className={`p-3 rounded border ${cls}`}>
              <span className="font-bold text-emerald-700 dark:text-emerald-300 mr-2">
                🌟 Clinical Pearl:
              </span>
              <span>{text}</span>
            </div>
          );
        }

        // Connections
        if (/^\s*Connections:/i.test(ln)) {
          cls =
            "bg-sky-50 dark:bg-sky-900/30 border-sky-300 dark:border-sky-800";
          text = ln.replace(/^\s*Connections:\s*/i, "");
          return (
            <div key={i} className={`p-3 rounded border ${cls}`}>
              <span className="font-bold text-sky-700 dark:text-sky-300 mr-2">
                🔗 Connections:
              </span>
              <span className="whitespace-pre-wrap">{text}</span>
            </div>
          );
        }

        // Bullet points
        if (/^\s*•/.test(ln)) {
          return (
            <div key={i} className="pl-2">
              <span className="text-emerald-500 mr-2">●</span>
              <span>{ln.replace(/^\s*•\s*/, "")}</span>
            </div>
          );
        }

        // Default fallback
        return <p key={i}>{ln}</p>;
      })}
    </div>
  );
}


/* =================== Spotlight (tutorial highlight) =================== */
function useSpotlight(targetId, depKey) {
  const [rect, setRect] = useState(null);
  useEffect(() => {
    function compute() {
      const el = targetId ? document.getElementById(targetId) : null;
      if (!el) return setRect(null);
      const r = el.getBoundingClientRect();
      setRect({
        top: r.top + window.scrollY - 8,
        left: r.left + window.scrollX - 8,
        width: r.width + 16,
        height: r.height + 16,
      });
    }
    compute();
    const obs = new ResizeObserver(compute);
    if (document.body) obs.observe(document.body);
    const onWin = () => compute();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      obs.disconnect();
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
  }, [targetId, depKey]);
  return rect;
}

// TRying this new thing below to see if it can make the entire audio player fancier
/*-------------------------
const AuroraStyles = () => (
  <style>{`
    .aurora-card{
      position:relative;background:linear-gradient(180deg,rgba(15,16,35,.72),rgba(15,16,35,.55));
      backdrop-filter:blur(8px);overflow:hidden;border-radius:1.25rem;isolation:isolate;
    }
    .aurora-card::before{
      content:"";position:absolute;inset:-2px;border-radius:inherit;
      background:conic-gradient(from 180deg,rgba(99,102,241,.0) 0deg,rgba(99,102,241,.35) 70deg,rgba(168,85,247,.6) 160deg,rgba(244,114,182,.45) 220deg,rgba(99,102,241,.35) 320deg,rgba(99,102,241,.0) 360deg);
      filter:blur(6px);opacity:.55;z-index:-1;animation:aurora-spin 8s linear infinite;
    }
    .aurora-card::after{
      content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(148,163,184,.09) 1px,transparent 1px);
      background-size:18px 18px;pointer-events:none;z-index:0;
    }
    @keyframes aurora-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    .btn-neon{border:1px solid rgba(129,140,248,.35);background:rgba(17,24,39,.75);color:#e9e6ff;transition:box-shadow .18s ease,transform .12s ease,border-color .18s ease;}
    .btn-neon:hover{border-color:rgba(167,139,250,.8);box-shadow:0 10px 30px rgba(168,85,247,.18),inset 0 0 12px rgba(99,102,241,.18);transform:translateY(-1px);}
    .btn-cta{background:linear-gradient(135deg,#8b5cf6,#a78bfa 60%,#f472b6);color:#fff;box-shadow:0 18px 40px rgba(139,92,246,.35);}
    .btn-cta:hover{filter:brightness(1.06);box-shadow:0 24px 56px rgba(139,92,246,.45);}
    .prog-rail{background:linear-gradient(90deg,rgba(99,102,241,.15),rgba(168,85,247,.15),rgba(244,114,182,.15));}
    .prog-fill{background:linear-gradient(90deg,#6366f1,#8b5cf6 50%,#f472b6);box-shadow:0 0 24px rgba(139,92,246,.35);}
    .prog-buffer{background:rgba(148,163,184,.35);}
    .prog-thumb{box-shadow:0 6px 14px rgba(139,92,246,.35),inset 0 0 10px rgba(255,255,255,.25);border:1px solid rgba(167,139,250,.65);}
    .art-wrap{position:relative;border-radius:1rem;overflow:hidden;background:
      radial-gradient(1200px 800px at 20% -10%,rgba(139,92,246,.18),transparent 45%),
      radial-gradient(1200px 800px at 80% 120%,rgba(244,114,182,.18),transparent 45%),
      rgba(17,24,39,.5);
      border:1px solid rgba(129,140,248,.35);box-shadow:inset 0 0 24px rgba(99,102,241,.18);
    }
  `}</style>
);

*/
const AuroraStyles = () => (
  <style>{`
    .aurora-card{
      position:relative;background:linear-gradient(180deg,rgba(15,16,35,.72),rgba(15,16,35,.55));
      backdrop-filter:blur(8px);overflow:hidden;border-radius:1.25rem;isolation:isolate;
    }
    .aurora-card::before {
  content:"";
  position:absolute; inset:-2px;
  border-radius:inherit;
  background: radial-gradient(circle at 30% 30%, rgba(139,92,246,.45), transparent 60%),
              radial-gradient(circle at 70% 70%, rgba(236,72,153,.35), transparent 60%);
  filter: blur(14px);
  z-index:-1;
  animation: aurora-breathe 6s ease-in-out infinite;
}
@keyframes aurora-breathe {
  0%, 100% { opacity: .35; }
  50% { opacity: .75; }
}

    }
    .aurora-card::after{
      content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(148,163,184,.09) 1px,transparent 1px);
      background-size:18px 18px;pointer-events:none;z-index:0;
    }
    @keyframes aurora-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
    .btn-neon{border:1px solid rgba(129,140,248,.35);background:rgba(17,24,39,.75);color:#e9e6ff;transition:box-shadow .18s ease,transform .12s ease,border-color .18s ease;}
    .btn-neon:hover{border-color:rgba(167,139,250,.8);box-shadow:0 10px 30px rgba(168,85,247,.18),inset 0 0 12px rgba(99,102,241,.18);transform:translateY(-1px);}
    .btn-cta{background:linear-gradient(135deg,#8b5cf6,#a78bfa 60%,#f472b6);color:#fff;box-shadow:0 18px 40px rgba(139,92,246,.35);}
    .btn-cta:hover{filter:brightness(1.06);box-shadow:0 24px 56px rgba(139,92,246,.45);}
    .prog-rail{background:linear-gradient(90deg,rgba(99,102,241,.15),rgba(168,85,247,.15),rgba(244,114,182,.15));}
    .prog-fill{background:linear-gradient(90deg,#6366f1,#8b5cf6 50%,#f472b6);box-shadow:0 0 24px rgba(139,92,246,.35);}
    .prog-buffer{background:rgba(148,163,184,.35);}
    .prog-thumb{box-shadow:0 6px 14px rgba(139,92,246,.35),inset 0 0 10px rgba(255,255,255,.25);border:1px solid rgba(167,139,250,.65);}
    .art-wrap{position:relative;border-radius:1rem;overflow:hidden;background:
      radial-gradient(1200px 800px at 20% -10%,rgba(139,92,246,.18),transparent 45%),
      radial-gradient(1200px 800px at 80% 120%,rgba(244,114,182,.18),transparent 45%),
      rgba(17,24,39,.5);
      border:1px solid rgba(129,140,248,.35);box-shadow:inset 0 0 24px rgba(99,102,241,.18);
    }
  `}</style>
);



/* ===================== Premium Media Podcast Player (Integrated) ===================== */
/* =================== MediaPodcastPlayer — Butter-UI polished =================== */
function MediaPodcastPlayer({
  src,
  title = "Podcast",
  artwork = null,
  activeWeek,
  podIndex = 0,
  onPickPodcast
}) {



  // Inline UI atoms & icons so no external deps are required
  const IconPlay = () => (<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>);
  const IconPause = () => (<svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>);
  const IconRewind = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M13 6v12l-8-6 8-6z"/>
    <path d="M21 6v12l-8-6 8-6z"/>
  </svg>
);



const IconForward = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M11 6v12l8-6-8-6z"/>
    <path d="M3 6v12l8-6-8-6z"/>
  </svg>
);

  const IconButton = ({ children, onClick, label }) => (
    <button
      type="button"
      className="grid place-items-center w-14 h-14 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:shadow transition active:scale-95"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );

  const audioRef = useRef(null);
  const canvasRef = useRef(null);
  const progressRef = useRef(null);
  const draggingRef = useRef(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [hoverPct, setHoverPct] = useState(null);
  const [showTooltip, setShowTooltip] = useState(false);
  const [artOk, setArtOk] = useState(true);

  const rafRef = useRef(null);
  const analyserRef = useRef(null);
  const dataArrayRef = useRef(null);
  const audioCtxRef = useRef(null);

  // The next two lines are just to test the shockwave
  const wavesRef = useRef([]);      // active rings
const lastSpawnRef = useRef(0);   // timestamp of last ring


  useEffect(() => {
  const el = audioRef.current;
  if (!el) return;

  const onLoaded = () => {
    setDuration(Number.isFinite(el.duration) ? el.duration : 0);
    // sync initial props
    el.playbackRate = rate;
    el.volume = volume;
    el.muted = muted;
    ensureAnalyser(); // safe: no-op if already created
    // ❌ don’t call drawBars() here — we start it on 'play'
  };

  const onTime = () => {
    if (!draggingRef.current) setCurrentTime(el.currentTime || 0);
  };

  const onProg = () => {
    try {
      const b = el.buffered;
      if (b && b.length) setBufferedEnd(b.end(b.length - 1));
    } catch {}
  };

  const onPlay = () => {
    setIsPlaying(true);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(drawBars);
  };

  const onPause = () => {
    setIsPlaying(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  el.addEventListener("loadedmetadata", onLoaded);
  el.addEventListener("timeupdate", onTime);
  el.addEventListener("progress", onProg);
  el.addEventListener("play", onPlay);
  el.addEventListener("pause", onPause);
  el.addEventListener("ended", onPause);

  return () => {
    el.removeEventListener("loadedmetadata", onLoaded);
    el.removeEventListener("timeupdate", onTime);
    el.removeEventListener("progress", onProg);
    el.removeEventListener("play", onPlay);
    el.removeEventListener("pause", onPause);
    el.removeEventListener("ended", onPause);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };
}, []); // attach listeners once


// When the selected podcast changes, load it (and auto-play)
useEffect(() => {
  const el = audioRef.current;
  if (!el || !src) return;

  // If React already set the same src (browser expands to absolute), skip.
  if (el.src && el.src.endsWith(src)) return;

  const wasPlaying = !el.paused;        // preserve state if you want
  try { el.pause(); } catch {}

  // Reset UI state
  setCurrentTime(0);
  setIsPlaying(false);

  // Reapply your prefs in case some browsers reset them
  el.playbackRate = rate;   // <-- include rate, volume, muted from your state
  el.volume = volume;
  el.muted = muted;

  el.load(); // fetch the new source

  // Autoplay (or only if it was playing before)
  const shouldAutoplay = true || wasPlaying;
  if (shouldAutoplay) {
    el.play().catch(async (err) => {
      // Handle autoplay blocks (Safari/Chrome mobile)
      if (err?.name === "NotAllowedError") {
        const prev = el.muted;
        el.muted = true;
        try { await el.play(); } catch {}
        el.muted = prev;
      }
    });
  }
}, [src, rate, volume, muted]);



  useEffect(() => { if (audioRef.current) audioRef.current.playbackRate = rate; }, [rate]);
  useEffect(() => { if (audioRef.current) { audioRef.current.volume = volume; if (volume > 0 && muted) setMuted(false); } }, [volume]);
  useEffect(() => { if (audioRef.current) audioRef.current.muted = muted; }, [muted]);

  const ensureAnalyser = () => {
    if (analyserRef.current || !audioRef.current) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const srcNode = ctx.createMediaElementSource(audioRef.current);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    srcNode.connect(analyser);
    analyser.connect(ctx.destination);
    audioCtxRef.current = ctx;
    analyserRef.current = analyser;
    dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
  };

  useEffect(() => {
  const el = audioRef.current;
  if (!el) return;

  const onPlay = () => {
    setIsPlaying(true);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(drawBars);
  };
  const onPause = () => {
    setIsPlaying(false);
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  el.addEventListener("play", onPlay);
  el.addEventListener("pause", onPause);
  el.addEventListener("ended", onPause);

  return () => {
    el.removeEventListener("play", onPlay);
    el.removeEventListener("pause", onPause);
    el.removeEventListener("ended", onPause);
  };
}, []);



useEffect(() => {
  const onKey = (e) => {
    // ignore when typing in inputs/selects/textareas
    const tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.isComposing) return;

    const k = e.key;
    const lower = (k || "").toLowerCase();

    // Space or 'k' -> toggle
    if (k === " " || lower === "k" || k === "Spacebar") {
      e.preventDefault(); // stop page scroll on Space
      toggle();
      return;
    }

    // J or ArrowLeft -> -10s
    if (lower === "a" || k === "ArrowLeft") {
      e.preventDefault();
      seekBy(-10);
      return;
    }

    // L or ArrowRight -> +10s
    if (lower === "d" || k === "ArrowRight") {
      e.preventDefault();
      seekBy(+10);
      return;
    }

    // Shift+, -> slower   |   Shift+. -> faster
    if ((e.shiftKey && k === ",") || k === "<") {
      e.preventDefault();
      // slower by 0.25x
      audioRef.current && (audioRef.current.playbackRate = Math.max(0.5, Math.round((audioRef.current.playbackRate - 0.25) * 4) / 4));
      return;
    }
    if ((e.shiftKey && k === ".") || k === ">") {
      e.preventDefault();
      // faster by 0.25x
      audioRef.current && (audioRef.current.playbackRate = Math.min(2.5, Math.round((audioRef.current.playbackRate + 0.25) * 4) / 4));
      return;
    }

    // M -> mute
    if (lower === "m") {
      e.preventDefault();
      if (audioRef.current) {
        const next = !audioRef.current.muted;
        audioRef.current.muted = next;
        setMuted(next);
      }
    }
  };

  // capture:true + passive:false so Space preventDefault works reliably
  window.addEventListener("keydown", onKey, { capture: true });
  return () => window.removeEventListener("keydown", onKey, { capture: true });
}, []);



/* -------------------------
 OLD drawBars (commented out)
----------------------------
  // Replace the existing drawBars with this:
const drawBars = () => {
  const analyser = analyserRef.current;
  const canvas = canvasRef.current;
  if (!analyser || !canvas) return;

  const ctx = canvas.getContext("2d");
  const DPR = window.devicePixelRatio || 1;
  const W = (canvas.width = canvas.clientWidth * DPR);
  const H = (canvas.height = canvas.clientHeight * DPR);

  const data = dataArrayRef.current;
  analyser.getByteFrequencyData(data);

  // Background glow
  const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, "rgba(99,102,241,0.05)");
  bgGrad.addColorStop(1, "rgba(236,72,153,0.05)");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // Bar settings
  const bars = 96; // more bars than before
  const step = Math.max(1, Math.floor(data.length / bars));
  const barW = Math.max(2, (W / bars) * 0.6);
  const gap = (W / bars) * 0.4;

  // Neon gradient for bars
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0.0, isPlaying ? "#60a5fa" : "#9ca3af"); // top (blue when playing)
  grad.addColorStop(0.6, isPlaying ? "#a78bfa" : "#9ca3af");
  grad.addColorStop(1.0, isPlaying ? "#f472b6" : "#9ca3af"); // bottom (pink)

  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const glow = Math.min(40, avg / 6);

  ctx.save();
  ctx.shadowBlur = glow;
  ctx.shadowColor = "rgba(236,72,153,0.55)";
  ctx.fillStyle = grad;

  for (let i = 0; i < bars; i++) {
    const v = data[i * step] / 255;
    const h = v * (H * 0.85) + H * 0.04;
    const x = i * (barW + gap);
    const y = H - h;

    // rounded rect
    const r = Math.min(12 * DPR, barW / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + barW, y, x + barW, y + h, r);
    ctx.arcTo(x + barW, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + barW, y, r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  rafRef.current = requestAnimationFrame(drawBars);
};

-------------------------- */
// Replace the existing drawBars with this:
// NeonWaveRing — continuous wavy circle with layered purple glow
const drawBars = () => {
  const analyser = analyserRef.current;
  const canvas   = canvasRef.current;
  if (!analyser || !canvas) return;

  const ctx = canvas.getContext("2d");
  const DPR = window.devicePixelRatio || 1;
  const W = (canvas.width  = Math.max(2, canvas.clientWidth)  * DPR);
  const H = (canvas.height = Math.max(2, canvas.clientHeight) * DPR);
  if (W < 4 || H < 4) { rafRef.current = requestAnimationFrame(drawBars); return; }

  // Use time-domain data for smooth, string-like motion
  const td = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(td);

  // Clear + soft radial backdrop
  ctx.clearRect(0, 0, W, H);
  const CX = W / 2, CY = H / 2;
  const minSide = Math.min(W, H);

  // Base ring and amplitude tuned for the screenshot vibe
  const baseR   = minSide * 0.33;             // base circle radius
  const ampMax  = minSide * 0.055;            // max wiggle from center
  const thickness = Math.max(2 * DPR, minSide * 0.010);

  // Build a smoothed 0..1 waveform from td[]
  // (centered around 0, lightly eased to reduce harsh jitter)
  const N = 256; // number of points around the circle
  const wave = new Array(N);
  for (let i = 0; i < N; i++) {
    const idx = Math.floor(i / N * td.length);
    const v = (td[idx] - 128) / 128;        // -1..1
    // light smoothing / easing
    wave[i] = Math.sign(v) * Math.pow(Math.abs(v), 0.7);
  }

  // Helper to draw one ring layer with offset & style
  const drawLayer = (phaseShift, alpha, extraAmp = 0, extraWidth = 0) => {
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const a = t * Math.PI * 2 + phaseShift;
      // sample wave with slight phase shift so layers don't overlap perfectly
      const j = (i + Math.floor((phaseShift / (Math.PI * 2)) * N)) % N;
      const w = wave[j];

      // smooth amplitude: base + audio + tiny breathing
      const amp = (ampMax + extraAmp) * (0.55 + 0.45 * Math.abs(w));
      const r = baseR + w * amp;

      const x = CX + Math.cos(a) * r;
      const y = CY + Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.lineWidth = thickness + extraWidth;
    ctx.strokeStyle = `rgba(167, 139, 250, ${alpha})`; // violet (#a78bfa)
    ctx.shadowBlur = 24;
    ctx.shadowColor = "rgba(139, 92, 246, 0.65)";      // indigo-violet glow
    ctx.stroke();
  };

  // Subtle time-based rotation so it slowly turns
  const t = performance.now() / 1000;
  const spin = t * 0.5; // radians/sec

  // Layer stack: inner bright core + two outer glows (slight phase offsets)
  drawLayer(spin + 0.00, 0.95, 0.0, 0.0);   // bright core
  drawLayer(spin + 0.20, 0.35, 6 * DPR, 1.0);
  drawLayer(spin - 0.18, 0.22, 10 * DPR, 2.0);

  // Optional thin white highlight to match the reference streaks
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const a = t * Math.PI * 2 + (spin + 0.05);
    const j = (i + Math.floor(((spin + 0.05) / (Math.PI * 2)) * N)) % N;
    const w = wave[j];
    const r = baseR + w * (ampMax * 0.45);
    const x = CX + Math.cos(a) * r;
    const y = CY + Math.sin(a) * r;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineWidth = thickness * 0.5;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.shadowBlur = 18;
  ctx.shadowColor = "rgba(168,85,247,0.55)";
  ctx.stroke();

  // Clean center cutout → crisp ring (donut)
  const cutR = baseR * 0.76;
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(CX, CY, cutR, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  rafRef.current = requestAnimationFrame(drawBars);
};







  const roundRect = (ctx, x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  const toggle = async () => {
  const el = audioRef.current;
  if (!el) return;
  try {
    if (audioCtxRef.current && audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
    if (el.paused) {
      await el.play();   // let 'play' event set isPlaying + start RAF
    } else {
      el.pause();        // let 'pause' event clear isPlaying + stop RAF
    }
  } catch {}
};

  const seekBy = (sec) => { const el = audioRef.current; if (!el) return; el.currentTime = Math.max(0, Math.min((el.currentTime || 0) + sec, el.duration || Infinity)); setCurrentTime(el.currentTime); };

  const progressPct = duration ? currentTime / duration : 0;
  const bufferedPct = duration ? bufferedEnd / duration : 0;

  const getPct = (clientX) => { const el = progressRef.current; if (!el) return 0; const rect = el.getBoundingClientRect(); const x = (clientX - rect.left) / rect.width; return Math.max(0, Math.min(1, x)); };
  const onDown = (e) => { draggingRef.current = true; const pct = getPct(e.clientX); if (!audioRef.current || !duration) return; audioRef.current.currentTime = pct * duration; setCurrentTime(audioRef.current.currentTime); window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp, { once: true }); };
  const onMove = (e) => { if (!draggingRef.current) return; const pct = getPct(e.clientX); if (!audioRef.current || !duration) return; audioRef.current.currentTime = pct * duration; setCurrentTime(audioRef.current.currentTime); };
  const onUp = () => { draggingRef.current = false; window.removeEventListener("mousemove", onMove); };

  const onHover = (e) => { setHoverPct(getPct(e.clientX)); setShowTooltip(true); };
  const onLeave = () => { setHoverPct(null); setShowTooltip(false); };

  const fmt = (s) => { if (!Number.isFinite(s)) return "0:00"; const m = Math.floor(s / 60); const ss = Math.floor(s % 60).toString().padStart(2, "0"); return `${m}:${ss}`; };
  const speedOptions = Array.from({ length: Math.round((3 - 0.5) / 0.25) + 1 }, (_, i) => Number((0.5 + i * 0.25).toFixed(2)));

  return (
  <div className="aurora-card p-[2px]">
    <AuroraStyles />
    <div className="rounded-3xl overflow-hidden bg-white/5 dark:bg-slate-950/40">

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr]">
        <div className="relative p-6 lg:p-8 border-b lg:border-b-0 lg:border-r border-slate-200/60 dark:border-slate-700/60">
          <div className="aspect-square rounded-2xl overflow-hidden bg-gradient-to-br from-indigo-100 to-sky-100 dark:from-indigo-900/30 dark:to-slate-900/30 flex items-center justify-center">
            {artwork && artOk ? (<img src={artwork} alt="Podcast artwork" className="w-full h-full object-cover" onError={() => setArtOk(false)} />) : (<div className="text-6xl">🎙️</div>)}
          </div>
          <div className="mt-4 h-48 md:h-64 rounded-xl overflow-hidden border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-900/40">
  <canvas ref={canvasRef} className="w-full h-full block" />
</div>


        </div>
        <div className="p-6 lg:p-8">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide opacity-60">Now Playing</div>
              <div className="text-xl font-semibold truncate">{title}</div>


    
            </div>
          </div>

          <div className="mt-5 flex items-center justify-center gap-4">
            <IconButton label="Back 10s" onClick={() => seekBy(-10)}><IconRewind /></IconButton>
            <button onClick={toggle} className={`relative grid place-items-center w-20 h-20 rounded-full shadow-lg transition-all duration-150 active:scale-95 ${isPlaying ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500"} text-white`} aria-label={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? <IconPause /> : <IconPlay />}
            </button>
            <IconButton label="Forward 10s" onClick={() => seekBy(10)}><IconForward /></IconButton>
          </div>

          <div className="mt-6">
            <div
              ref={progressRef}
              className="relative h-4 rounded-full bg-slate-200 dark:bg-slate-800 cursor-pointer group"
              onMouseDown={onDown}
              onMouseMove={onHover}
              onMouseLeave={onLeave}
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-slate-300/80 dark:bg-slate-700/80" style={{ width: `${bufferedPct * 100}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-indigo-500" style={{ width: `${progressPct * 100}%` }} />
              <div className="absolute -top-1.5 -translate-x-1/2 w-7 h-7 rounded-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 shadow opacity-0 group-hover:opacity-100 transition" style={{ left: `${progressPct * 100}%` }} />
              {hoverPct != null && <div className="absolute inset-y-[-6px] w-[2px] bg-black/40 dark:bg-white/40" style={{ left: `${hoverPct * 100}%` }} />}
              {showTooltip && hoverPct != null && (
                <div className="absolute -top-9 -translate-x-1/2 px-2 py-1 rounded bg-black text-white text-[11px]" style={{ left: `${hoverPct * 100}%` }}>
                  {fmt(hoverPct * duration)}
                </div>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between text-sm opacity-75">
              <div>{fmt(currentTime)}</div>
              <div>{fmt(duration)}</div>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-center gap-3">
              <label className="text-sm">Speed</label>
              <select value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800">
                {speedOptions.map((s) => (<option key={s} value={s}>{s}×</option>))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                className="px-3 py-2 rounded-xl border hover:bg-slate-100 dark:hover:bg-slate-800"
                onClick={() => setMuted((m) => !m)}
                title={muted ? "Unmute" : "Mute"}
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
              </button>
              <input
                type="range" min="0" max="1" step="0.01"
                value={muted ? 0 : volume}
                onChange={(e) => setVolume(Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)))}
                className="w-44 accent-indigo-600"
                aria-label="Volume"
              />
            </div>
          </div>


          <div className="mt-4 text-[11px] opacity-60">
  Shortcuts: <b>Space/K</b> play-pause • <b>A/◀</b> −10s • <b>D/▶</b> +10s • <b>M</b> mute
</div>

{activeWeek?.podcasts?.length > 1 && (
  <div className="mt-3 flex flex-wrap gap-2">
    {activeWeek.podcasts.map((p, i) => {
            const raw = typeof p === "string"
        ? p
        : (p.src ?? p.url ?? p.path ?? p.file ?? p.audio ?? p.href ?? p.mp3 ?? p.source ?? p.link ?? p.uri);

      const label =
        (typeof p === "string"
          ? filenameToTitle(p)
          : (p.title ?? p.name ?? filenameToTitle(raw)))
        ?? `Podcast ${i+1}`;

      return (
        <button
          key={label + i}
          onClick={() => onPickPodcast?.(i)}
          className={`px-3 py-1.5 rounded-full text-sm border transition
            ${i === podIndex
              ? "bg-violet-600 text-white border-violet-500"
              : "bg-white/10 dark:bg-slate-900/40 border-slate-300/40 dark:border-slate-700/50 hover:bg-white/20 dark:hover:bg-slate-800/60"}`}
          aria-pressed={i === podIndex}
          title={label}
        >
          {label}
        </button>
      );
    })}
  </div>
)}




        </div>
      </div>
            <audio ref={audioRef} src={src} preload="metadata" />
    </div>
  </div>
);

}

/* =================== App =================== */
export default function LegacyApp({ activeWeek }) {
  /* Theme & accessibility */
  const [dark, setDark] = useState(() => JSON.parse(localStorage.getItem("mq_dark") ?? "true"));
  const [highVis, setHighVis] = useState(() => JSON.parse(localStorage.getItem("mq_highvis") ?? "false"));
  useEffect(() => {
    document.documentElement.classList.toggle("dark", !!dark);
    localStorage.setItem("mq_dark", JSON.stringify(dark));
  }, [dark]);
  useEffect(() => {
    document.documentElement.setAttribute("data-highvis", highVis ? "true" : "false");
    localStorage.setItem("mq_highvis", JSON.stringify(highVis));
    if (highVis) {
      document.documentElement.style.setProperty("--ring-fg", "#22c55e");
      document.documentElement.style.setProperty("--ring-bg", dark ? "#1f2937" : "#e5e7eb");
    } else {
      document.documentElement.style.removeProperty("--ring-fg");
      document.documentElement.style.removeProperty("--ring-bg");
    }
  }, [highVis, dark]);

  // Which podcast is active in this week
const [podIndex, setPodIndex] = useState(0);
useEffect(() => { setPodIndex(0); }, [activeWeek]); // reset when week changes

// --- helpers ---
const resolveSrc = (s) => {
  if (!s || typeof s !== "string") return undefined;
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;      // full URL or absolute path
  return `${BASE}data/${s}`;                                        // relative filename -> /medquest/data/...
};
const resolveImg = (s) => {
  if (!s || typeof s !== "string") return undefined;
  if (/^https?:\/\//i.test(s) || s.startsWith("/")) return s;
  return `${BASE}data/${s}`;
};
const filenameToTitle = (path) => {
  const name = (path || "").split("/").pop();
  return name
    ? name.replace(/\.(mp3|m4a|wav|aac|ogg)$/i, "").replace(/[_-]+/g, " ").trim()
    : null;
};

// Accepts either a plain string or an object with various legacy keys
const pickPod = (p) => {
  if (!p) return null;

  // If item is just a string (e.g., "episode1.mp3")
  if (typeof p === "string") {
    return {
      title: filenameToTitle(p) || "Podcast",
      src: resolveSrc(p),
      artwork: undefined,
    };
  }

  // Try many possible audio URL keys used across weeks/legacy data
  let rawSrc =
    p.src ?? p.url ?? p.path ?? p.file ?? p.audio ?? p.href ??
    p.mp3 ?? p.source ?? p.link ?? p.uri;

  // Last-resort: scan any string field that looks like an audio file/URL
  if (!rawSrc) {
    const cand = Object.values(p).find(
      (v) => typeof v === "string" && /(\.mp3|\.m4a|\.aac|\.wav|\.ogg)(\?|$)/i.test(v)
    );
    if (cand) rawSrc = cand;
  }

  const title =
    p.title ?? p.name ?? filenameToTitle(rawSrc) ?? "Podcast";

  const art =
    p.artwork ?? p.image ?? p.cover ?? p.thumb ?? p.poster ?? p.art;

  return {
    title,
    src: resolveSrc(rawSrc),
    artwork: resolveImg(art),
  };
};


const pod =
  pickPod(activeWeek?.podcasts?.[podIndex]) ?? {
    title: "Podcast",
    src: `${BASE}data/Unraveling_Cancer__From_Molecular_Code_to_Personalized_Cures.mp3`,
    artwork: `${BASE}data/podcast_art.jpg`,
  };




  /* Data state */
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [notesIndex, setNotesIndex] = useState(null);
  const [regularIdx, setRegularIdx] = useState(null);
  const [longIdx, setLongIdx] = useState(null);

  /* UI state */
  const [tab, setTab] = useState(() => {
    try {
      const saved = localStorage.getItem("mq_tab");
      if (saved) return saved;
    } catch {}
    if (typeof window !== "undefined" && window.location.hash) {
      return window.location.hash.replace(/^#/, "");
    }
    return "topics";
  });


// Which list to show inside Review: "missed" | "retested"
const [reviewView, setReviewView] = useState(() => {
  try {
    return localStorage.getItem("mq_review_view") || "missed";
  } catch {
    return "missed";
  }
});

// Persist selection so it survives reload
useEffect(() => {
  try {
    localStorage.setItem("mq_review_view", reviewView);
  } catch {}
}, [reviewView]);


  useEffect(() => {
    try { localStorage.setItem("mq_tab", tab); } catch {}
    if (typeof window !== "undefined") {
      const h = "#" + tab;
      if (window.location.hash !== h) {
        window.history.replaceState(null, "", h);
      }
    }
  }, [tab]);

  useEffect(() => {
    const onHash = () => {
      const h = (window.location.hash || "").replace(/^#/, "");
      if (h && h !== tab) setTab(h);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [tab]);

  /* Explore OFF by default */
  const [explore, setExplore] = useState(() => JSON.parse(localStorage.getItem("mq_explore") ?? "false"));
  useEffect(() => localStorage.setItem("mq_explore", JSON.stringify(explore)), [explore]);

  /* Timer for quizzes (config in builder; re-used by Battle) */
  const [timerOn, setTimerOn] = useState(() => JSON.parse(localStorage.getItem("mq_timer_on") ?? "false"));
  const [secPerQ, setSecPerQ] = useState(() => JSON.parse(localStorage.getItem("mq_sec_per_q") ?? "75"));
  useEffect(() => localStorage.setItem("mq_timer_on", JSON.stringify(timerOn)), [timerOn]);
  useEffect(() => localStorage.setItem("mq_sec_per_q", JSON.stringify(secPerQ)), [secPerQ]);

  /* Difficulty multi-select (used by Vignettes builder) */
  const [diffSet, setDiffSet] = useState(() => JSON.parse(localStorage.getItem("mq_diffset") ?? '["easy","medium","hard"]'));
  useEffect(() => localStorage.setItem("mq_diffset", JSON.stringify(diffSet)), [diffSet]);

  /* Unlocks, stats, missed store */
  const [topicUnlocks, setTopicUnlocks] = useState(() => JSON.parse(localStorage.getItem("mq_topic_unlocks") ?? "[]"));
  useEffect(() => localStorage.setItem("mq_topic_unlocks", JSON.stringify(topicUnlocks)), [topicUnlocks]);

  const [stats, setStats] = useState(() => JSON.parse(localStorage.getItem("mq_stats") ?? '{"subs":{},"quizzes":[]}'));
  useEffect(() => localStorage.setItem("mq_stats", JSON.stringify(stats)), [stats]);

  const [missed, setMissed] = useState(() => JSON.parse(localStorage.getItem("mq_missed") ?? "{}"));
  useEffect(() => localStorage.setItem("mq_missed", JSON.stringify(missed)), [missed]);

  // Track questions that were missed but later answered correctly on retest
const [retested, setRetested] = useState({});

// Load retested from localStorage on mount
useEffect(() => {
  try {
    const raw = localStorage.getItem("mq_retested");
    setRetested(raw ? JSON.parse(raw) : {});
  } catch {}
}, []);

// Persist retested to localStorage whenever it changes
useEffect(() => {
  try {
    localStorage.setItem("mq_retested", JSON.stringify(retested || {}));
  } catch {}
}, [retested]);

// === Confirm Clear modal state + helpers ===
const [confirmClear, setConfirmClear] = useState({ open: false, type: null }); // "missed" | "retested"

const requestClear = (type) => setConfirmClear({ open: true, type });
const cancelClear = () => setConfirmClear({ open: false, type: null });

const performClear = () => {
  const type = confirmClear.type;
  try {
    if (type === "missed") {
      setMissed({});
      localStorage.removeItem("mq_missed");
    } else if (type === "retested") {
      setRetested({});
      localStorage.removeItem("mq_retested");
    }
  } catch {}
  cancelClear();
};


  /* Tutorial */
  const [showTut, setShowTut] = useState(true);
  
  const tutSteps = [
    { title: "Welcome", text: "Quick tour! I’ll highlight each area so you know what it does." },
    { id: "pill-highvis", tab: "topics", title: "High-Vis Mode", text: "Toggle extra-contrast visuals for sharper, color-blind–friendly cues." },
    { id: "pill-dark", tab: "topics", title: "Dark Mode", text: "Flip the theme instantly." },
    { id: "pill-explore", tab: "topics", title: "Explore Mode", text: "Turn ON to freely browse all topics. Turn OFF to require unlocks." },
    { id: "nav-topics", tab: "topics", title: "Topics", text: "Browse topic cards. Learn, Battle, and track progress." },
    { id: "topics-grid", tab: "topics", title: "Topic Cards", text: "Each card shows your progress. Use Learn to study or Battle to quiz." },
    { id: "btn-learn", tab: "topics", title: "Learn", text: "Open structured notes, ELI5 blocks, mnemonics, and connections by subtopic." },
    { id: "btn-battle", tab: "topics", title: "Battle", text: "Timed 10Q quiz. Win 3 in a row to unlock the next topic when Explore is OFF." },
    { id: "btn-subtopics", tab: "topics", title: "Subtopics", text: "See subtopic stats and jump straight to Learn, Battle, or Vignette." },
    { id: "nav-vignettes", tab: "vignettes", title: "Clinical Vignettes", text: "Build custom long-form vignette quizzes across subtopics." },
    { id: "pill-timer", tab: "vignettes", title: "Timer & Seconds", text: "Toggle the timer and adjust seconds per question for all quizzes." },
    { id: "btn-start-vignette", tab: "vignettes", title: "Start Vignette Quiz", text: "Pick subs & difficulty filters, then launch a vignette-only quiz." },
    { id: "nav-review", tab: "review", title: "Review", text: "All missed questions live here. Relearn or retest by topic/subtopic." },
    { id: "mq-review", tab: "review", title: "Retesting", text: "Use Retest buttons to drill your weak spots; progress rings show accuracy." },
    { id: "nav-podcast", tab: "podcast", title: "Podcast", text: "Listen to the built‑in podcast player with live visualizer and speed control." },
    { id: "mq-podcast", tab: "podcast", title: "Player Controls", text: "Play/pause, jump 10s, set playback speed, and adjust volume/mute." },
    { id: "btn-open-tutorial", title: "Reopen Tutorial", text: "You can always bring this guide back from the bottom-left button." }
  ];

  const [tutIdx, setTutIdx] = useState(0);
  const spot = useSpotlight(showTut ? tutSteps[tutIdx]?.id : null, `${tab}-${tutIdx}`);

  useEffect(() => {
    if (!showTut) return;
    const desired = tutSteps[tutIdx]?.tab;
    if (desired && desired !== tab) setTab(desired);
  }, [showTut, tutIdx]); // eslint-disable-line

  const endTutorial = () => {
    setShowTut(false);
  };

  /* Load data */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        async function fetchFirst(urls) {
  let lastErr = null;
  for (const u of urls) {
    try { return await fetchJSON(u); } catch (e) { lastErr = e; console.warn("Failed fetch:", u, e); }
  }
  throw lastErr || new Error("All long-layer sources failed.");
}
const [notes, reg, lng] = await Promise.all([
  fetchJSON(NOTES_URL),
  fetchJSON(REGULAR_QBANK_URL),
  fetchFirst(LONG_QBANK_URLS),
]);
        if (!alive) return;

        const nIdx = buildNotesIndex(notes);
        const rIdx = buildQuestionIndex(reg, "questions");
        const lIdx = buildQuestionIndex(lng, "long_questions");

        setNotesIndex(nIdx);
        setRegularIdx(rIdx);
        setLongIdx(lIdx);

        const prior = JSON.parse(localStorage.getItem("mq_topic_unlocks") ?? "[]");
        if (!prior.length && nIdx.topicList.length) setTopicUnlocks([nIdx.topicList[0].name]);
      } catch (e) {
        setErr(e.message || String(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const canonTopics = useMemo(() => notesIndex?.topicList ?? [], [notesIndex]);
  const isTopicUnlocked = (title) => explore || topicUnlocks.includes(title) || (canonTopics[0]?.name === title);

  /* Helpers */
  const subsForDisplay = (topicName) => {
  const tNorm = normTopicWithAlias(topicName);

  const noteSubsMap = notesIndex?.topicMap.get(tNorm)?.subMap ?? new Map();
  const namesFromNotes = new Set([...noteSubsMap.values()].map(s => s.name));

  const regMap  = regularIdx?.get(tNorm) ?? new Map();
  const longMap = longIdx?.get(tNorm) ?? new Map();

  const namesFromReg = new Set([...regMap.keys()].map(k => {
    for (const [, s] of noteSubsMap) if (norm(s.name) === k) return s.name;
    const arr = regMap.get(k) || [];
    return (arr[0]?.subtopic) || k;
  }));

  const namesFromLong = new Set([...longMap.keys()].map(k => {
    for (const [, s] of noteSubsMap) if (norm(s.name) === k) return s.name;
    const arr = longMap.get(k) || [];
    return (arr[0]?.subtopic) || k;
  }));

  const allNames = new Set([...namesFromNotes, ...namesFromReg, ...namesFromLong]);

  const out = [];
  for (const name of allNames) {
    const sNorm = norm(name);
    const regCnt  = (regularIdx?.get(tNorm)?.get(sNorm) ?? []).length;
    const longCnt = (longIdx?.get(tNorm)?.get(sNorm) ?? []).length;
    const node = noteSubsMap.get(sNorm) ?? null;
    out.push({
      name,
      content: node?.content ?? "",
      slide_reference: node?.slide_reference ?? "",
      _hasReg: regCnt,
      _hasLong: longCnt,
    });
  }

  out.sort((a, b) => {
    const aAny = (a._hasReg + a._hasLong > 0) || !!a.content;
    const bAny = (b._hasReg + b._hasLong > 0) || !!b.content;
    if (aAny !== bAny) return aAny ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return out;
};

  const subStats = (t, s) => stats.subs[`${t}|${s}`] || { attempted: 0, correct: 0 };

  const pctTopic = (t) => {
    const subs = subsForDisplay(t).map((s) => s.name);
    const { correct, total } = subs.reduce(
      (acc, s) => {
        const rec = subStats(t, s);
        acc.correct += rec.correct;
        acc.total += rec.attempted;
        return acc;
      },
      { correct: 0, total: 0 }
    );
    return { pct: total ? correct / total : 0, correct, total };
  };
  const pctSub = (t, s) => {
    const rec = subStats(t, s);
    return rec.attempted ? rec.correct / rec.attempted : 0;
  };
  const doneSub = (t, s) => subStats(t, s).attempted;

  /* Learn navigator */
  const [learnNav, setLearnNav] = useState(null);
  const openLearnNav = (topic, sub = null) => {
    const subs = subsForDisplay(topic);
    const idx = sub ? Math.max(0, subs.findIndex((x) => x.name === sub)) : 0;
    setLearnNav({ topic, subs, index: idx < 0 ? 0 : idx });
  };
  const subNode = (topic, sub) => {
  const node = notesIndex?.topicMap
    .get(normTopicWithAlias(topic))
    ?.subMap.get(norm(sub));
  if (!node) return null;
  return {
    ...node,
    content: node.content || "",
    explain_like_i_am_stupid:
      node._raw?.explain_like_i_am_stupid || node._raw?.eli5 || "",
    mnemonic: node._raw?.mnemonic || "",
    clinical_pearl: node._raw?.clinical_pearl || "",
    slide_reference: node.slide_reference || "",
  };
};


  /* Subtopics popup (from topic tile) */
  const [subsTopic, setSubsTopic] = useState(null);

  /* Quiz session */
  const [quiz, setQuiz] = useState(null);
  const [timeLeft, setTimeLeft] = useState(null);
  const currentQ = () => (quiz ? quiz.items[quiz.idx] : null);

  /* Topic battle unlock streak */
  const [topicProgress, setTopicProgress] = useState({});

  /* Timer ticking (per-question, only when unlocked=false for that item) */
  useEffect(() => {
    if (!quiz || !quiz.timerOn || quiz.stage !== "live") return;
    const cur = quiz.answers[quiz.idx];
    if (!cur || cur.locked) return;

    let t = Number(quiz.secPerQ) || 60;
    const id = setInterval(() => {
      t -= 1;
      setTimeLeft(t);
      if (t <= 0) {
        clearInterval(id);
        const q = currentQ();
        if (q) {
          record(q, false);
          const answers = [...quiz.answers];
          answers[quiz.idx] = { picked: cur.picked, locked: true, correct: false };
          setQuiz((s) => ({ ...s, answers, reveal: true, softHide: false }));
        }
      }
    }, 1000);

    setTimeLeft(t);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quiz?.idx, quiz?.stage, quiz?.timerOn, quiz?.secPerQ]);

  /* Pools */
  const poolBattle = (t, s = null) => {
    const tKey = normTopicWithAlias(t);
    if (s) {
      const reg = regularIdx?.get(tKey)?.get(norm(s)) ?? [];
      if (reg.length) return reg;
      const lng = longIdx?.get(tKey)?.get(norm(s)) ?? [];
      return lng;
    }
    const subs = subsForDisplay(t).map((x) => x.name);
    const arr = [];
    for (const su of subs) {
      let piece = regularIdx?.get(tKey)?.get(norm(su)) ?? [];
      if (!piece.length) piece = longIdx?.get(tKey)?.get(norm(su)) ?? [];
      arr.push(...piece);
    }
    return arr;
  };
  const poolVignettes = (t, s = null) => {
    const tKey = normTopicWithAlias(t);
    const chosen = new Set(Array.isArray(diffSet) && diffSet.length ? diffSet : ["easy", "medium", "hard"]);
    const pick = (arr) => arr.filter((q) => chosen.has(q.difficulty));
    if (s) return pick(longIdx?.get(tKey)?.get(norm(s)) ?? []);
    const subs = subsForDisplay(t).map((x) => x.name);
    const arr = [];
    for (const su of subs) {
      const piece = longIdx?.get(tKey)?.get(norm(su)) ?? [];
      arr.push(...pick(piece));
    }
    return arr;
  };

  const battleLen = 10;

  const qid = (q) =>
    `${norm(q.topic)}__${norm(q.subtopic)}__${norm(q.stem).slice(0, 60)}`;

  const startBattle = (t, s = null) => {
    if (!isTopicUnlocked(t)) {
      alert("Locked. Win a topic Battle (3-in-a-row) to unlock the next topic.");
      return;
    }
    const tKey = normTopicWithAlias(t);
    let pool = poolBattle(t, s);
    if (!pool.length) {
      const tMap = regularIdx?.get(tKey);
      const first = tMap ? [...tMap.values()].find((a) => Array.isArray(a) && a.length) : null;
      pool = first || [];
    }
    if (!pool.length) {
      // Fallback to long-form pool if regular bank is empty
      const longPool = poolVignettes(t, s);
      if (longPool.length) pool = longPool;
    }
    if (!pool.length) {
      const lMap = longIdx?.get(tKey);
      const firstL = lMap ? [...lMap.values()].find((a) => Array.isArray(a) && a.length) : null;
      pool = firstL || [];
    }
    if (!pool.length) {
      alert("No questions for this selection yet.");
      return;
    }
    const pick = pool
      .map((q, i) => ({ q, sort: Math.random() + i / 1e6 }))
      .sort((a, b) => a.sort - b.sort)
      .slice(0, Math.min(pool.length, battleLen))
      .map((x) => x.q);

    startCustomQuiz(pick, t, s, pick.length, { mode: "battle" });
  };

  const startCustomQuiz = (items, title, sub = null, n = 10) => {
    if (!items.length) {
      alert("No questions selected.");
      return;
    }
    const arr = items
      .sort(() => Math.random() - 0.5)
      .slice(0, n)
      .map((q) => ({ ...q, _id: qid(q) }));
    setQuiz({
      mode: "quiz",
      topic: title,
      sub,
      items: arr,
      idx: 0,
      stage: "live",
      answers: arr.map(() => ({ picked: null, locked: false, correct: null })),
      answer: null,
      reveal: false,
      softHide: false,
      correctCount: 0,
      timerOn,
      secPerQ,
    });
  };

  const startVignette = (t, s = null) => {
    const tKey = normTopicWithAlias(t);
    let pool = poolVignettes(t, s);
    if (!pool.length) {
      const tMap = longIdx?.get(tKey);
      const first = tMap ? [...tMap.values()].find((a) => Array.isArray(a) && a.length) : null;
      pool = first || [];
    }
    if (!pool.length) {
      alert("No vignettes for this selection yet.");
      return;
    }
    startCustomQuiz(pool, "Clinical Vignettes", s, Math.min(10, pool.length));
  };

  const record = (q, correct) => {
  // keep your stats logic the same
  setStats((prev) => {
    const key = `${q.topic}|${q.subtopic}`;
    const rec = prev.subs[key] || { attempted: 0, correct: 0 };
    const next = { ...prev };
    next.subs[key] = {
      attempted: rec.attempted + 1,
      correct: rec.correct + (correct ? 1 : 0),
    };
    return next;
  });

  const wk = activeWeek?.id || activeWeek?.slug || activeWeek?.name || "unknown-week";
  const id = qid(q);

  if (!correct) {
    // Save as missed, stamped with weekId (used by Review filtering)
    const enriched = { ...q, weekId: wk };
    setMissed((prev) => ({ ...(prev || {}), [id]: enriched }));
    return;
  }

  // If answered correctly AND it was previously missed,
  // move from "missed" -> "retested"
  setMissed((prevMissed) => {
    if (!prevMissed || !prevMissed[id]) return prevMissed;
    const moved = {
      ...prevMissed[id],
      weekId: prevMissed[id].weekId || wk,
      retestedAt: Date.now(),
    };
    setRetested((prev) => ({ ...(prev || {}), [id]: moved }));
    const { [id]: _removed, ...rest } = prevMissed;
    return rest;
  });
};

// === Quiz handlers (must be defined before JSX that uses them) ===
const lockIn = () => {
  if (!quiz) return;
  const q = currentQ();
  const ai = quiz.answers[quiz.idx];
  if (!q || ai.locked || quiz.answer == null) return;

  const correct = quiz.answer === q.answer;
  record(q, correct);

  // battle streak + unlocks
  if (!explore && quiz.mode === "battle" && !quiz.sub) {
    setTopicProgress((prev) => {
      const st = correct ? (prev[q.topic] || 0) + 1 : 0;
      const np = { ...prev, [q.topic]: st };
      if (st >= 3) {
        const idx = canonTopics.findIndex((tt) => tt.name === q.topic);
        const nextTopic = canonTopics[idx + 1]?.name;
        if (nextTopic) {
          setTopicUnlocks((u) => (u.includes(nextTopic) ? u : [...u, nextTopic]));
        }
        np[q.topic] = 0; // reset streak after unlock
      }
      return np;
    });
  }

  const answers = [...quiz.answers];
  answers[quiz.idx] = { picked: quiz.answer, locked: true, correct };
  setQuiz((s) => ({
    ...s,
    answers,
    reveal: true,
    softHide: false,
    correctCount: s.correctCount + (correct ? 1 : 0),
  }));
};

const finishQuiz = () => {
  if (!quiz) return;
  setStats((prev) => ({
    ...prev,
    quizzes: [
      ...(prev.quizzes || []),
      { title: quiz.topic, total: quiz.items.length, correct: quiz.correctCount, ts: Date.now() },
    ],
  }));
  setQuiz(null);
  setTopicProgress({});
};

const nextQ = () => {
  if (!quiz) return;
  const isLast = quiz.idx >= quiz.items.length - 1;
  if (isLast) {
    setQuiz((s) => ({ ...s, stage: "review" }));
    return;
  }
  const newIdx = quiz.idx + 1;
  const ans = quiz.answers[newIdx];
  setQuiz((s) => ({
    ...s,
    idx: newIdx,
    reveal: false,
    softHide: false,
    answer: ans?.picked ?? null,
  }));
};

const prevQ = () => {
  if (!quiz) return;
  const newIdx = Math.max(0, quiz.idx - 1);
  const ans = quiz.answers[newIdx];
  setQuiz((s) => ({
    ...s,
    idx: newIdx,
    reveal: false,
    softHide: true,
    answer: ans?.picked ?? null,
  }));
};

  /* Clinical Vignettes builder UI */
  const [cvExpanded, setCvExpanded] = useState({}); // { topicName: boolean }
  const [cvSel, setCvSel] = useState({}); // { [topicName]: Set(subNames) }
  const [cvPick, setCvPick] = useState({ subs: new Set(), count: 10 });

  /* Loading / errors */
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 dark:bg-slate-900 text-slate-700 dark:text-slate-100">
        Loading…
      </div>
    );
  }
  if (err) {
    return <div className="p-6 text-rose-600">Failed to load data: {err}</div>;
  }

  return (
    <div className={`min-h-screen ${highVis ? "text-slate-900 dark:text-slate-50" : "text-slate-800 dark:text-slate-100"} bg-slate-50 dark:bg-slate-900`}>
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur bg-white/80 dark:bg-slate-900/80 border-b border-slate-200 dark:border-slate-800">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4">
          <div className={`flex items-center gap-2 font-black text-2xl tracking-tight ${highVis ? "text-emerald-500" : "text-indigo-600 dark:text-indigo-400"}`}>
            🩺 MedQuest
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Pill id="pill-highvis" active={highVis} onClick={() => setHighVis((v) => !v)}>
              High-Vis: <b className="ml-1">{highVis ? "ON" : "OFF"}</b>
            </Pill>
            <Pill id="pill-dark" active={dark} onClick={() => setDark((v) => !v)}>
              Dark: <b className="ml-1">{dark ? "ON" : "OFF"}</b>
            </Pill>
            <Pill id="pill-explore" active={explore} onClick={() => setExplore((v) => !v)}>
              Explore: <b className="ml-1">{explore ? "ON" : "OFF"}</b>
            </Pill>
          </div>
        </div>
      </header>

      {/* Layout with LEFT ICON NAV (old placement, new icons) */}
      <div className="mx-auto max-w-7xl grid grid-cols-[240px,1fr] gap-6 px-4 py-6">
        {/* Left nav */}
        <aside className="sticky self-start top-[80px] h-fit space-y-2">
          <NavIcon id="nav-topics" label="Topics" active={tab === "topics"} onClick={() => setTab("topics")} icon="📚" />
          <NavIcon id="nav-vignettes" label="Clinical Vignettes" active={tab === "vignettes"} onClick={() => setTab("vignettes")} icon="🧪" />
          <NavIcon id="nav-review" label="Review" active={tab === "review"} onClick={() => setTab("review")} icon="🔁" />
          <NavIcon id="nav-podcast" label="Podcast" active={tab === "podcast"} onClick={() => setTab("podcast")} icon="🎙️" />
        </aside>

        {/* Main content */}
        <main>
          {/* ================= TOPICS PAGE ================= */}
          {tab === "topics" && (
            <div id="topics-grid" className="mq-topic-grid grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {canonTopics.map((t) => {
                const unlocked = isTopicUnlocked(t.name);
                const subList = subsForDisplay(t.name);
                const totalAvail = (() => {
  const seen = new Set();
  subList.forEach((s) => {
    const regQs  = regularIdx?.get(normTopicWithAlias(t.name))?.get(norm(s.name)) || [];
    const longQs = longIdx?.get(normTopicWithAlias(t.name))?.get(norm(s.name)) || [];
    [...regQs, ...longQs].forEach((q) => {
      const key = q.id || q.qid || q._id || JSON.stringify(q.stem);
      seen.add(key);
    });
  });
  return seen.size;
})();

                const totalDone = subList.reduce((a, s) => a + doneSub(t.name, s.name), 0);
                const { pct, correct, total } = pctTopic(t.name);
                return (
                  <Card key={t.name}>
                    <div className="flex items-start gap-3">
                      <h3 className={`text-xl font-extrabold flex-1 ${highVis ? "text-emerald-400" : ""}`}>{t.name}</h3>
                      {/* BIG dynamic circle with centered percent + numbers below */}
                      <HoverBiRing correct={correct} attempted={total} size={65} />
                    </div>
                    <div className="text-xs opacity-70 mt-1">
                      {totalDone} completed • {totalAvail} available
                    </div>

                    <div className="grid grid-cols-2 gap-3 mt-5">
                      <div
                        className={`cursor-pointer rounded-xl px-4 py-3 border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 hover:shadow flex items-center gap-2 transition-transform hover:-translate-y-0.5 ${
                          !unlocked ? "opacity-60 pointer-events-none" : ""
                        }`}
                        onClick={() => openLearnNav(t.name)} id="btn-learn"
                      >
                        <div className="font-bold">📖 Learn</div>
                      </div>
                      <div
                        className={`cursor-pointer rounded-xl px-4 py-3 border border-indigo-600 text-white hover:shadow flex items-center gap-2 transition-transform hover:-translate-y-0.5`}
                        style={{ backgroundImage: "linear-gradient(90deg, #ff6bd6, #705cff)" }}
                        onClick={() => startBattle(t.name, null)} id="btn-battle"
                      >
                        <div className="font-bold">⚔️ Battle</div>
                      </div>
                    </div>

                    <div className="mt-4">
                      <Btn id="btn-subtopics" kind="outline" onClick={() => setSubsTopic(t)} disabled={!unlocked}>
                        Subtopics
                      </Btn>
                      {!unlocked && <span className="ml-2 text-xs opacity-70">Locked — win 3-in-a-row in Battle to unlock.</span>}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ================= CLINICAL VIGNETTES PAGE ================= */}
{tab === "vignettes" && (
  <div className="space-y-4">
    {canonTopics.map((t) => {
      const tKey = normTopicWithAlias(t.name);
      const subs = subsForDisplay(t.name);

      // active difficulty set
      const chosen = new Set(
        Array.isArray(diffSet) && diffSet.length ? diffSet : ["easy", "medium", "hard"]
      );

      // ✅ Include BOTH reg + long, and apply difficulty
      const subsFiltered = subs.filter((s) => {
        const regQs  = (regularIdx?.get(tKey)?.get(norm(s.name)) || []);
        const longQs = (longIdx?.get(tKey)?.get(norm(s.name)) || []);
        const cnt = [...regQs, ...longQs].filter(q => chosen.has(q.difficulty)).length;
        return cnt > 0;
      });

      const displayedNames = new Set(subsFiltered.map(s => s.name));

      const avail = (() => {
  const seen = new Set();
  subsFiltered.forEach((s) => {
    const regQs  = (regularIdx?.get(tKey)?.get(norm(s.name)) || []);
    const longQs = (longIdx?.get(tKey)?.get(norm(s.name)) || []);
    [...regQs, ...longQs].forEach((q) => {
      if (chosen.has(q.difficulty)) {
        const key = q.id || q.qid || q._id || JSON.stringify(q.stem);
        seen.add(key);
      }
    });
  });
  return seen.size;
})();


      const attempted = subs.reduce((a, s) => a + (subStats(t.name, s.name)?.attempted || 0), 0);
      const { correct, total } = pctTopic(t.name);
      const expanded = !!cvExpanded[t.name];
      const selectedSet = cvSel[t.name] || new Set();

      const toggleExpand = () =>
        setCvExpanded((m) => ({ ...m, [t.name]: !expanded }));

      const selectAll = () => {
        const all = new Set(subsFiltered.map(s => s.name));
        setCvSel((m) => ({ ...m, [t.name]: all }));
      };

      const clearAll = () =>
        setCvSel((m) => ({ ...m, [t.name]: new Set() }));

      const toggleSub = (name) => {
        if (!displayedNames.has(name)) return;
        setCvSel((m) => {
          const cur = new Set(m[t.name] || []);
          if (cur.has(name)) cur.delete(name);
          else cur.add(name);
          return { ...m, [t.name]: cur };
        });
      };

      const selectedCount = selectedSet.size;

      // ✅ Count with difficulty applied
      const selectedQs = (() => {
        let c = 0;
        selectedSet.forEach(n => {
          if (displayedNames.has(n)) {
            const regQs  = (regularIdx?.get(tKey)?.get(norm(n)) || []);
            const longQs = (longIdx?.get(tKey)?.get(norm(n)) || []);
            c += [...regQs, ...longQs].filter(q => chosen.has(q.difficulty)).length;
          }
        });
        return c;
      })();

      // ✅ Start quiz with difficulty filter
      const startFromSelected = () => {
        const arr = [];
        if (selectedSet.size > 0) {
          selectedSet.forEach(n => {
            const regQs  = (regularIdx?.get(tKey)?.get(norm(n)) || []);
            const longQs = (longIdx?.get(tKey)?.get(norm(n)) || []);
            arr.push(...[...regQs, ...longQs].filter(q => chosen.has(q.difficulty)));
          });
        } else {
          for (const [, subMap] of (regularIdx?.get(tKey) || new Map()).entries()) {
            for (const qs of subMap.values()) {
              arr.push(...qs.filter(q => chosen.has(q.difficulty)));
            }
          }
          for (const [, subMap] of (longIdx?.get(tKey) || new Map()).entries()) {
            for (const qs of subMap.values()) {
              arr.push(...qs.filter(q => chosen.has(q.difficulty)));
            }
          }
        }
        startCustomQuiz(arr, `Clinical Vignettes — ${t.name}`, null, Math.min(cvPick.count, arr.length || 10));
      };

      return (
        <div
          key={t.name}
          className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow hover:shadow-xl transition-transform hover:-translate-y-0.5"
        >
          <button onClick={toggleExpand} className="w-full text-left flex items-center gap-3 p-3">
            <div className={`font-semibold flex-1 ${highVis ? "text-emerald-400" : ""}`}>{t.name}</div>
            <div className="text-xs opacity-70 mr-2">
              {attempted} done • {avail} avail
            </div>
            <HoverBiRing correct={correct} attempted={total} size={72} className="-ml-1 mt-0.5" />
            <div className="ml-2 text-sm opacity-60">{expanded ? "▲" : "▼"}</div>
          </button>

          {expanded && (
            <div className="px-4 pb-4">
              <div className="flex items-center gap-2 mb-3">
                <button
                  className="px-3 py-1 rounded-full border text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={selectAll}
                >
                  Select all
                </button>
                <button
                  className="px-3 py-1 rounded-full border text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={clearAll}
                >
                  Clear
                </button>
                <div className="ml-auto text-xs opacity-70">
                  Selected subtopics: {selectedCount} • Questions: {selectedQs}
                </div>
              </div>

              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                {subsFiltered.map((s) => {
                  const regQs  = (regularIdx?.get(tKey)?.get(norm(s.name)) || []);
                  const longQs = (longIdx?.get(tKey)?.get(norm(s.name)) || []);
                  const cnt = [...regQs, ...longQs].filter(q => chosen.has(q.difficulty)).length;
                  const on = (cvSel[t.name] || new Set()).has(s.name);
                  return (
                    <div
                      key={s.name}
                      onClick={() => toggleSub(s.name)}
                      className={`cursor-pointer flex items-center gap-3 rounded-xl border p-3 transition
                        ${on ? "bg-indigo-50 border-indigo-400 dark:bg-indigo-900/40" : "bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700"}
                        ${cnt === 0 ? "opacity-50 pointer-events-none" : "hover:shadow"}`}
                    >
                      <div className="flex-1">
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-xs opacity-70">{cnt} questions</div>
                      </div>
                      <Btn
                        kind="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCvSel(m => ({ ...m, [t.name]: new Set([s.name]) }));
                          startFromSelected();
                        }}
                        disabled={cnt === 0}
                      >
                        ▶ Start
                      </Btn>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Btn id="btn-start-vignette-topic" onClick={startFromSelected} disabled={selectedQs === 0 && avail === 0}>
                  ▶ Start Vignette (Selected)
                </Btn>
              </div>
            </div>
          )}
        </div>
      );
    })}

    {/* Builder footer */}
    <div className="sticky bottom-6 flex flex-wrap items-center gap-3 bg-white/70 dark:bg-slate-900/70 backdrop-blur p-3 rounded-2xl border border-slate-200 dark:border-slate-700">
      <div className="text-sm opacity-75">
        Pool: Use per-topic selections above, or start from all topics.
      </div>

      {/* ✅ Show global total (unique across reg + long, difficulty applied) */}
<div className="ml-4 text-sm font-semibold text-indigo-600">
  Total Available: {(() => {
    const chosen = new Set(
      Array.isArray(diffSet) && diffSet.length ? diffSet : ["easy","medium","hard"]
    );
    const seen = new Set();
    for (const [, subMap] of (regularIdx || new Map()).entries()) {
      for (const qs of subMap.values()) {
        qs.forEach((q) => {
          if (chosen.has(q.difficulty)) {
            const key = q.id || q.qid || q._id || JSON.stringify(q.stem);
            seen.add(key);
          }
        });
      }
    }
    for (const [, subMap] of (longIdx || new Map()).entries()) {
      for (const qs of subMap.values()) {
        qs.forEach((q) => {
          if (chosen.has(q.difficulty)) {
            const key = q.id || q.qid || q._id || JSON.stringify(q.stem);
            seen.add(key);
          }
        });
      }
    }
    return seen.size;
  })()}
</div>

<label className="text-sm">
  # Questions
  <input
    className="ml-2 w-24 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800"
    type="number"
    min="1"
    value={cvPick.count}
    onChange={(e) => setCvPick((p) => ({ ...p, count: Number(e.target.value || 10) }))}
  />
</label>

{/* Difficulty */}
<div className="flex items-center gap-2 ml-2">
  {["easy","medium","hard"].map((lvl) => {
    const on = diffSet.includes(lvl);
    return (
      <button
        key={lvl}
        onClick={() => {
          setDiffSet((cur) => {
            const s = new Set(cur || []);
            on ? s.delete(lvl) : s.add(lvl);
            const arr = [...s];
            return arr.length ? arr : ["easy","medium","hard"];
          });
        }}
        className={`px-2 py-1 rounded-full text-xs border transition ${
          on ? "border-emerald-400 bg-emerald-50 dark:bg-emerald-900/40"
             : "hover:bg-slate-100 dark:hover:bg-slate-800"
        }`}
        aria-pressed={on}
      >
        {lvl[0].toUpperCase() + lvl.slice(1)}
      </button>
    );
  })}
</div>

{/* Global start from ALL topics */}
<div className="flex items-center gap-2 ml-auto">
  <Btn id="btn-start-vignette-all"
    onClick={() => {
      const chosen = new Set(
        Array.isArray(diffSet) && diffSet.length ? diffSet : ["easy","medium","hard"]
      );
      const seen = new Set();
      const arr = [];
      for (const [, subMap] of (longIdx || new Map()).entries()) {
        for (const qs of subMap.values()) {
          qs.forEach((q) => {
            if (chosen.has(q.difficulty)) {
              const key = q.id || q.qid || q._id || JSON.stringify(q.stem);
              if (!seen.has(key)) {
                seen.add(key);
                arr.push(q);
              }
            }
          });
        }
      }
      startCustomQuiz(arr, "Clinical Vignettes", null, Math.min(cvPick.count, arr.length || 10));
    }}
  >
    ▶ Start Vignette (All)
  </Btn>
</div>



    </div>
  </div>
)}

{/* ================= REVIEW PAGE ================= */}
{tab === "review" && (
  <div id="mq-review" className="space-y-4">
    {(() => {
      // -- reuse your Btn/Card if present --
      const Wrapper = ({ children, className = "" }) =>
        Card ? (
          <Card className={className}>{children}</Card>
        ) : (
          <div className={"rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow " + className}>
            {children}
          </div>
        );

      const Button = ({ children, onClick, kind = "default", className = "" }) =>
        Btn ? (
          <Btn onClick={onClick} kind={kind} className={className}>
            {children}
          </Btn>
        ) : (
          <button onClick={onClick} className={"px-3 py-1 rounded-xl border text-sm " + className}>
            {children}
          </button>
        );

      // -- WEEK SCOPING --
      const currentWeekId = activeWeek?.id || activeWeek?.slug || activeWeek?.name;
      const belongsToWeek = (q, wk) =>
        !wk ||
        q.weekId === wk ||
        q.deck === wk ||
        q.tags?.includes?.(wk) ||
        q.source?.includes?.(wk);

      // Choose the base collection by view (state is lifted: reviewView / setReviewView)
      const base = reviewView === "retested" ? (retested || {}) : (missed || {});
      const entries = Object.values(base).filter((q) => belongsToWeek(q, currentWeekId));

      // -- group by Topic → Subtopic --
      const groups = new Map();
      for (const q of entries) {
        const t = q.topic || "Misc.";
        const s = q.subtopic || "All";
        if (!groups.has(t)) groups.set(t, new Map());
        if (!groups.get(t).has(s)) groups.get(t).set(s, []);
        groups.get(t).get(s).push(q);
      }

      // -- launch a retest using your existing quiz flow --
      const startRetest = (qs, title) => {
        const normalized = qs.map((q) => ({ ...q, _id: qid ? qid(q) : q._id }));
        const limit = Math.min(10, normalized.length);
        startCustomQuiz(normalized, title, null, limit);
      };

      

      const totalCount = entries.length;

      return (
        <>
          {/* Header with view switch — ALWAYS visible */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xl font-bold">Review</div>

            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-xl overflow-hidden border">
                <button
                  onClick={() => setReviewView("missed")}
                  className={
                    "px-3 py-1 text-sm " +
                    (reviewView === "missed"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "bg-transparent")
                  }
                >
                  Still Missed
                </button>
                <button
                  onClick={() => setReviewView("retested")}
                  className={
                    "px-3 py-1 text-sm " +
                    (reviewView === "retested"
                      ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                      : "bg-transparent")
                  }
                >
                  Retested Correct
                </button>
              </div>

              <div className="text-sm opacity-70">{totalCount} total</div>

              {reviewView === "missed" ? (
  <Button kind="outline" onClick={() => requestClear("missed")}>🗑 Clear missed</Button>
) : (
  <Button kind="outline" onClick={() => requestClear("retested")}>🗑 Clear retested</Button>
)}
            </div>
          </div>

          {/* Empty state renders BELOW the header, so you can always switch back */}
          {entries.length === 0 ? (
            <Wrapper>
              <div className="p-4">
                {reviewView === "retested"
                  ? "No retested-correct items for this week yet."
                  : "No missed questions for this week. Do a quiz, then come back!"}
              </div>
            </Wrapper>
          ) : (
            [...groups.entries()].map(([topic, subMap]) => {
              const allQs = [].concat(...[...subMap.values()].map((arr) => arr));
              return (
                <Wrapper key={topic}>
                  <div className="p-3 flex items-center gap-3">
                    <div className="font-bold text-lg flex-1">{topic}</div>
                    {reviewView === "missed" ? (
                      <Button kind="outline" onClick={() => startRetest(allQs, `Retest — ${topic}`)}>
                        ▶ Retest Topic
                      </Button>
                    ) : (
                      <div className="text-xs opacity-70">Retested items</div>
                    )}
                  </div>

                  <div className="p-3 pt-0 grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {[...subMap.entries()].map(([sub, qs]) => (
                      <div key={sub} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                        <div className="flex items-center justify-between">
                          <div className="font-semibold">{sub}</div>
                          <div className="text-xs opacity-70">
                            {qs.length} {reviewView === "missed" ? "missed" : "retested"}
                          </div>
                        </div>

                        <div className="mt-2 flex items-center gap-2">
                          {reviewView === "missed" ? (
                            <>
                              <Button kind="ghost" onClick={() => openLearnNav && openLearnNav(topic, sub)}>
                                📖 Relearn
                              </Button>
                              <Button onClick={() => startRetest(qs, `${topic} — ${sub}`)}>
                                ▶ Retest
                              </Button>
                            </>
                          ) : (
                            <div className="text-xs opacity-70">✅ Correct on retest</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Wrapper>
              );
            })
          )}
        </>
      );
    })()}
  </div>
)}

{/* === Confirm Clear Modal (global) === */}
{confirmClear.open && (
  <div
    className="fixed inset-0 z-[2000] flex items-center justify-center"
    aria-labelledby="confirm-clear-title"
    role="dialog"
    aria-modal="true"
  >
    {/* Backdrop */}
    <div className="absolute inset-0 bg-black/60" onClick={cancelClear} />

    {/* Dialog */}
    <div className="relative w-[92vw] max-w-md rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-xl">
      <div className="p-4 border-b border-slate-700">
        <h2 id="confirm-clear-title" className="text-lg font-semibold">
          {confirmClear.type === "missed" ? "Clear all missed?" : "Clear all retested?"}
        </h2>
      </div>

      <div className="p-4 space-y-2 text-sm text-slate-300">
        <p>
          {confirmClear.type === "missed"
            ? "This will remove every missed question in the current storage. You can’t undo this."
            : "This will remove every item marked as retested correct. You can’t undo this."}
        </p>
      </div>

      <div className="p-4 flex gap-2 justify-end border-t border-slate-700">
        <button
          onClick={cancelClear}
          className="px-3 py-1 rounded-xl border border-slate-600 hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          onClick={performClear}
          className="px-3 py-1 rounded-xl bg-red-600 hover:bg-red-500 text-white"
          autoFocus
        >
          Yes, clear
        </button>
      </div>
    </div>
  </div>
)}




          {/* ================= PODCAST PAGE ================= */}
          {tab === "podcast" && (
  <div className="space-y-4" id="mq-podcast">
    <MediaPodcastPlayer
  src={pod.src}
  title={pod.title}
  artwork={pod.artwork}
  activeWeek={activeWeek}
  podIndex={podIndex}
  onPickPodcast={setPodIndex}
/>




  </div>
)}

        </main>
      </div>

      {/* ================= SUBTOPICS POPUP (from Topics page) ================= */}
      <Modal open={!!subsTopic} onClose={() => setSubsTopic(null)} title={`${subsTopic?.name} — Subtopics`} wide z={1100}>
        <div className="grid md:grid-cols-2 gap-4">
          {subsTopic &&
            subsForDisplay(subsTopic.name).map((s) => {
              const avail =
                (regularIdx?.get(normTopicWithAlias(subsTopic.name))?.get(norm(s.name))?.length || 0) +
                (longIdx?.get(normTopicWithAlias(subsTopic.name))?.get(norm(s.name))?.length || 0);
              const done = doneSub(subsTopic.name, s.name);
              const rec = subStats(subsTopic.name, s.name);
              return (
                <div key={s.name} className="rounded-xl p-4 border ...">
                <div className="flex items-center gap-3">
                  <h3 className={`text-xl font-extrabold flex-1 ${highVis ? "text-emerald-400" : ""}`}>
                    {s.name}
                  </h3>
                  <HoverBiRing
                    correct={rec.correct}
                    attempted={rec.attempted}
                    size={96}
                    className="-ml-2 mt-1"
                  />
                </div>


                  <div className="text-xs opacity-70 mt-1">
                    {done} completed • {avail} available
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <Btn kind="ghost" onClick={() => openLearnNav(subsTopic.name, s.name)}>
                      📖 Learn
                    </Btn>
                    <Btn onClick={() => startBattle(subsTopic.name, s.name)} disabled={avail === 0}>
                      ⚔️ Battle
                    </Btn>
                    <Btn onClick={() => startVignette(subsTopic.name, s.name)} disabled={avail === 0}>
                      🧪 Vignette
                    </Btn>
                  </div>
                </div>
              );
            })}
        </div>
      </Modal>

      {/* ================= LEARN NAVIGATOR (color-coded) — ABOVE QUIZ (higher z) ================= */}
<Modal
  open={!!learnNav}
  onClose={() => setLearnNav(null)}
  title={`Learn — ${learnNav?.topic}`}
  wide
  z={1600}
>
  {learnNav && (
    <div className="grid md:grid-cols-[280px,1fr] gap-4">
      {/* Sidebar with subtopics */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-2 max-h-[70vh] overflow-auto">
        {learnNav.subs.map((s, i) => (
          <div
            key={s.name}
            onClick={() => setLearnNav((n) => ({ ...n, index: i }))}
            className={`cursor-pointer rounded-lg px-3 py-2 text-sm mb-1 transition-transform hover:scale-[1.02] ${
              i === learnNav.index
                ? "bg-indigo-50 dark:bg-indigo-900/30 font-semibold"
                : "hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            {s.name}
          </div>
        ))}
      </div>

      {/* Main content area */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 max-h-[70vh] overflow-auto">
        {(() => {
          const sub = learnNav.subs[learnNav.index];
          const node = subNode(learnNav.topic, sub?.name);
          if (!node) return <div>No notes yet.</div>;

          return (
            <div
              className={`prose prose-sm dark:prose-invert max-w-none ${
                document.documentElement.getAttribute("data-highvis") === "true"
                  ? "prose-emerald"
                  : ""
              }`}
            >
              {/* Main content */}
              {renderLearnContent(node.content)}

              {/* Explain Like I Am Stupid */}
              {node.explain_like_i_am_stupid && (
                <div className="p-3 rounded border bg-amber-50 dark:bg-amber-900/30 border-amber-300 dark:border-amber-800 mb-2">
                  <span className="font-bold text-amber-700 dark:text-amber-300 mr-2">
                    💡 Explain Like I Am Stupid:
                  </span>
                  <span>{node.explain_like_i_am_stupid}</span>
                </div>
              )}

              {/* Mnemonic */}
              {node.mnemonic && (
                <div className="p-3 rounded border bg-fuchsia-50 dark:bg-fuchsia-900/30 border-fuchsia-300 dark:border-fuchsia-800 mb-2">
                  <span className="font-bold text-fuchsia-700 dark:text-fuchsia-300 mr-2">
                    🧠 Mnemonic:
                  </span>
                  <span>{node.mnemonic}</span>
                </div>
              )}

              {/* Clinical pearl */}
              {node.clinical_pearl && (
                <div className="p-3 rounded border bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-800 mb-2">
                  <span className="font-bold text-emerald-700 dark:text-emerald-300 mr-2">
                    🌟 Clinical Pearl:
                  </span>
                  <span>{node.clinical_pearl}</span>
                </div>
              )}

              {/* Slide reference */}
              {node.slide_reference && (
                <p className="mt-3 text-xs opacity-70">
                  <b>Slide reference:</b> {node.slide_reference}
                </p>
              )}
            </div>
          );
        })()}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-4">
          <Btn
            kind="ghost"
            onClick={() =>
              setLearnNav((n) => ({
                ...n,
                index: Math.max(0, n.index - 1),
              }))
            }
          >
            &larr; Prev
          </Btn>
          <Btn
            kind="ghost"
            onClick={() =>
              setLearnNav((n) => ({
                ...n,
                index: Math.min(n.subs.length - 1, n.index + 1),
              }))
            }
          >
            Next &rarr;
          </Btn>
        </div>
      </div>
    </div>
  )}
</Modal>



      {/* ================= QUIZ MODAL (z lower than Learn so Relearn sits above) ================= */}
      <Modal
        open={!!quiz}
        onClose={() => setQuiz(null)}
        title={quiz ? (quiz.sub ? `${quiz.topic} — ${quiz.sub}` : quiz.topic) : ""}
        wide
        z={1400}
      >
        {quiz && (() => {
          // REVIEW STAGE
          if (quiz.stage === "review") {
            const total = quiz.items.length;
            const lockedCount = quiz.answers.filter((a) => a.locked).length;
            const correctCount = quiz.answers.filter((a) => a.correct).length;

            const submitQuiz = () => {
              const items = quiz.items;
              const answers = [...quiz.answers];
              let addCorrect = 0;
              answers.forEach((a, i) => {
                if (a.locked) return;
                const picked = a.picked;
                const correct = !!picked && picked === items[i].answer;
                record(items[i], correct);
                if (correct) addCorrect += 1;
                answers[i] = { picked, locked: true, correct };
              });
              setQuiz((s) => ({ ...s, answers, correctCount: s.correctCount + addCorrect }));
              finishQuiz();
            };

            return (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="text-sm opacity-75">Locked: {lockedCount}/{total}</div>
                  <div className="ml-auto flex items-center gap-3">
                    <Ring value={total ? (correctCount / total) : 0} size={44} />
                    <div className="text-sm">{correctCount}/{total}</div>
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-auto rounded-xl border border-slate-200 dark:border-slate-700">
                  {quiz.items.map((q, i) => {
                    const a = quiz.answers[i];
                    return (
                      <div key={q._id} className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 dark:border-slate-700">
                        <div className="w-14 text-xs opacity-70">Q{i + 1}</div>
                        <div className="flex-1 truncate">{q.stem}</div>
                        <div className={`text-xs px-2 py-1 rounded ${a.locked ? (a.correct ? "bg-emerald-600 text-white" : "bg-rose-600 text-white") : "bg-slate-200 dark:bg-slate-700"}`}>
                          {a.locked ? (a.correct ? "✓ Correct" : "✗ Incorrect") : "Not answered"}
                        </div>
                        <button
                          className="px-2 py-1 rounded border ml-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                          onClick={() =>
                            setQuiz((s) => ({
                              ...s,
                              stage: "live",
                              idx: i,
                              answer: s.answers[i]?.picked ?? null,
                              reveal: false,
                              softHide: true,
                            }))
                          }
                        >
                          Open
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between">
                  <button className="px-3 py-1 rounded border" onClick={() => setQuiz((s) => ({ ...s, stage: "live" }))}>
                    ← Return to Quiz
                  </button>
                  <button className="px-4 py-2 rounded-xl font-semibold text-white bg-indigo-600 hover:bg-indigo-500" onClick={submitQuiz}>
                    Submit Quiz
                  </button>
                </div>
              </div>
            );
          }

          // LIVE STAGE
          const q = currentQ();
          if (!q) return <div>No question.</div>;
          const ai = quiz.answers[quiz.idx];
          const entries = Object.entries(q.options || {});
          const showReveal = ai.locked && !quiz.softHide;

          return (
            <div className="space-y-4 relative">
              {/* Relearn bubble (button triggers the Learn modal which sits ABOVE via higher z) */}
              {showReveal && (
                <div className="pointer-events-none absolute -top-3 right-0 -translate-y-full z-[1450]">
                  <button
                    className="pointer-events-auto px-3 py-1 rounded-xl shadow-lg border border-indigo-300 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300"
                    onClick={() => openLearnNav(q.topic, q.subtopic)}
                  >
                    🔁 Relearn Concept
                  </button>
                </div>
              )}

              {quiz.timerOn && timeLeft != null && !ai.locked && (
                <div className="absolute -top-3 left-0 -translate-y-full bg-black text-white px-2 py-1 rounded font-black z-[1450]">
                  ⏱ {timeLeft}s
                </div>
              )}

              {q.image && (
                <img
                  src={q.image}
                  alt=""
                  className="max-h-72 object-contain mx-auto rounded-xl border border-slate-200 dark:border-slate-700"
                />
              )}
              <div className="text-lg font-semibold">{q.stem}</div>
              <div className="grid sm:grid-cols-2 gap-3">
                {entries.map(([L, text]) => {
                  const picked = quiz.answer === L;
                  const ok = showReveal && L === q.answer;
                  const bad = showReveal && picked && L !== q.answer;
                  return (
                    <button
                      key={L}
                      className={[
                        "text-left px-4 py-3 rounded-lg border transition",
                        picked ? "border-indigo-500 ring-2 ring-indigo-300" : "border-slate-300 dark:border-slate-600",
                        ok ? "bg-emerald-50 dark:bg-emerald-900/30 border-emerald-300 dark:border-emerald-800" : "",
                        bad ? "bg-rose-50 dark:bg-rose-900/30 border-rose-300 dark:border-rose-800" : "",
                      ].join(" ")}
                      onClick={() =>
                        setQuiz((s) => {
                          const answers = [...s.answers];
                          answers[s.idx] = { ...answers[s.idx], picked: L };
                          return { ...s, answers, answer: L, softHide: false };
                        })
                      }
                      disabled={showReveal}
                    >
                      <span className="font-semibold mr-2">{L}.</span> {text}
                    </button>
                  );
                })}
              </div>
              {q.slide_reference && <div className="text-xs opacity-70">Slide ref: {q.slide_reference}</div>}
              {showReveal && (
                <div className={`p-3 rounded-lg border ${ai.correct ? "bg-emerald-50 border-emerald-300 dark:bg-emerald-900/30 dark:border-emerald-800" : "bg-rose-50 border-rose-300 dark:bg-rose-900/30 dark:border-rose-800"}`}>
                  <div className="font-semibold mb-1">{ai.correct ? "✅ Correct" : `❌ Incorrect (Ans: ${q.answer})`}</div>
                  <div>{q.explanation || "—"}</div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Btn kind="ghost" onClick={prevQ} disabled={quiz.idx === 0}>
                  ◀ Prev
                </Btn>
                <div className="flex items-center gap-2">
                  <Btn onClick={lockIn} disabled={ai.locked || quiz.answer == null}>
                    Lock In
                  </Btn>
                  <Btn onClick={nextQ}>{quiz.idx === quiz.items.length - 1 ? "Review Quiz" : "Next ▶"}</Btn>
                </div>
                <div className="text-sm opacity-70">{quiz.mode === "battle" ? `Streak: ${topicProgress[quiz.topic] || 0} / need 3` : ""}</div>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* ================= Tutorial button (bottom-left) ================= */}
      <button id="btn-open-tutorial"
        onClick={() => setShowTut(true)}
        className="fixed left-4 bottom-4 z-[2000] px-4 py-2 rounded-xl shadow-lg bg-gradient-to-r from-pink-500 to-indigo-500 text-white font-bold hover:scale-[1.03] active:scale-[0.99]"
        title="Open Tutorial"
      >
        🎮 Tutorial
      </button>

      {/* ================= Tutorial overlay (step-by-step with spotlight) ================= */}
      {showTut && (
        <div className="fixed inset-0 z-[2500]">
          {/* dim background */}
          <div className="absolute inset-0 bg-black/70" />
          {/* spotlight box */}
          {spot && (
            <div
              className="absolute rounded-2xl ring-4 ring-yellow-300 transition-all duration-200 pointer-events-none"
              style={{
                top: `${spot.top}px`,
                left: `${spot.left}px`,
                width: `${spot.width}px`,
                height: `${spot.height}px`,
              }}
            />
          )}
          {/* tutorial card */}
          <div className="absolute left-1/2 top-16 -translate-x-1/2 w-[min(720px,92vw)] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-2xl">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div className="text-lg font-black">
                {tutSteps[tutIdx]?.title || "Welcome"}
              </div>
              <button className="px-2 py-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800" onClick={endTutorial}>Skip ✕</button>
            </div>
            <div className="p-6">
              <div className="text-sm leading-relaxed">
                {tutSteps[tutIdx]?.text || "Use the left nav to explore Topics, build Clinical Vignettes, and Review missed questions."}
              </div>
              <div className="mt-4 flex items-center justify-between">
                <Btn kind="ghost" onClick={() => setTutIdx((i) => Math.max(0, i - 1))} disabled={tutIdx === 0}>
                  ← Back
                </Btn>
                {tutIdx < tutSteps.length - 1 ? (
                  <Btn onClick={() => setTutIdx((i) => Math.min(tutSteps.length - 1, i + 1))}>
                    Next →
                  </Btn>
                ) : (
                  <Btn onClick={endTutorial}>Finish</Btn>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}