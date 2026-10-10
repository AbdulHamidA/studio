import { useEffect, useRef, useState } from "react";
import { api, errText, isCancelled, newJobId, onEngineProgress, vaultUrl } from "../lib/api";
import { ANALYST_IDS, KOKORO_MODEL_ID, SPEECH_MODEL_ID, keepBook, unanalysedIn, voiceGroups, type AudioSettings, type StoryLibrary } from "../lib/story";
import type { EngineProgress, ModelStatus } from "../lib/types";
import { JobProgress } from "./shared";
import { useNowPlaying } from "../lib/nowPlaying";

export default function Audiobook({ library, models, notify, onLibraryChange, onProduced }: {
  library: StoryLibrary | null;
  models: ModelStatus[];
  notify: (message: string, bad?: boolean) => void;
  onLibraryChange: (update: (current: StoryLibrary) => StoryLibrary) => Promise<void>;
  onProduced: () => void;
}) {
  const nowPlaying = useNowPlaying();
  const [bookId, setBookId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("Chapter 1");
  const [append, setAppend] = useState(false);
  const [voices, setVoices] = useState<{ id: string; language: string }[]>([]);
  const [voiceError, setVoiceError] = useState("");
  const [job, setJob] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const book = library?.books.find((b) => b.id === (bookId || library.activeBookId)) ?? library?.books.at(-1);
  const chapter = book?.chapters.find((c) => c.id === chapterId) ?? book?.chapters.at(-1);
  const saved = book && library?.audio?.[book.id];
  const settings: AudioSettings = saved ?? { narrator: "", voices: {}, rate: 160, outputs: {} };
  const speechModel = settings.model_id || SPEECH_MODEL_ID;
  // Language, delivery and per-character direction are Qwen3-TTS's; Kokoro
  // and macOS voices take pace only.
  const neural = speechModel === SPEECH_MODEL_ID;
  const speechReady = speechModel === "macos" || models.some((m) => m.id === speechModel && m.installed && !m.hopeless);
  const voiceOptions = voiceGroups(voices).map(([label, list]) => <optgroup key={label} label={label}>
    {list.map((v) => <option key={v.id} value={v.id}>{v.id}</option>)}</optgroup>);
  useEffect(() => {
    let live = true;
    setVoices([]); setVoiceError("");
    void api.audioVoices(speechModel).then((r) => { if (live) setVoices(r.voices); })
      .catch((e) => { if (live) setVoiceError(errText(e)); });
    return () => { live = false; };
  }, [speechModel]);
  const narrator = voices.some((v) => v.id === settings.narrator) ? settings.narrator : voices[0]?.id || "";
  const assignedVoices = Object.fromEntries(Object.entries(settings.voices).filter(([, voice]) => voices.some((v) => v.id === voice)));
  const outputs = chapter ? settings.outputs[chapter.id] ?? [] : [];
  // Scene markers are kept on the recording's vault item.
  const [markerFor, setMarkerFor] = useState<Record<string, { time: number; label: string }[]>>({});
  const outputKey = outputs.join(",");
  useEffect(() => {
    if (!outputKey) return;
    let live = true;
    void api.vaultList().then((items) => {
      if (live) setMarkerFor(Object.fromEntries(items.filter((i) => i.markers?.length).map((i) => [i.id, i.markers!])));
    }).catch(() => { /* the player still works without markers */ });
    return () => { live = false; };
  }, [outputKey]);
  const writerReady = models.some((m) => ANALYST_IDS.includes(m.id) && m.installed && !m.hopeless);

  // Hear a voice before choosing it. The sample is the character's own first
  // line when there is one, so the choice is made on words from this story.
  const [previewing, setPreviewing] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { player.current?.pause(); }, []);
  const sampleFor = (characterId: string | null) => {
    const lines = chapter?.scenes.flatMap((s) => s.beats.flatMap((b) => b.dialogue)) ?? [];
    const line = characterId ? lines.find((d) => d.speaker_id === characterId)?.text : null;
    if (line) return line;
    const opening = (chapter?.source ?? "").slice(0, 300);
    return characterId ? "Hello. This is how I will sound in your story."
      : opening.slice(0, Math.max(opening.lastIndexOf(". ") + 1, 120)) || "This is how I will read your story.";
  };
  const preview = async (key: string, voice: string, characterId: string | null) => {
    setPreviewing(key);
    try {
      const { wav_base64 } = await api.audioPreview({ model_id: speechModel, voice, text: sampleFor(characterId),
        language: settings.language || "auto", delivery: settings.delivery || "",
        direction: characterId ? (settings.directions?.[characterId]
          ?? book?.characters.find((c) => c.id === characterId)?.voice ?? "") : "",
        rate: settings.rate });
      const bytes = Uint8Array.from(atob(wav_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      player.current?.pause();
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      player.current = audio;
      await audio.play();
    } catch (e) {
      notify(`Could not preview ${voice}: ${errText(e)}`, true);
    } finally {
      if (mounted.current) setPreviewing(null);
    }
  };
  const PreviewButton = ({ id, voice, character, label }: { id: string; voice: string; character: string | null; label: string }) =>
    <button type="button" className="btn small" aria-label={label} title={`Hear ${voice}`}
      disabled={!!job || !!previewing || !voice || !speechReady}
      onClick={() => void preview(id, voice, character)}>{previewing === id ? "…" : "▶"}</button>;

  const saveSettings = (patch: Partial<AudioSettings> | ((latest: AudioSettings) => Partial<AudioSettings>)) => {
    if (!book) return;
    const id = book.id;
    void onLibraryChange((current) => {
      const latest = current.audio?.[id] ?? settings;
      return { ...current, audio: { ...current.audio,
        [id]: { ...latest, ...(typeof patch === "function" ? patch(latest) : patch) },
      } };
    }).catch((e) => notify(`Could not save voice settings: ${errText(e)}`, true));
  };
  const perform = async (action: (id: string) => Promise<void>) => {
    const id = newJobId(); setJob(id); setProgress(null);
    let un: (() => void) | undefined;
    try {
      un = await onEngineProgress((p) => { if (p.job_id === id && mounted.current) setProgress(p); });
      await action(id);
    } catch (e) {
      notify(isCancelled(e) ? "Audiobook stopped." : errText(e), !isCancelled(e));
    } finally {
      un?.();
      if (mounted.current) { setJob(null); setProgress(null); }
    }
  };
  const analyze = () => perform(async (id) => {
    // Speakers and mood only: the audiobook needs nothing about shots, outfits
    // or rooms, and describing them for every beat made this take hours.
    const result = await api.analyzeStory(id, source, title, append ? book ?? null : null, null, "voice");
    await onLibraryChange((current) => keepBook(current, result.book));
    setBookId(result.book.id); setChapterId(result.chapter_id); setSource(""); setAppend(false);
    notify("Voices cast and saved. Board shares this character bible and adds its scene direction when you draw.");
  });
  // Stop keeps the passages already cast; this casts only the rest.
  const resume = () => perform(async (id) => {
    if (!book || !chapter) return;
    const result = await api.resumeStory(id, book, chapter.id);
    await onLibraryChange((current) => keepBook(current, result.book));
    notify(result.unanalysed ? `${result.unanalysed} passages still to cast; the rest is saved.` : "Every passage is cast.");
  });
  const narrate = () => perform(async (id) => {
    if (!book || !chapter) return;
    const audio = await api.generateAudiobook(id, book, chapter.id, narrator, assignedVoices, settings.rate, {
      model_id: speechModel, language: settings.language || "auto",
      delivery: settings.delivery || "", directions: settings.directions || {},
    });
    onProduced();
    // Audio remains a Vault item even if the follow-up state save fails.
    try { await onLibraryChange((current) => {
      const latest = current.audio?.[book.id] ?? settings;
      return { ...current, audio: { ...current.audio, [book.id]: {
        ...latest, narrator, outputs: { ...latest.outputs,
          [chapter.id]: [...(latest.outputs[chapter.id] ?? []), audio] },
      } } };
    });
    } catch (error) {
      notify(`Audio is saved in Vault, but its chapter link could not be saved: ${errText(error)}`, true);
      return;
    }
    notify("Chapter audio saved in the encrypted Vault.");
  });

  return <div className="audiobook-workspace">
    <div className="pane">
      <h2>Audiobook</h2>
      <p className="muted">Read the original chapter with local neural voices and character delivery. A quick analysis casts who speaks each line; Board shares its characters and adds scene direction when you draw.</p>
      {!library && <div className="notice warn">The encrypted story library is loading.</div>}
      {!!library?.books.length && <>
        <label>Book<select value={book?.id ?? ""} disabled={!!job}
          onChange={(e) => { setBookId(e.target.value); setChapterId(""); }}>
          {library.books.map((b) => <option key={b.id} value={b.id}>
            {b.chapters[0]?.title ?? "Book"} · {b.chapters.length} chapters
          </option>)}
        </select></label>
        <label>Chapter<select value={chapter?.id ?? ""} disabled={!!job}
          onChange={(e) => setChapterId(e.target.value)}>
          {book?.chapters.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select></label>
      </>}
      <details open={!book}>
        <summary>{book ? "Add a chapter or start another book" : "Start with your chapter"}</summary>
        <label>Chapter title<input value={title} disabled={!!job} onChange={(e) => setTitle(e.target.value)} /></label>
        <label>Prose<textarea rows={10} value={source} disabled={!!job}
          onChange={(e) => setSource(e.target.value)} placeholder="Paste the original prose…" /></label>
        {book && <label><input type="checkbox" checked={append} disabled={!!job}
          onChange={(e) => setAppend(e.target.checked)} /> Add to this book and reuse its characters</label>}
        <button className="btn primary" disabled={!!job || !source.trim() || !writerReady || !library}
          onClick={() => void analyze()}>Analyze chapter</button>
        {!writerReady && <p className="notice warn">Install a story analyst or the prompt writer in Models to analyze prose.</p>}
      </details>
      {book && chapter && unanalysedIn(book, chapter.id) > 0 && <div className="notice warn">
        {unanalysedIn(book, chapter.id)} passages are not cast yet and would be read by the narrator.
        <button className="btn small" disabled={!!job || !writerReady} onClick={() => void resume()}>Continue analysis</button>
      </div>}
      {book && chapter && <>
        <label>Speech engine<select value={speechModel} disabled={!!job}
          onChange={(e) => saveSettings({ model_id: e.target.value, narrator: "", voices: {} })}>
          <option value={KOKORO_MODEL_ID}>Kokoro · fast, Hindi and Indian English voices</option>
          <option value={SPEECH_MODEL_ID}>Qwen3-TTS · expressive, slower</option>
          <option value="macos">macOS system voices · includes Indian voices</option>
        </select></label>
        {!speechReady && <p className="notice warn">Download {speechModel === KOKORO_MODEL_ID
          ? "Fast audiobook voices (Kokoro 82M)" : "Audiobook voices (Qwen3-TTS 1.7B)"} in Models to use it.</p>}
        {neural && <>
          <label>Language<select value={settings.language || "auto"} disabled={!!job}
            onChange={(e) => saveSettings({ language: e.target.value })}>
            {["auto", "english", "chinese", "japanese", "korean", "german", "french", "russian", "portuguese", "spanish", "italian"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select></label>
          <label>Narration direction<textarea rows={2} maxLength={1500} value={settings.delivery || ""} disabled={!!job}
            placeholder="Warm, intimate storytelling with restrained emotion and natural pauses."
            onChange={(e) => saveSettings({ delivery: e.target.value })} /></label>
        </>}
        <label>Narrator<span style={{ display: "flex", gap: 6 }}><select value={narrator} disabled={!!job || !voices.length}
          onChange={(e) => saveSettings({ narrator: e.target.value })}>
          {voiceOptions}
        </select><PreviewButton id="narrator" voice={narrator} character={null} label="Preview narrator voice" /></span></label>
        <label>{neural ? `Reading pace · ${settings.rate} (approximate)` : `Reading speed · ${settings.rate} words/minute`}<input type="range" min={80} max={300}
          value={settings.rate} disabled={!!job} onChange={(e) => saveSettings({ rate: Number(e.target.value) })} /></label>
        <div className="sub-head">Character voices</div>
        {book.characters.map((c) => <label key={c.id}>{c.name}
          {c.voice && <small className="muted">{c.voice}</small>}
          <select aria-label={`${c.name} voice`} value={assignedVoices[c.id] ?? ""} disabled={!!job}
            onChange={(e) => {
              const value = e.target.value;
              saveSettings((latest) => {
                const next = { ...latest.voices };
                if (value) next[c.id] = value; else delete next[c.id];
                return { voices: next };
              });
            }}>
            <option value="">Use narrator</option>
            {voiceOptions}
          </select>
          <PreviewButton id={c.id} voice={assignedVoices[c.id] ?? narrator} character={c.id} label={`Preview ${c.name} voice`} />
          {neural && <input aria-label={`${c.name} voice direction`} maxLength={1500}
            value={settings.directions?.[c.id] ?? c.voice} disabled={!!job} placeholder="Quiet, guarded; a slight tremor when afraid"
            onChange={(e) => { const value = e.target.value;
              saveSettings((latest) => ({ directions: { ...latest.directions, [c.id]: value } }));
            }} />}
        </label>)}
        <button className="btn primary" disabled={!!job || !speechReady || !narrator || !voices.some((v) => v.id === narrator)}
          onClick={() => void narrate()}>Narrate chapter</button>
      </>}
      {!voices.length && <p className="notice warn">{voiceError || (neural ? "Neural voices are loading." : "Installed macOS speech voices are required for narration. Manage voices in macOS Accessibility → Spoken Content.")}</p>}
      {job && <button className="btn" onClick={() => void api.cancelJob(job).catch((e) => notify(errText(e), true))}>Stop</button>}
      {progress && <JobProgress p={progress} label="Audiobook" />}
    </div>
    <div className="pane">
      <h3>{chapter?.title ?? "Your narrated chapter"}</h3>
      {/* Recordings play in the app-wide bar, so a chapter keeps playing
          while you work elsewhere. */}
      {outputs.map((id, i) => {
        const title = `${chapter?.title ?? "Chapter"} · recording ${i + 1}`;
        const current = nowPlaying.track?.src === vaultUrl(id);
        return <div className="audio-result recording" key={id}>
          <span>{title}{markerFor[id]?.length ? <span className="t-meta"> · {markerFor[id].length} scenes</span> : null}</span>
          <button type="button" className={"btn small" + (current ? "" : " primary")} aria-pressed={current}
            onClick={() => current ? nowPlaying.stop()
              : nowPlaying.play({ src: vaultUrl(id), title, markers: markerFor[id] ?? [] })}>
            {current ? "■ Stop" : "▶ Play"}</button>
        </div>;
      })}
      {outputs.length > 0 && <p className="t-help">Recordings are in the Vault too, where they can be exported as WAV.</p>}
      {chapter && <details><summary>Original text · {chapter.scenes.length} analyzed scenes</summary>
        <p style={{ whiteSpace: "pre-wrap" }}>{chapter.source}</p></details>}
      {chapter?.scenes.map((scene) => <section key={scene.id} className="notice">
        <h4>{scene.title}</h4><p>{scene.summary}</p>
        {scene.beats.flatMap((beat) => beat.dialogue).map((line, i) => <p key={i}>
          <strong>{book?.characters.find((c) => c.id === line.speaker_id)?.name ?? "Unattributed"}{line.offscreen ? " (offscreen)" : ""}:</strong> {line.text}
        </p>)}
      </section>)}
    </div>
  </div>;
}
