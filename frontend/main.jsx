import React, {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Drone, Menu, X, House, CalendarDays, MessageCircle, Megaphone, Users, Battery, ShieldCheck, Construction, BookOpen, Timer,
  LogOut, Bell, Plus, ChevronLeft, ChevronRight, MapPin, Clock, Check, CircleHelp,
  Search, ScanLine, QrCode, ClipboardCheck, Pin, FileText, Download, ArrowUpRight, Settings2, Send, CheckCheck, Pencil} from "lucide-react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-ext-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-ext-600.css";
import "./style.css";
import {CameraScanner} from "./scanner.jsx";
import {usePwaInstall, promptInstallation, installationPlatform} from "./install.js";
import {detectLanguage, initialLanguage, localizeText, translateNode, translatePage} from "./localization.js";

const base = new URL("./", location.href);
let activeLanguage = initialLanguage();
const uiLocale = () => activeLanguage === "sk" ? "sk-SK" : activeLanguage === "uk" ? "uk-UA" : "en-GB";
const labels = {yes: "Prídem", no: "Neprídem", maybe: "Ešte neviem"};
const batteryLabels = {used: "Použitá", charged: "Nabitá", stored: "V sklade", damaged: "Poškodená", retired: "Vyradená"};
const timeZone = "Europe/Bratislava";
const date = value => new Date(value).toLocaleString(uiLocale(), {dateStyle: "medium", timeStyle: "short", timeZone});
const past = t => new Date(t.starts_at) <= new Date();
const hash = () => new URLSearchParams(location.hash.slice(1));
const trainingParts = new Intl.DateTimeFormat("sv-SE", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const clubLocal = value => trainingParts.format(new Date(value)).replace(" ", "T");

function trainingISO(local) {
  const reference = Date.parse(local + "Z");
  const offset = instant => Date.parse(clubLocal(instant) + "Z") - instant;
  const candidates = [...new Set([offset(reference - 86400000), offset(reference + 86400000)])]
    .map(shift => new Date(reference - shift)).filter(instant => clubLocal(instant) === local);
  if (candidates.length !== 1) throw new Error("Vyber jednoznačný čas mimo prechodu letného času.");
  return candidates[0].toISOString();
}

async function api(path, method = "GET", body) {
  const response = await fetch(new URL("api/" + path, base), {
    method,
    headers: body === undefined ? undefined : {"Content-Type": "application/json"},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const error = new Error(typeof payload.detail === "string" ? localizeText(payload.detail, activeLanguage) :
      response.status === 422 ? "Skontroluj vyplnené údaje." : "Požiadavka sa nepodarila.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function Form({submit, children, label, reset = false}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function handle(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    try {
      await submit(Object.fromEntries(new FormData(form)));
      if (reset) form.reset();
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <form onSubmit={handle}>
    <fieldset disabled={busy}>
      {children}
      <button className="primary">{busy ? "Ukladá sa…" : label}</button>
    </fieldset>
    {error && <p className="error" role="alert">{error}</p>}
  </form>;
}

function Action({run, children, className = "", pressed, disabled = false}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <span className="action"><button type="button" className={className} aria-pressed={pressed} disabled={busy || disabled} onClick={async () => {
    setBusy(true);
    setError("");
    try { await run(); } catch (error) { setError(error.message); } finally { setBusy(false); }
  }}>{children}</button>{error && <small className="error" role="alert">{error}</small>}</span>;
}

function Login({onLogin}) {
  const [invite, setInvite] = useState(() => hash().get("invite"));
  const [inviteInfo,setInviteInfo]=useState(null);
  const [accepted, setAccepted] = useState(false);
  const reset = hash().has("reset");
  useEffect(()=>{if(invite)api("members/invite-info/"+invite).then(setInviteInfo).catch(()=>{});},[invite]);
  return <section className="card auth">
    <h1>{invite ? (reset ? "Obnova hesla" : "Aktivácia účtu") : "Prihlásenie"}</h1>
    {accepted && <p role="status">Účet je pripravený. Prihlás sa e-mailom, ktorý si potvrdil.</p>}
    {invite ? <Form key={"accept:"+(inviteInfo?.email||"")} label={reset ? "Nastaviť heslo" : "Aktivovať účet"} submit={async ({password,email}) => {
      await api("members/accept", "POST", {token: invite, password,email});
      history.replaceState(null, "", location.pathname);
      setInvite(null);
      setAccepted(true);
    }}>
      <p className="muted">Účet {inviteInfo?.name?"pre "+inviteInfo.name:""} sa aktivuje s týmto e-mailom. Skontroluj ho a oprav prípadný preklep.</p>
      <label>E-mail<input name="email" type="email" maxLength="254" autoComplete="email" defaultValue={inviteInfo?.email||""} required /></label>
      {inviteInfo?.roles?.length>0&&<p className="meta">Priradené roly: {inviteInfo.roles.map(role=>roleNames[role]||role).join(" · ")}</p>}
      <label>Nové heslo<input name="password" type="password" minLength="8" maxLength="128" autoComplete="new-password" required /></label>
      <small>Použi aspoň 8 znakov.</small>
    </Form> : <Form key="login" label="Prihlásiť sa" submit={async data => {
      await api("login", "POST", data);
      await onLogin();
    }}>
      <label>E-mail alebo prihlasovacie meno<input name="login" autoComplete="username" autoCapitalize="none" maxLength="254" required /></label>
      <label>Heslo<input type="password" name="password" autoComplete="current-password" maxLength="128" required /></label>
    </Form>}
  </section>;
}

const kinds = {training: "Tréning", match: "Zápas", meeting: "Stretnutie"};
const roles = {superadmin: "Administrátor", coach: "Tréner", member: "Člen"};
const roleNames = {player:"Hráč",coach:"Tréner",club_leader:"Vedúci klubu",deputy_leader:"Zástupca vedúceho klubu",administrator:"Administratívny pracovník",equipment_technician:"Technik vybavenia",social_media_manager:"Správca sociálnych sietí",competition_coordinator:"Koordinátor súťaží",recruitment_coordinator:"Koordinátor náboru",safety_coordinator:"Bezpečnostný a prevádzkový koordinátor",team_coordinator:"Koordinátor tímov",content_creator:"Fotograf / tvorca obsahu"};
const initials = name => name.split(" ").filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();
const dayKey = timestamp => clubLocal(timestamp).slice(0, 10);
const today = () => dayKey(new Date());
const clock = timestamp => new Date(timestamp).toLocaleTimeString(uiLocale(), {hour: "2-digit", minute: "2-digit", timeZone});
const upcoming = training => !training.cancelled && !past(training);

function Avatar({name}) {
  return <span className="avatar" aria-hidden="true">{initials(name)}</span>;
}

function Empty({icon: Icon = CalendarDays, children}) {
  return <div className="empty"><Icon size={28} /><p>{children}</p></div>;
}

function Modal({title, close, children}) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = old;};
  }, []);
  return <dialog ref={ref} className="modal" onCancel={event => {event.preventDefault(); close();}}
    onClick={event => {if (event.target === ref.current) close();}}>
    <div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Zavrieť" onClick={close}><X /></button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}

function TrainingForm({training, initialDay, places, done}) {
  const [kind, setKind] = useState(training?.kind || "training");
  const [repeat, setRepeat] = useState(false);
  const [place, setPlace] = useState(training?.location || places[0]?.name || "");
  const [newPlace, setNewPlace] = useState(places.length === 0 || Boolean(training && !places.some(p => p.name === training.location)));
  return <Form label={training ? "Uložiť zmeny" : "Naplánovať udalosť"} submit={async data => {
    const starts_at = trainingISO(data.starts_at);
    const ends_at = data.ends_at ? trainingISO(data.ends_at) : null;
    if (ends_at && ends_at <= starts_at) throw new Error("Koniec musí nasledovať po začiatku.");
    if (newPlace) await api("places", "POST", {name: data.location});
    await api(training ? "trainings/" + training.id : "trainings", training ? "PUT" : "POST", {
      title: data.title || kinds[kind], kind, starts_at, ends_at, location: data.location,
      instructions: data.instructions, weeks: Number(data.weeks || 1),
    });
    await done();
  }}>
    <label>Typ udalosti<select value={kind} onChange={event => setKind(event.target.value)}>
      {Object.entries(kinds).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
    </select></label>
    <label>Názov<input name="title" maxLength="120" defaultValue={training?.title} placeholder={kinds[kind]} /></label>
    <div className="form-row">
      <label>Začiatok<input type="datetime-local" name="starts_at" defaultValue={training ? clubLocal(training.starts_at) : initialDay ? initialDay + "T17:00" : ""} required /></label>
      <label>Koniec<input type="datetime-local" name="ends_at" defaultValue={training?.ends_at ? clubLocal(training.ends_at) : ""} /></label>
    </div>
    <small>Časy sú v časovom pásme Slovenska.</small>
    <label>Miesto{newPlace ?
      <input name="location" maxLength="120" value={place} onChange={event => setPlace(event.target.value)} required /> :
      <select name="location" value={place} onChange={event => setPlace(event.target.value)} required>
        {places.map(item => <option key={item.id} value={item.name}>{item.name}</option>)}
      </select>}
    </label>
    {places.length > 0 && <button type="button" className="text-button" onClick={() => {
      setNewPlace(!newPlace);
      setPlace(newPlace ? places[0].name : "");
    }}>{newPlace ? "Vybrať uložené miesto" : "+ Nové miesto"}</button>}
    <label>Pokyny<textarea name="instructions" maxLength="1000" defaultValue={training?.instructions} placeholder="Čo si priniesť alebo na čo sa pripraviť…" /></label>
    {!training && <>
      <label className="checkbox"><input type="checkbox" checked={repeat} onChange={event => setRepeat(event.target.checked)} /> Opakovať každý týždeň</label>
      {repeat && <label>Počet termínov<input name="weeks" type="number" min="2" max="26" defaultValue="8" required /></label>}
    </>}
  </Form>;
}

function RSVP({training, refresh}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(training.note || "");
  useEffect(() => {setNote(training.note || "");}, [training.note, training.updated_at]);
  return <div className="rsvp">
    <p className="field-title">{training.response ? "Tvoja účasť" : "Dáš nám vedieť, či prídeš?"}</p>
    <div className="segmented rsvp-buttons">{Object.entries(labels).map(([response, text]) =>
      <Action key={response} pressed={training.response === response} className={response + (training.response === response ? " selected" : "")}
        run={async () => {
          await api("trainings/" + training.id + "/rsvp", "PUT", {response, note});
          await refresh();
        }}>{response === "yes" ? <Check size={17} /> : response === "no" ? <X size={17} /> : <CircleHelp size={17} />}{text}</Action>
    )}</div>
    <button className="text-button" onClick={() => setNoteOpen(!noteOpen)}>{noteOpen ? "Zavrieť poznámku" : training.note ? "Upraviť poznámku" : "+ Poznámka trénerovi"}</button>
    {noteOpen && <Form label="Uložiť poznámku" submit={async () => {
      if (!training.response) throw new Error("Najprv vyber účasť.");
      await api("trainings/" + training.id + "/rsvp", "PUT", {response: training.response, note});
      await refresh();
      setNoteOpen(false);
    }}><label>Poznámka<input value={note} maxLength="1000" onChange={event => setNote(event.target.value)} /></label></Form>}
  </div>;
}

function TrainingCard({training, staff, refresh, open, prominent = false}) {
  const day = new Date(training.starts_at);
  return <article className={"card training-card event-" + (training.kind || "training") + " " + (prominent ? "prominent " : "") + (training.cancelled ? "cancelled" : "")}>
    <button className="event-link" onClick={open}>
      <span className="date-tile"><strong>{day.toLocaleDateString(uiLocale(), {day: "numeric", timeZone})}</strong>
        <span>{day.toLocaleDateString(uiLocale(), {month: "short", timeZone})}</span></span>
      <span className="event-text"><span className={"badge event-type " + (training.kind || "training")}>{kinds[training.kind] || "Tréning"}</span><strong>{training.title}</strong>
        <span className="meta"><Clock size={14} />{clock(training.starts_at)}{training.ends_at && " – " + clock(training.ends_at)}</span>
        <span className="meta"><MapPin size={14} />{training.location}</span>
      </span><ChevronRight size={20} />
    </button>
    {training.cancelled ? <p className="notice">Udalosť bola zrušená</p> : <>
      {staff ? <button className="count-strip" onClick={open}>
        <span><i className="dot yes" />{training.counts?.yes || 0} prídu</span>
        <span><i className="dot pending" />{training.counts?.unanswered || 0} bez odpovede</span><ArrowUpRight size={16} />
      </button> : upcoming(training) ? <RSVP training={training} refresh={refresh} /> :
        <p className="meta">{training.attended === true ? "Bol si prítomný" : training.attended === false ? "Bol si neprítomný" : "Udalosť sa už začala"}</p>}
    </>}
  </article>;
}

function TrainingWorkspace({training, staff}) {
  const [data, setData] = useState({plan: [], member_note: "", coach_note: "", feedback: []});
  const [draft, setDraft] = useState(null);
  const [drills, setDrills] = useState([]);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState({went_well: "", difficult: "", next_focus: ""});
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  async function load() {
    const workspace = await api("trainings/" + training.id + "/workspace");
    setData(workspace);
    if (workspace.feedback && !Array.isArray(workspace.feedback)) setFeedback({went_well: workspace.feedback.went_well || "", difficult: workspace.feedback.difficult || "", next_focus: workspace.feedback.next_focus || ""});
    if (staff) setDrills(await api("drills"));
  }
  useEffect(() => {load().catch(e => setError(e.message));}, [training.id]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setSeconds(value => {if (value <= 1) {setRunning(false); return 0;} return value - 1;}), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const changed = (key, value) => setDraft(current => ({...current, [key]: value}));
  async function save() {
    await api("trainings/" + training.id + "/workspace", "PUT", draft);
    setData(draft); setEditing(false);
  }
  const canFeedback = past(training) && training.attended === true && !training.cancelled;
  return <section className="training-workspace">
    {error && <p className="error" role="alert">{error}</p>}
    {staff ? <div className="toolbar end"><button onClick={() => {setDraft({...data, plan: [...(data.plan || [])]}); setEditing(!editing);}}><Pencil size={16} />{editing ? "Zavrieť úpravy" : "Upraviť plán a poznámky"}</button>
      {editing && <Action className="primary" run={save}>Uložiť</Action>}</div> : null}
    <section className="card workout-section"><h3><BookOpen size={19} />Plán tréningu</h3>
      {editing ? <>
        {(draft.plan || []).map((block, index) => <div className="workout-block-edit" key={index}>
          <label>Cvičenie<input value={block.title} maxLength="120" onChange={e => changed("plan", draft.plan.map((item, i) => i === index ? {...item, title: e.target.value} : item))} /></label>
          <div className="form-row"><label>Minúty<input type="number" min="1" max="240" value={block.duration_minutes || 10} onChange={e => changed("plan", draft.plan.map((item, i) => i === index ? {...item, duration_minutes: Number(e.target.value)} : item))} /></label>
            <button className="text-button" onClick={() => changed("plan", draft.plan.filter((_, i) => i !== index))}>Odobrať</button></div>
          <label>Pokyny<textarea rows="2" value={block.notes || ""} maxLength="1000" onChange={e => changed("plan", draft.plan.map((item, i) => i === index ? {...item, notes: e.target.value} : item))} /></label>
        </div>)}
        <button className="button" onClick={() => changed("plan", [...(draft.plan || []), {title: "", duration_minutes: 10, notes: ""}])}><Plus size={16} />Pridať blok</button>
        {drills.length > 0 && <label>Pridať z knižnice cvičení<select value="" onChange={e => {const drill = drills.find(item => String(item.id) === e.target.value); if (drill) changed("plan", [...draft.plan, {title: drill.title, duration_minutes: drill.duration_minutes, notes: drill.objective}]);}}><option value="">Vybrať cvičenie</option>{drills.map(drill => <option key={drill.id} value={drill.id}>{drill.title} · {drill.duration_minutes} min</option>)}</select></label>}
        <Form label="Pridať cvičenie do knižnice" reset submit={async form => {await api("drills", "POST", {...form, duration_minutes: Number(form.duration_minutes), difficulty: "basic"}); await load();}}>
          <details><summary>Nové cvičenie</summary><label>Názov<input name="title" maxLength="120" required /></label><label>Cieľ<input name="objective" maxLength="1000" /></label><label>Trvanie v minútach<input name="duration_minutes" type="number" min="1" max="240" defaultValue="10" /></label><label>Pomôcky<input name="equipment" maxLength="1000" /></label></details>
        </Form>
        <label>Poznámka pre členov<textarea rows="3" maxLength="4000" value={draft.member_note} onChange={e => changed("member_note", e.target.value)} /></label>
        <label>Súkromná poznámka trénerov<textarea rows="3" maxLength="4000" value={draft.coach_note} onChange={e => changed("coach_note", e.target.value)} /></label>
      </> : <>
        {data.plan?.length ? <ol className="workout-plan">{data.plan.map((block, index) => <li key={index}><div><strong>{block.title}</strong><span className="meta"><Timer size={14} />{block.duration_minutes} min</span>{block.notes && <p className="body small">{block.notes}</p>}</div>
          {staff && <button className="text-button" onClick={() => {setSeconds((block.duration_minutes || 10) * 60); setRunning(true);}}>Spustiť čas</button>}</li>)}</ol> : <p className="muted">Plán zatiaľ nie je pripravený.</p>}
        {running && <div className="timer-display" role="timer">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} <button className="text-button" onClick={() => setRunning(false)}>Zastaviť</button></div>}
        {data.member_note && <div className="notice"><strong>Poznámka pre tím</strong><p>{data.member_note}</p></div>}
        {staff && data.coach_note && <div className="private-note"><strong>Iba tréneri</strong><p>{data.coach_note}</p></div>}
      </>}
    </section>
    {!staff && canFeedback && <section className="card workout-section"><h3>Spätná väzba po tréningu</h3><p className="muted">Vidíš ju ty a tréneri.</p>
      <Form label="Uložiť feedback" submit={async values => {await api("trainings/" + training.id + "/feedback", "PUT", values); await load();}}>
        <label>Čo sa podarilo?<textarea name="went_well" rows="2" maxLength="1000" value={feedback.went_well} onChange={e => setFeedback({...feedback, went_well: e.target.value})} /></label>
        <label>Čo bolo náročné?<textarea name="difficult" rows="2" maxLength="1000" value={feedback.difficult} onChange={e => setFeedback({...feedback, difficult: e.target.value})} /></label>
        <label>Na čo sa chceš zamerať nabudúce?<textarea name="next_focus" rows="2" maxLength="1000" value={feedback.next_focus} onChange={e => setFeedback({...feedback, next_focus: e.target.value})} /></label>
      </Form>
    </section>}
    {staff && data.feedback?.length > 0 && <details className="card feedback-list"><summary>Feedback od členov ({data.feedback.length})</summary><ul className="people-list">{data.feedback.map(row => <li key={row.member_id}><div className="grow"><strong>{row.name}</strong>{row.went_well && <p><b>Podarilo sa:</b> {row.went_well}</p>}{row.difficult && <p><b>Náročné:</b> {row.difficult}</p>}{row.next_focus && <p><b>Nabudúce:</b> {row.next_focus}</p>}</div></li>)}</ul></details>}
  </section>;
}

function TrainingDetail({training, staff, places, close, refresh, openScanner}) {
  const [tab, setTab] = useState("info");
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState([]);
  const [filter, setFilter] = useState("all");
  const [edit, setEdit] = useState(false);
  const [error, setError] = useState("");
  async function load() {setRows(await api("trainings/" + training.id + "/roster"));}
  useEffect(() => {if (staff) load().catch(error => setError(error.message));}, [staff, training.id, training.updated_at]);
  const filtered = rows.filter(row => filter === "all" || (filter === "none" ? !row.response : row.response === filter));
  async function saveAttendance(ids, attended) {
    await api("trainings/" + training.id + "/attendance", "PUT", {member_ids: ids, attended});
    setSelected([]);
    await load();
    await refresh();
  }
  return <Modal title={training.title} close={close}>
    {edit ? <TrainingForm training={training} places={places} done={async () => {setEdit(false); await refresh();}} /> : <>
      <div className="tabs" role="tablist" aria-label="Detail udalosti">
        {[["info", "Informácie"], ["workout", "Tréning"], ...(staff ? [["rsvp", "Účasť"], ["attendance", "Dochádzka"]] : [])].map(([value, text]) =>
          <button role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{text}</button>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "workout" ? <TrainingWorkspace training={training} staff={staff} /> : tab === "info" ? <>
        {training.cancelled && <p className="notice">Udalosť bola zrušená</p>}
        <div className="detail-facts"><p><CalendarDays />{date(training.starts_at)}</p>
          {training.ends_at && <p><Clock />Do {clock(training.ends_at)}</p>}
          <p><MapPin />{training.location}</p></div>
        {training.instructions && <p className="body">{training.instructions}</p>}
        {!staff && upcoming(training) && <RSVP training={training} refresh={refresh} />}
        {staff && !training.cancelled && <div className="actions section-space">
          <button onClick={() => setEdit(true)}><Pencil size={17} />Upraviť</button>
          <Action className="danger" run={async () => {
            if (!window.confirm(localizeText("Zrušiť udalosť a zverejniť oznam pre tím? Udalosť zostane v kalendári označená ako zrušená.", activeLanguage))) return;
            await api("trainings/" + training.id + "/cancel", "POST"); await refresh();
          }}>Zrušiť udalosť</Action>
        </div>}
        {staff && training.can_delete && <div className="section-space"><Action className="danger" run={async () => {
          if (!window.confirm(localizeText("Natrvalo vymazať túto udalosť aj jej prihlášky, dochádzku a súvisiace automatické oznamy? Bez odoslania upozornenia. Táto akcia sa nedá vrátiť.", activeLanguage))) return;
          await api("trainings/" + training.id, "DELETE"); close(); await refresh();
        }}>Vymazať bez upozornenia</Action></div>}
      </> : <>
        {tab === "rsvp" && <div className="chips">
          {[["all", "Všetci"], ["yes", "Prídu"], ["no", "Neprídu"], ["maybe", "Nevedia"], ["none", "Bez odpovede"]].map(([value, text]) =>
            <button className={filter === value ? "selected" : ""} key={value} onClick={() => setFilter(value)}>{text}</button>)}
        </div>}
        {tab === "attendance" && past(training) && !training.cancelled && <button className="primary section-space" onClick={()=>openScanner(training)}><ScanLine size={18} />Skenovať členské QR</button>}
        {tab === "attendance" && (!past(training) || training.cancelled) && <p className="notice">Dochádzku možno zapísať od začiatku nezrušenej udalosti.</p>}
        {tab === "attendance" && past(training) && !training.cancelled && rows.length > 0 && <>
          <label className="checkbox"><input type="checkbox" checked={selected.length === rows.length} onChange={event => setSelected(event.target.checked ? rows.map(row => row.id) : [])} />Vybrať všetkých</label>
          {selected.length > 0 && <div className="actions"><Action run={() => saveAttendance(selected, true)}>Prítomní ({selected.length})</Action>
            <Action run={() => saveAttendance(selected, false)}>Neprítomní ({selected.length})</Action></div>}
        </>}
        <ul className="people-list">{(tab === "rsvp" ? filtered : rows).map(row => <li key={row.id}>
          {tab === "attendance" && past(training) && !training.cancelled &&
            <input type="checkbox" aria-label={"Vybrať " + row.name} checked={selected.includes(row.id)}
              onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />}
          <Avatar name={row.name} /><div className="grow"><strong>{row.name}</strong>
            <span className="meta">{labels[row.response] || "Bez odpovede"}</span>{row.note && <p className="small body">{row.note}</p>}</div>
          {tab === "attendance" && past(training) && !training.cancelled && <div className="attendance-buttons">
            <Action className={row.attended === true ? "yes selected" : ""} pressed={row.attended === true} run={() => saveAttendance([row.id], true)}><Check size={18} /><span className="sr-only">Prítomný {row.name}</span></Action>
            <Action className={row.attended === false ? "no selected" : ""} pressed={row.attended === false} run={() => saveAttendance([row.id], false)}><X size={18} /><span className="sr-only">Neprítomný {row.name}</span></Action>
          </div>}
        </li>)}</ul>
        {rows.length === 0 && <Empty icon={Users}>Zatiaľ žiadni účastníci.</Empty>}
      </>}
    </>}
  </Modal>;
}

function Calendar({trainings, staff, places, refresh, openTraining}) {
  const [view, setView] = useState("list");
  const [period, setPeriod] = useState("upcoming");
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [selectedDay, setSelectedDay] = useState(null);
  const [create, setCreate] = useState(false);
  const filtered = trainings.filter(t => period === "all" || (period === "past" ? past(t) : !past(t)));
  const [year, monthNumber] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const padding = (start.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  function moveMonth(offset) {
    setMonth(new Date(Date.UTC(year, monthNumber - 1 + offset, 1)).toISOString().slice(0, 7));
    setSelectedDay(null);
  }
  const shown = view === "month" ? trainings.filter(t => dayKey(t.starts_at).startsWith(month) && (!selectedDay || dayKey(t.starts_at) === selectedDay)).sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at)) : filtered;
  return <>
    <div className="toolbar">
      <div className="segmented"><button className={view === "list" ? "selected" : ""} onClick={() => setView("list")}>Zoznam</button>
        <button className={view === "month" ? "selected" : ""} onClick={() => setView("month")}>Mesiac</button></div>
      {staff && <button className="primary" onClick={() => setCreate(true)}><Plus size={18} />Naplánovať</button>}
    </div>
    {view === "list" ? <div className="chips">{[["upcoming", "Nadchádzajúce"], ["past", "História"], ["all", "Všetky"]].map(([value, text]) =>
      <button key={value} className={period === value ? "selected" : ""} onClick={() => setPeriod(value)}>{text}</button>)}</div> :
      <section className="card calendar">
        <div className="month-heading"><button className="icon-button" aria-label="Predchádzajúci mesiac" onClick={() => moveMonth(-1)}><ChevronLeft /></button>
          <h2>{start.toLocaleDateString(uiLocale(), {month: "long", year: "numeric", timeZone: "UTC"})}</h2>
          <button className="icon-button" aria-label="Nasledujúci mesiac" onClick={() => moveMonth(1)}><ChevronRight /></button></div>
        <div className="calendar-grid">{["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map(day => <span className="weekday" key={day}>{day}</span>)}
          {Array.from({length: padding}, (_, i) => <span key={"pad" + i} />)}
          {Array.from({length: days}, (_, i) => {
            const key = month + "-" + String(i + 1).padStart(2, "0");
            const activities = trainings.filter(t => dayKey(t.starts_at) === key && !t.cancelled);
            const types = [...new Set(activities.map(t => t.kind || "training"))];
            const summary = activities.map(t => kinds[t.kind || "training"] + ": " + t.title).join(", ");
            return <button key={key} aria-label={"Vybrať " + key + (summary ? " · " + summary : "")} aria-pressed={selectedDay === key}
              className={(key === today() ? "today " : "") + (key === selectedDay ? "selected " : "") + (types.length ? "has-activities " : "") + (types.length === 1 ? "activity-" + types[0] : "")}
              onClick={() => setSelectedDay(selectedDay === key ? null : key)}>
              <span className="calendar-day-number">{i + 1}</span>
              {types.length > 0 && <span className="calendar-markers" aria-hidden="true">{types.map(type =>
                <span className={"event-marker " + type} key={type} />)}</span>}
              {activities.length > 0 && <span className="calendar-event-count" aria-hidden="true">{activities.length}</span>}
            </button>;
          })}</div>
        <div className="calendar-legend">{Object.entries(kinds).map(([type, name]) =>
          <span key={type}><span className={"event-marker " + type} />{name}</span>)}</div>
        {staff && selectedDay && <button className="text-button" onClick={() => setCreate(true)}><Plus size={16} />Pridať udalosť na {selectedDay.split("-").reverse().join(".")}</button>}
      </section>}
    <div className="event-list">{shown.length ? shown.map((t, i) => <React.Fragment key={t.id}>
      {(i === 0 || dayKey(shown[i - 1].starts_at) !== dayKey(t.starts_at)) && <h2 className="day-heading">{new Date(t.starts_at).toLocaleDateString(uiLocale(), {weekday: "long", day: "numeric", month: "long", timeZone})}</h2>}
      <TrainingCard training={t} staff={staff} refresh={refresh} open={() => openTraining(t.id)} />
    </React.Fragment>) : <Empty>V tomto období nie sú žiadne udalosti.</Empty>}</div>
    {create && <Modal title="Nová udalosť" close={() => setCreate(false)}><TrainingForm initialDay={selectedDay} places={places} done={async () => {setCreate(false); await refresh();}} /></Modal>}
  </>;
}
function Members({user,superadmin,staff=true,onMessage,onCard,onTrialBanner,userId}) {
  const [members,setMembers]=useState([]),[query,setQuery]=useState(""),[filter,setFilter]=useState("active");
  const [selected,setSelected]=useState(null),[form,setForm]=useState(false),[link,setLink]=useState(""),[inviteTarget,setInviteTarget]=useState(null);
  const [attendance,setAttendance]=useState([]),[development,setDevelopment]=useState(null),[error,setError]=useState("");
  const [section,setSection]=useState("members"),[catalog,setCatalog]=useState([]),[requested,setRequested]=useState([]);
  const [requests,setRequests]=useState([]),[config,setConfig]=useState([]),[menus,setMenus]=useState([]);
  const [inviteRoles,setInviteRoles]=useState(["player"]),[editRoles,setEditRoles]=useState([]),[bannerEnabled,setBannerEnabled]=useState(true);
  const canReview=user.role==="superadmin"||user.roles?.includes("club_leader")||user.roles?.includes("deputy_leader");
  const canCreateInvites=superadmin||user.can_create_invites;
  const canAssignInviteRoles=superadmin||user.can_assign_invite_roles;
  const inviteRoleOptions=superadmin?config:catalog;
  async function load() {setMembers(await api("members"));}
  async function loadRequests() {if(canReview)setRequests(await api("role-requests"));}
  async function loadAdmin() {
    if(!superadmin)return;
    const [result,settings]=await Promise.all([api("role-config"),api("public/settings")]);
    setConfig(result.roles);setCatalog(result.roles);setMenus(result.menus);setBannerEnabled(settings.trial_banner_enabled);
  }
  useEffect(()=>{Promise.all([load(),loadRequests(),loadAdmin(),superadmin?Promise.resolve():api("role-catalog").then(setCatalog)]).catch(e=>setError(e.message));},[]);
  useEffect(()=>{let current=true;setAttendance([]);if(staff&&(selected?.roles||[]).includes("player"))api("members/"+selected.id+"/attendance").then(v=>{if(current)setAttendance(v);}).catch(e=>setError(e.message));return()=>{current=false};},[staff,selected?.id,selected?.role]);
  useEffect(()=>{let current=true;setDevelopment(null);if(staff&&(selected?.roles||[]).includes("player"))api("members/"+selected.id+"/development").then(v=>{if(current)setDevelopment(v);}).catch(e=>setError(e.message));return()=>{current=false};},[staff,selected?.id,selected?.role]);
  useEffect(()=>{if(superadmin&&selected)setEditRoles(selected.roles||["player"]);},[superadmin,selected?.id]);
  const found=members.filter(m=>(m.name+" "+(m.email||"")).toLowerCase().includes(query.toLowerCase())&&
    (filter==="all"||(filter==="coaches"?(m.roles||[]).includes("coach")&&m.active:filter==="invited"?!m.registered&&m.active:filter==="inactive"?!m.active:m.active&&m.registered)));
  const status=m=>!m.active?"Neaktívny":!m.registered?"Pozvaný":"Aktívny";
  const roleName=key=>catalog.find(x=>x.key===key)?.name||({player:"Hráč",coach:"Tréner"}[key]||key);
  function toggle(setter,current,key){setter(current.includes(key)?current.filter(x=>x!==key):[...current,key]);}
  const navLabel={home:"Domov",calendar:"Kalendár",attendance:"Dochádzka",scanner:"Skenovať",messages:"Správy",announcements:"Oznamy",members:"Členovia",team:"Tímy",development:"Rozvoj hráčov",lineups:"Zostavy",drills:"Knižnica cvičení",equipment:"Vybavenie",documents:"Dokumenty"};
  return <>
    {superadmin&&<div className="tabs member-admin-tabs"><button className={section==="members"?"selected":""} onClick={()=>setSection("members")}>Členovia</button>
      <button className={section==="requests"?"selected":""} onClick={()=>setSection("requests")}>Žiadosti o roly {requests.length>0&&<span className="counter">{requests.length}</span>}</button>
      <button className={section==="roles"?"selected":""} onClick={()=>setSection("roles")}>Roly a prístupy</button></div>}
    {!superadmin&&canReview&&<button className="card quick-link role-request-alert" onClick={()=>setSection(section==="requests"?"members":"requests")}><ShieldCheck/><span className="grow"><strong>Žiadosti o pridanie rolí</strong><span className="meta">{requests.length?"Čakajúce žiadosti: "+requests.length:"Žiadne čakajúce žiadosti"}</span></span>{requests.length>0&&<span className="counter">{requests.length}</span>}</button>}
    {section==="members"&&<>
      <div className="toolbar"><label className="search"><Search size={18}/><input type="search" aria-label="Hľadať člena" placeholder="Hľadať podľa mena…" value={query} onChange={e=>setQuery(e.target.value)}/></label>
        {canCreateInvites&&<button className="primary" onClick={()=>{setLink("");setInviteTarget(null);setInviteRoles(["player"]);setForm(true);}}><Plus size={18}/>Pozvať člena</button>}</div>
      <div className="chips">{[["active","Aktívni"],["coaches","Tréneri"],["invited","Pozvaní"],["inactive","Neaktívni"],["all","Všetci"]].map(([value,text])=><button key={value} className={filter===value?"selected":""} onClick={()=>setFilter(value)}>{text}</button>)}</div>
      {error&&<p className="error" role="alert">{error}</p>}
      <div className="card flush"><ul className="people-list">{found.map(member=><li key={member.id}><button className="person-link" onClick={()=>{setSelected(member);setLink("");}}>
        <Avatar name={member.name}/><span className="grow"><strong>{member.name}</strong><span className="meta">Člen · {(member.roles||[]).map(roleName).join(" · ")} · {member.email}</span>
        <span className="meta">{member.recorded_count>0?"Dochádzka "+member.attended_count+"/"+member.recorded_count:"Dochádzka zatiaľ bez záznamu"}</span></span>
        <span className={"badge "+(member.active?"positive":"")}>{status(member)}</span><ChevronRight size={18}/></button></li>)}
      </ul>{found.length===0&&<Empty icon={Users}>Žiadne zodpovedajúce účty.</Empty>}</div>
      {form&&<Modal title="Pozvať člena" close={()=>setForm(false)}>{link?<InviteLink link={link}/>:<Form label="Vytvoriť pozvánku" submit={async data=>{
        if(canAssignInviteRoles&&!inviteRoles.length)throw new Error("Vyber aspoň jednu rolu.");
        const result=await api("members/invite","POST",{...data,roles:canAssignInviteRoles?inviteRoles:["player"]});await load();setLink(result.invite_url);
      }}><label>Meno<input name="name" maxLength="120" autoComplete="name" defaultValue={inviteTarget?.name||""} required/></label><label>E-mail<input name="email" type="email" maxLength="254" autoComplete="email" defaultValue={inviteTarget?.email||""} required/></label>
        {canAssignInviteRoles&&<fieldset className="role-checkboxes"><legend>Roly pri pozvánke</legend>{inviteRoleOptions.map(item=><label className="checkbox" key={item.key}><input type="checkbox" checked={inviteRoles.includes(item.key)} onChange={()=>toggle(setInviteRoles,inviteRoles,item.key)}/>{item.name}{!item.available&&<span className="badge">Funkcia zatiaľ nedostupná</span>}</label>)}</fieldset>}
      </Form>}</Modal>}
      {selected&&<Modal title={selected.name} close={()=>setSelected(null)}><div className="profile-heading"><Avatar name={selected.name}/><div><span className="badge">Člen klubu</span><p>{selected.email||"admin"}</p><p>{(selected.roles||[]).map(roleName).join(" · ")}</p></div></div>
        {staff&&(selected.roles||[]).includes("player")&&selected.active&&<button className="section-space" onClick={()=>onCard(selected)}><QrCode size={17}/>Členský QR kód</button>}
        <div className="actions">{!superadmin&&selected.id!==userId&&selected.active&&selected.registered&&<button className="primary" onClick={()=>{onMessage(selected.id);setSelected(null);}}><MessageCircle size={17}/>Napísať správu</button>}
          {staff&&<>
          {(superadmin||selected.role==="member")&&<Action run={async()=>{await api("members/"+selected.id+"/active","PUT",{active:!selected.active});setSelected({...selected,active:!selected.active});await load();}}>{selected.active?"Deaktivovať":"Aktivovať"}</Action>}
          {(superadmin||selected.role==="member")&&selected.active&&selected.registered&&<Action run={async()=>{const r=await api("members/"+selected.id+"/reset","POST");setLink(r.invite_url);}}>Obnoviť heslo</Action>}
          {canCreateInvites&&selected.active&&!selected.registered&&<Action run={async()=>{setInviteTarget(selected);setInviteRoles(canAssignInviteRoles?(selected.roles||["player"]):["player"]);setLink("");setForm(true);setSelected(null);}}>Nová pozvánka</Action>}
          </>}
        </div>{link&&<InviteLink link={link}/>}
        {superadmin&&<section className="section-space"><h3>Funkčné roly</h3>{config.map(role=><label className="checkbox role-member-checkbox" key={role.key}><input type="checkbox" checked={editRoles.includes(role.key)} onChange={()=>toggle(setEditRoles,editRoles,role.key)}/>{role.name}{!role.available&&<span className="badge">Funkcia zatiaľ nedostupná</span>}</label>)}
          <Action className="primary section-space" run={async()=>{if(!editRoles.length)throw new Error("Vyber aspoň jednu rolu.");const r=await api("members/"+selected.id+"/roles","PUT",{roles:editRoles});const updated={...selected,roles:r.roles,role:r.roles.some(k=>config.find(x=>x.key===k)?.admin_access)?"coach":"member"};setSelected(updated);await load();}}>Uložiť roly</Action>
          {selected.registered&&<Action className="danger section-space" run={async()=>{if(!window.confirm("Natrvalo odstrániť člena "+selected.name+"?"))return;await api("members/"+selected.id,"DELETE");setSelected(null);await load();}}>Natrvalo odstrániť člena</Action>}
        </section>}
        {(selected.roles||[]).includes("player")&&<section className="section-space"><h3>Dochádzka</h3>{attendance.length?<ul className="records">{attendance.map((row,i)=><li key={i}><div className="grow"><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span></div><span className={"badge "+(row.attended?"positive":"")}>{row.attended?"Prítomný":"Neprítomný"}</span></li>)}</ul>:<p className="muted">Zatiaľ bez záznamu.</p>}</section>}
        {(selected.roles||[]).includes("player")&&staff&&<section className="section-space development-section"><h3>Rozvoj hráča</h3>{development?<>
          <Form label="Uložiť trénerovu poznámku" submit={async({note})=>{await api("members/"+selected.id+"/development/note","PUT",{note});setDevelopment({...development,note});}}><label>Súkromná poznámka trénerov<textarea name="note" rows="3" maxLength="4000" defaultValue={development.note}/></label></Form>
          <div className="skill-list">{development.skills.map(skill=><div className="skill-row" key={skill.skill}><strong>{skill.skill}</strong><span className="skill-level">{[1,2,3,4].map(level=><button type="button" aria-label={skill.skill+" "+level} className={level<=skill.level?"filled":""} key={level} onClick={async()=>{await api("members/"+selected.id+"/development/skills","PUT",{...skill,level});setDevelopment(await api("members/"+selected.id+"/development"));}}>●</button>)}</span></div>)}</div>
          <Form key={selected.id+":skill"} label="Pridať zručnosť" reset submit={async values=>{await api("members/"+selected.id+"/development/skills","PUT",{...values,level:Number(values.level)});setDevelopment(await api("members/"+selected.id+"/development"));}}><label>Zručnosť<input name="skill" maxLength="120" required/></label><label>Úroveň<select name="level" defaultValue="2"><option value="0">Na začiatku</option><option value="1">Základy</option><option value="2">Rozvíja sa</option><option value="3">Samostatný</option><option value="4">Istý</option></select></label><label>Poznámka<input name="note" maxLength="1000"/></label></Form>
          {development.feedback.length>0&&<details className="section-space"><summary>Tréningový feedback ({development.feedback.length})</summary><ul className="records">{development.feedback.map(row=><li key={row.training_id}><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span>{row.next_focus&&<p>{row.next_focus}</p>}</li>)}</ul></details>}
        </>:<p className="muted">Načítava sa…</p>}</section>}
      </Modal>}
    </>}
    {section==="requests"&&<section className="card role-requests-panel"><h2>Žiadosti o pridanie rolí</h2>{requests.length?requests.map(item=><article className="role-request-row" key={item.id}><div className="grow"><strong>{item.member_name} · {item.role_name}</strong><span className="meta">{item.email} · {date(item.created_at)}</span></div>
      {superadmin?<><Action className="primary" run={async()=>{await api("role-requests/"+item.id,"PUT",{status:"approved"});await Promise.all([loadRequests(),load()]);}}>Schváliť</Action><Action className="danger" run={async()=>{await api("role-requests/"+item.id,"PUT",{status:"rejected"});await loadRequests();}}>Zamietnuť</Action></>:<span className="badge">Čaká na schválenie</span>}</article>):<p className="muted">Žiadne čakajúce žiadosti.</p>}</section>}
    {section==="roles"&&superadmin&&<>
      <section className="card"><h2>Skúšobná prevádzka</h2><label className="checkbox"><input type="checkbox" checked={bannerEnabled} onChange={async e=>{const value=e.target.checked;setBannerEnabled(value);try{await api("admin/trial-banner","PUT",{enabled:value});onTrialBanner(value);}catch(err){setBannerEnabled(!value);setError(err.message);}}}/>Zobrazovať banner o skúšobnej prevádzke všetkým používateľom</label></section>
      <section className="card role-permissions-panel"><h2>Prístupy rolí k položkám menu</h2><p className="muted">Prístup sa uplatňuje v menu aj na API. Budúce moduly sú označené ako zatiaľ nedostupné.</p>
        {config.map(role=><details className="role-config-row" key={role.key}><summary><strong>{role.name}</strong><span className="meta">{role.available?"Dostupná rola":"Funkcie roly zatiaľ nie sú dostupné"}</span></summary><p>{role.description}</p>
          <div className="role-capabilities">{(role.capabilities||[]).map(feature=><span className="role-capability" key={feature.name}><span>{feature.name}</span><span className={"badge "+(feature.available?"positive":"planned-role")}>{feature.available?"Dostupné":"Zatiaľ nedostupné"}</span></span>)}</div>
          <div className="role-invite-permissions">
            <label className="checkbox"><input type="checkbox" checked={role.can_create_invites} onChange={e=>setConfig(rows=>rows.map(row=>row.key===role.key?{...row,can_create_invites:e.target.checked,can_assign_invite_roles:e.target.checked?row.can_assign_invite_roles:false}:row))}/>Môže vytvárať pozvánky</label>
            <label className="checkbox"><input type="checkbox" checked={role.can_assign_invite_roles} disabled={!role.can_create_invites} onChange={e=>setConfig(rows=>rows.map(row=>row.key===role.key?{...row,can_assign_invite_roles:e.target.checked}:row))}/>Môže priraďovať roly v pozvánkach</label>
          </div>
          <div className="role-menu-grid">{menus.map(menu=><label className="role-menu-setting" key={menu}><span>{navLabel[menu]}</span><select value={role.permissions[menu]||"none"} onChange={e=>setConfig(rows=>rows.map(row=>row.key===role.key?{...row,permissions:{...row.permissions,[menu]:e.target.value}}:row))}><option value="none">Bez prístupu</option><option value="read">Iba čítanie</option><option value="edit">Úprava</option></select></label>)}</div>
          <Action className="primary section-space" run={async()=>{await api("role-config/"+role.key,"PUT",{permissions:role.permissions,can_create_invites:role.can_create_invites,can_assign_invite_roles:role.can_assign_invite_roles});}}>Uložiť prístupy</Action>
        </details>)}
      </section>
    </>}
  </>;
}

function InviteLink({link}) {
  return <div className="invite"><p>Odkaz je platný 7 dní. Pošli ho používateľovi.</p><label>Odkaz<input readOnly value={link} onFocus={event => event.target.select()} /></label>
    {navigator.clipboard && <Action run={() => navigator.clipboard.writeText(link)}>Kopírovať odkaz</Action>}</div>;
}

function AttendanceOverview({openScanner}) {
  const initial = () => ({date_from: today().slice(0, 7) + "-01", date_to: today(),
    kinds: Object.keys(kinds), include_cancelled: false});
  const [draft, setDraft] = useState(initial);
  const [filters, setFilters] = useState(initial);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let current = true;
    const query = new URLSearchParams({kinds: filters.kinds.join(","), include_cancelled: String(filters.include_cancelled)});
    if (filters.date_from) query.set("date_from", filters.date_from);
    if (filters.date_to) query.set("date_to", filters.date_to);
    async function load(background = false) {
      if (!background) {setLoading(true); setResult(null);}
      try {
        const data = await api("attendance?" + query);
        if (current) {setResult(data); setError("");}
      } catch (error) {if (current) setError(error.message);}
      finally {if (current) setLoading(false);}
    }
    load();
    const timer = setInterval(() => {if (!document.hidden) load(true);}, 15000);
    const focus = () => {if (!document.hidden) load(true);};
    addEventListener("visibilitychange", focus);
    return () => {current = false; clearInterval(timer); removeEventListener("visibilitychange", focus);};
  }, [filters, revision]);
  const people = (result?.members || []).filter(person => person.name.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim()));
  const events = result?.events || [];
  const records = new Map((result?.attendance || []).map(row => [row.member_id + ":" + row.training_id, row.attended]));
  const status = (person, event) => event.cancelled ? "Zrušené" : !past(event) ? "Plánované" :
    records.get(person.id + ":" + event.id) === true ? "Prítomný" : records.get(person.id + ":" + event.id) === false ? "Neprítomný" : "Nezapísané";
  const classes = {"Prítomný": "present", "Neprítomný": "absent", "Nezapísané": "unknown", "Plánované": "planned", "Zrušené": "cancelled"};
  return <>
    <section className="card attendance-filters"><div className="row-between"><h2>Prehľad dochádzky tímu</h2><button onClick={()=>openScanner()}><ScanLine size={18} />Skenovať dochádzku</button></div>
      <details className="attendance-filter-details"><summary>Filtre a obdobie</summary><form onSubmit={event => {
        event.preventDefault();
        if (draft.date_from && draft.date_to && draft.date_from > draft.date_to) {setError("Dátum od nesmie byť neskôr než dátum do."); return;}
        setFilters({...draft, kinds: [...draft.kinds]});
      }}>
        <div className="attendance-date-filters">
          <label>Od<input type="date" value={draft.date_from} onChange={event => setDraft({...draft, date_from: event.target.value})} /></label>
          <label>Do<input type="date" value={draft.date_to} onChange={event => setDraft({...draft, date_to: event.target.value})} /></label>
        </div>
        <fieldset className="attendance-types"><legend>Typy udalostí</legend>
          {Object.entries(kinds).map(([key, label]) => <label className="checkbox" key={key}><input type="checkbox" checked={draft.kinds.includes(key)} onChange={event => setDraft({...draft,
            kinds: event.target.checked ? [...draft.kinds, key] : draft.kinds.filter(kind => kind !== key)})} />{label}</label>)}
        </fieldset>
        <label className="checkbox"><input type="checkbox" checked={draft.include_cancelled} onChange={event => setDraft({...draft, include_cancelled: event.target.checked})} />Zobraziť aj zrušené udalosti</label>
        <div className="actions"><button className="primary">Zobraziť</button>
          <button type="button" onClick={() => {const all = {date_from: "", date_to: "", kinds: Object.keys(kinds), include_cancelled: false}; setDraft(all); setFilters(all);}}>Celé obdobie</button>
          <button type="button" onClick={() => setRevision(value => value + 1)}>Obnoviť údaje</button>
        </div>
      </form></details>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <Empty>Načítava sa dochádzka…</Empty> : result && <>
      <div className="attendance-overview-toolbar"><label>Vyhľadať člena<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Meno člena" /></label>
        <p className="meta" role="status">Členovia: {people.length} · Udalosti: {events.length}</p></div>
      {!events.length ? <Empty icon={CalendarDays}>Pre vybrané filtre nie sú žiadne udalosti.</Empty> : !people.length ? <Empty icon={Users}>Žiadni členovia pre tento výber.</Empty> : <>
        <div className="attendance-table-scroll" tabIndex={0} role="region" aria-label="Tabuľka dochádzky členov, posúvateľná vodorovne aj zvislo">
          <table className="attendance-table"><caption className="sr-only">Členovia tímu a dochádzka na udalostiach podľa vybraných filtrov</caption>
            <thead><tr><th scope="col" className="attendance-name">Člen</th><th scope="col">Prítomný / zapísané</th>
              {events.map(event => <th scope="col" key={event.id} className={"attendance-event event-" + event.kind}>
                <span className={"badge event-type " + event.kind}>{kinds[event.kind]}</span><strong>{event.title}</strong>
                <span>{date(event.starts_at)}</span>{event.cancelled && <span>Zrušené</span>}
              </th>)}
            </tr></thead>
            <tbody>{people.map(person => {
              const recorded = events.filter(event => !event.cancelled && past(event) && records.has(person.id + ":" + event.id));
              const present = recorded.filter(event => records.get(person.id + ":" + event.id) === true).length;
              return <tr key={person.id}><th scope="row" className="attendance-name"><strong>{person.name}</strong>{!person.active && <span className="meta">Neaktívny</span>}</th>
                <td className="attendance-total">{present} / {recorded.length}</td>
                {events.map(event => {const label = status(person, event); return <td key={event.id} aria-label={person.name + ", " + event.title + ", " + date(event.starts_at) + ": " + label}>
                  <span className={"attendance-status " + classes[label]}>{label === "Prítomný" && <Check size={15} />}{label === "Neprítomný" && <X size={15} />}{label}</span>
                </td>;})}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </>}
    </>}
  </>;
}

function AnnouncementEditor({item, close, refresh}) {
  const [audience,setAudience]=useState(item?.audience || "team");
  const [people,setPeople]=useState([]);
  const [selected,setSelected]=useState(item?.recipient_ids || []);
  const [keep,setKeep]=useState((item?.attachments || []).map(f=>f.id));
  const [files,setFiles]=useState([]);
  const [query,setQuery]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{api("announcement-recipients").then(setPeople).catch(e=>setError(e.message));},[]);
  return <Modal title={item ? "Upraviť oznam" : "Nový oznam"} close={close}>
    {error && <p className="error" role="alert">{error}</p>}
    <Form label={item ? "Uložiť zmeny" : "Zverejniť oznam"} submit={async data=>{
      if (audience === "selected" && !selected.length) throw new Error("Vyber aspoň jedného adresáta.");
      const existing=(item?.attachments || []).filter(f=>keep.includes(f.id));
      if(existing.length+files.length>5 || files.reduce((sum,f)=>sum+f.size,0)>5*1024*1024)
        throw new Error("Najviac 5 príloh, spolu najviac 5 MB.");
      let draft;
      if(files.length){
        draft=await api("announcement-drafts","POST");
        for(const file of files){
          const name=Array.from(new TextEncoder().encode(file.name),b=>b.toString(16).padStart(2,"0")).join("");
          const response=await fetch(new URL("api/announcement-drafts/"+draft.id+"/attachments",base),{
            method:"POST",headers:{"X-Filename":name},body:file});
          if(!response.ok) throw new Error((await response.json()).detail || "Príloha sa nenahrala.");
        }
      }
      await api("announcements"+(item ? "/"+item.id : ""),item ? "PUT" : "POST",{
        title:data.title,body:data.body,pinned:data.pinned==="on",audience,recipient_ids:selected,
        keep_attachment_ids:keep,draft_id:draft?.id || null,notify:data.notify==="on"});
      close();await refresh();
    }}>
      <label>Názov<input name="title" maxLength="120" defaultValue={item?.title || ""} required /></label>
      <label>Text<textarea name="body" maxLength="4000" defaultValue={item?.body || ""} required /></label>
      <label>Adresáti<select value={audience} onChange={e=>setAudience(e.target.value)}>
        <option value="team">Celý tím</option><option value="coaches">Iba tréneri</option><option value="selected">Vybraní členovia a tréneri</option>
      </select></label>
      {audience==="selected" && <><label>Vyhľadať adresáta<input type="search" value={query} onChange={e=>setQuery(e.target.value)} /></label>
        <div className="recipient-picker">{people.filter(p=>p.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(person=><label className="checkbox" key={person.id}>
          <input type="checkbox" checked={selected.includes(person.id)} onChange={e=>setSelected(e.target.checked ? [...selected,person.id] : selected.filter(id=>id!==person.id))} />
          {person.name} · {roles[person.role]}
        </label>)}</div><p className="meta">Vybraných: {selected.length}</p></>}
      <label className="checkbox"><input name="pinned" type="checkbox" defaultChecked={item?.pinned || false} />Pripnúť na nástenku</label>
      {(item?.attachments || []).map(file=><label className="checkbox" key={file.id}><input type="checkbox" checked={keep.includes(file.id)} onChange={e=>setKeep(e.target.checked ? [...keep,file.id] : keep.filter(id=>id!==file.id))} />Ponechať {file.filename}</label>)}
      <label>Pridať prílohy<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" onChange={e=>setFiles(Array.from(e.target.files || []))} /></label>
      <p className="meta">PDF, PNG alebo JPEG. Najviac 5 príloh, spolu 5 MB.</p>
      <label className="checkbox"><input name="notify" type="checkbox" defaultChecked={!item} />Poslať push upozornenie adresátom</label>
      <p className="meta">Oznamy spravujú tréneri a vedenie klubu. Pri úprave sa potvrdenia prečítania vynulujú.</p>
    </Form>
  </Modal>;
}

function Bulletin({items, staff, refresh}) {
  const [editor,setEditor]=useState(null);
  useEffect(()=>{
    const id=Number(hash().get("notice"));
    if(id) document.getElementById("notice-"+id)?.scrollIntoView?.({block:"center"});
  },[items]);
  return <>
    {staff && <div className="toolbar end"><button className="primary" onClick={()=>setEditor({})}><Plus size={18} />Nový oznam</button></div>}
    {items.length ? <div className="bulletin-list">{items.map(item=><article className="card" key={item.id} id={"notice-"+item.id}>
      <div className="row-between"><span className="meta">{date(item.created_at)}</span>{item.pinned && <span className="badge"><Pin size={13} />Pripnuté</span>}</div>
      <h2>{item.title}</h2><p className="body">{item.body}</p>
      {staff && <p className="meta">{item.audience==="selected" ? "Vybraní adresáti" : item.audience==="coaches" ? "Iba tréneri" : "Celý tím"}</p>}
      {(item.attachments || []).length>0 && <ul className="attachment-list">{item.attachments.map(file=><li key={file.id}><a href={new URL("api/announcements/"+item.id+"/attachments/"+file.id,base).href}><Download size={16} />{file.filename}</a></li>)}</ul>}
      <div className="actions section-space">
        {!item.is_read ? <Action className="text-button" run={async()=>{await api("announcements/"+item.id+"/read","POST");await refresh();}}><CheckCheck size={16} />Prečítané</Action> : <span className="meta"><CheckCheck size={16} />Prečítané</span>}
        {staff && <>
          <Action className="text-button" run={async()=>{await api("announcements/"+item.id+"/pin","PUT",{pinned:!item.pinned});await refresh();}}><Pin size={16} />{item.pinned ? "Odopnúť" : "Pripnúť"}</Action>
          <button onClick={()=>setEditor(item)}><Pencil size={16} />Upraviť</button>
          <Action className="danger" run={async()=>{
            if(!window.confirm(localizeText("Natrvalo vymazať oznam aj prílohy? Bez odoslania upozornenia.", activeLanguage))) return;
            await api("announcements/"+item.id,"DELETE");await refresh();
          }}>Vymazať</Action>
        </>}
      </div>
    </article>)}</div> : <Empty icon={Megaphone}>Zatiaľ žiadne oznamy.</Empty>}
    {editor && <AnnouncementEditor item={editor.id ? editor : null} close={()=>setEditor(null)} refresh={refresh} />}
  </>;
}

function GroupEditor({contacts, group, user, close, done}) {
  const [selected, setSelected] = useState(() => group ? group.members.filter(m => m.id !== user.id).map(m => m.id) : []);
  const [query, setQuery] = useState("");
  return <Modal title={group ? "Upraviť skupinu" : "Nová skupina"} close={close}>
    <Form label={group ? "Uložiť skupinu" : "Vytvoriť skupinu"} submit={async data => {
      if (selected.length === 0) throw new Error("Vyber aspoň jedného ďalšieho účastníka.");
      const result = await api(group ? "chat-groups/" + group.id : "chat-groups", group ? "PUT" : "POST", {name: data.name, member_ids: selected});
      await done(result.group_id || group.id);
    }}>
      <label>Názov skupiny<input name="name" defaultValue={group?.name || ""} maxLength="120" required /></label>
      <label className="search"><Search size={18} /><input type="search" value={query} placeholder="Hľadať ľudí…" aria-label="Hľadať účastníkov" onChange={event => setQuery(event.target.value)} /></label>
      <p className="muted small">Vybraní účastníci: {selected.length + 1} vrátane teba</p>
      <div className="recipient-list">
        {contacts.filter(person => person.name.toLowerCase().includes(query.toLowerCase())).map(person =>
          <label className="recipient-check" key={person.id}>
            <input type="checkbox" checked={selected.includes(person.id)} onChange={event =>
              setSelected(event.target.checked ? [...selected, person.id] : selected.filter(id => id !== person.id))} />
            <Avatar name={person.name} /><span className="grow"><strong>{person.name}</strong><span className="meta">{roles[person.role]}</span></span>
          </label>)}
      </div>
    </Form>
  </Modal>;
}

function Messages({user, conversations, refresh, initialContact}) {
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(initialContact ? {type: "private", id: initialContact} : hash().get("group") ? {type: "group", id: Number(hash().get("group"))} : null);
  const [messages, setMessages] = useState([]);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const [newMessage, setNewMessage] = useState(false);
  const [groupEditor, setGroupEditor] = useState(null);
  const [groupInfo, setGroupInfo] = useState(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [error, setError] = useState("");
  const scroller = useRef(null);
  const scrollPending = useRef(true);
  const selectedKey = selected ? selected.type + ":" + selected.id : "";
  const activeKey = useRef(selectedKey);
  activeKey.current = selectedKey;
  useEffect(() => {
    let current = true;
    const load = () => api("contacts").then(rows => {if (current) setContacts(rows);}).catch(error => {if (current) setError(error.message);});
    load();
    const timer = setInterval(() => {if (!document.hidden) load();}, 15000);
    return () => {current = false; clearInterval(timer);};
  }, []);
  const conversationKey = item => item.type === "group" ? "group:" + item.group_id : "private:" + item.contact_id;
  const rows = [...conversations];
  if (selected?.type === "private" && !rows.some(row => conversationKey(row) === selectedKey)) {
    const contact = contacts.find(person => person.id === selected.id);
    if (contact) rows.push({...contact, contact_id: contact.id, id: null, type: "private", unread: 0});
  }
  const activeConversation = rows.find(row => conversationKey(row) === selectedKey);
  const person = selected?.type === "private" ? contacts.find(person => person.id === selected.id) : null;
  const canSend = selected?.type === "group" ? Boolean(activeConversation) : Boolean(person);
  const latest = activeConversation?.id;
  const messagePath = selection => "messages?" + (selection.type === "group" ? "group_id=" : "contact_id=") + selection.id;
  async function markRead(selection, rows) {
    if (selection.type === "group" && rows.length) {
      await api("chat-groups/" + selection.id + "/read", "POST", {last_message_id: rows[0].id});
    } else {
      const unread = rows.filter(row => row.recipient_id === user.id && !row.read_at);
      if (unread.length) await api("messages/read", "POST", unread.map(row => row.id));
    }
  }
  function openConversation(selection) {
    if (selection.type + ":" + selection.id !== selectedKey) {
      setMessages([]); setMore(false); setError("");
    }
    setSelected(selection); setNewMessage(false); setGroupInfo(null);
  }
  useEffect(() => {
    let current = true;
    if (selected) {
      const selection = {...selected};
      scrollPending.current = true;
      api(messagePath(selection)).then(async rows => {
        if (!current) return;
        setMessages(rows);
        setMore(rows.length === 200);
        await markRead(selection, rows);
        if (current) await refresh();
      }).catch(error => {if (current) setError(error.message);});
    }
    return () => {current = false;};
  }, [selectedKey, latest, user.id]);
  useEffect(() => {
    if (scroller.current && scrollPending.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
      scrollPending.current = false;
    }
  }, [messages]);
  return <div className={"chat card flush " + (selected ? "conversation-open" : "")}>
    <aside className="conversation-list">
      <div className="chat-list-actions"><button className="primary" onClick={() => {setRecipientQuery(""); setNewMessage(true);}}><Plus size={17} />Nová správa</button>
        {user.role === "coach" && <button className="icon-button" aria-label="Nová skupina" onClick={() => setGroupEditor({})}><Users size={20} /></button>}
      </div>
      <label className="search"><Search size={18} /><input type="search" aria-label="Hľadať konverzáciu" placeholder="Hľadať konverzáciu…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {error && !selected && <p className="error chat-list-error" role="alert">{error}</p>}
      {rows.filter(row => row.name.toLowerCase().includes(query.toLowerCase())).map(row => {
        const group = row.type === "group";
        const key = conversationKey(row);
        return <button className={"conversation-row " + (selectedKey === key ? "active" : "")} key={key}
          onClick={() => openConversation({type: group ? "group" : "private", id: group ? row.group_id : row.contact_id})}>
          {group ? <span className="avatar group-avatar"><Users size={21} /></span> : <Avatar name={row.name} />}
          <span className="grow"><strong>{row.name}</strong><span className="preview">{row.body ? (group && row.sender ? row.sender + ": " : "") + row.body :
            row.system_key === "coaches" ? "Skupina trénerov" : group ? "Skupinová konverzácia" : "Začať konverzáciu"}</span></span>
          <span className="conversation-meta">{row.created_at && <small>{clock(row.created_at)}</small>}{row.unread > 0 && <span className="counter">{row.unread}</span>}</span>
        </button>;
      })}
      {rows.length === 0 && <Empty icon={MessageCircle}>Začni konverzáciu tlačidlom Nová správa.</Empty>}
    </aside>
    <section className="conversation-pane">
      {selected ? <>
        <div className="chat-head">
          <button className="icon-button chat-back" aria-label="Späť na konverzácie" onClick={() => setSelected(null)}><ChevronLeft /></button>
          {selected.type === "group" ? <span className="avatar group-avatar"><Users size={19} /></span> : <Avatar name={activeConversation?.name || person?.name || "Kontakt"} />}
          <strong className="grow">{activeConversation?.name || person?.name || "Konverzácia"}</strong>
          {selected.type === "group" && <Action className="icon-button" run={async () => setGroupInfo(await api("chat-groups/" + selected.id))}>
            <Settings2 size={19} /><span className="sr-only">Účastníci a nastavenia skupiny</span>
          </Action>}
        </div>
        <div className="message-stream" ref={scroller}>
          {error && <p className="error" role="alert">{error}</p>}
          {more && <Action className="text-button" run={async () => {
            const key = selectedKey;
            const page = await api(messagePath(selected) + "&before=" + messages.at(-1).id);
            if (activeKey.current === key) {setMessages([...messages, ...page]); setMore(page.length === 200);}
          }}>Staršie správy</Action>}
          {messages.length ? [...messages].reverse().map(item => <div className={"message " + (item.sender_id === user.id ? "outgoing" : "")} key={item.id}>
            {selected.type === "group" && item.sender_id !== user.id && <strong className="message-author">{item.sender}</strong>}
            <p>{item.body}</p><span>{date(item.created_at)}{selected.type === "private" && item.sender_id === user.id && item.read_at && <CheckCheck size={13} />}</span>
          </div>) : <p className="muted small">Tu sa začína vaša konverzácia.</p>}
        </div>
        {canSend ? <div className="composer"><Form key={selectedKey} label={<><Send size={18} /><span className="sr-only">Odoslať správu</span></>} reset submit={async data => {
          const key = selectedKey;
          const destination = selected.type === "group" ? {group_id: selected.id} : {recipient_id: selected.id};
          await api("messages", "POST", {...destination, body: data.body});
          const rows = await api(messagePath(selected));
          if (activeKey.current === key) {scrollPending.current = true; setMessages(rows); await markRead(selected, rows);}
          await refresh();
        }}><label className="sr-only" htmlFor="message-body">Správa</label><textarea id="message-body" name="body" rows="1" maxLength="4000" placeholder="Napíš správu…" required /></Form></div> :
          <p className="notice">Do tejto konverzácie už nemožno posielať správy.</p>}
      </> : <Empty icon={MessageCircle}>Vyber konverzáciu alebo vytvor novú správu.</Empty>}
    </section>
    {newMessage && <Modal title="Nová správa" close={() => setNewMessage(false)}>
      <label className="search"><Search size={18} /><input type="search" aria-label="Hľadať adresáta" value={recipientQuery} placeholder="Hľadať člena alebo trénera…" onChange={event => setRecipientQuery(event.target.value)} /></label>
      {user.role === "coach" && <button className="button section-space" onClick={() => {setNewMessage(false); setGroupEditor({});}}><Users size={18} />Vytvoriť skupinu</button>}
      <ul className="people-list recipient-list">{contacts.filter(person => person.name.toLowerCase().includes(recipientQuery.toLowerCase())).map(person =>
        <li key={person.id}><button className="person-link" onClick={() => openConversation({type: "private", id: person.id})}><Avatar name={person.name} /><span className="grow"><strong>{person.name}</strong><span className="meta">{roles[person.role]}</span></span><ChevronRight size={18} /></button></li>)}</ul>
      {contacts.length === 0 && <p className="muted section-space">Zatiaľ žiadne dostupné kontakty.</p>}
    </Modal>}
    {groupInfo && <Modal title={groupInfo.name} close={() => setGroupInfo(null)}>
      <p className="muted">{groupInfo.members.length} účastníkov</p>
      {groupInfo.system_key && <p className="small">Účastníci tejto skupiny sa určujú automaticky podľa rolí v klube.</p>}
      <ul className="people-list">{groupInfo.members.map(person => <li key={person.id}><Avatar name={person.name} /><span className="grow"><strong>{person.name}</strong><span className="meta">{roles[person.role]}</span></span></li>)}</ul>
      {groupInfo.can_manage && <button className="primary section-space" onClick={() => {setGroupEditor(groupInfo); setGroupInfo(null);}}><Pencil size={17} />Upraviť názov a účastníkov</button>}
    </Modal>}
    {groupEditor && <GroupEditor group={groupEditor.id ? groupEditor : null} contacts={contacts} user={user} close={() => setGroupEditor(null)}
      done={async group_id => {setGroupEditor(null); await refresh(); openConversation({type: "group", id: group_id});}} />}
  </div>;
}

function Batteries({staff, initialCode, openScanner}) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(initialCode || null);
  const [events, setEvents] = useState([]);
  const [query, setQuery] = useState("");
  const [create, setCreate] = useState(false);
  const [action, setAction] = useState(null);
  const [error, setError] = useState("");
  async function load() {setItems(await api("batteries"));}
  useEffect(() => {load().catch(error => setError(error.message));}, []);
  useEffect(() => {
    let current = true;
    setEvents([]);
    if (selected) api("batteries/" + encodeURIComponent(selected) + "/events")
      .then(rows => {if (current) setEvents(rows);}).catch(error => {if (current) setError(error.message);});
    return () => {current = false;};
  }, [selected]);
  const battery = items.find(item => item.code === selected);
  return <>
    <div className="toolbar"><label className="search"><Search size={18} /><input type="search" aria-label="Hľadať batériu" placeholder="Kód alebo označenie…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button onClick={()=>openScanner()}><ScanLine size={18} />Skenovať batériu</button>
      {staff && <button className="primary" onClick={() => setCreate(true)}><Plus size={18} />Batéria</button>}</div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="equipment-grid">{items.filter(b => (b.code + " " + b.label).toLowerCase().includes(query.toLowerCase())).map(b =>
      <button className="card equipment-card" key={b.code} onClick={() => {setSelected(b.code); setAction(null);}}><Battery size={25} /><strong>{b.code}</strong><span className="muted">{b.label}</span>
        <span className={"badge " + (["damaged", "retired"].includes(b.status) ? "warning" : "positive")}>{batteryLabels[b.status] || "Bez záznamu"}</span>
        <span className="meta">{b.charges} evidovaných nabití</span>
      </button>)}</div>
    {items.length === 0 && <Empty icon={Battery}>Zatiaľ žiadne batérie. QR štítok otvorí detail priamo v aplikácii.</Empty>}
    {selected && <Modal title={battery ? battery.code : "Batéria"} close={() => {setSelected(null); setAction(null);}}>
      {battery ? <>
        <p className="muted">{battery.label}</p><p><span className="badge">{batteryLabels[battery.status] || "Bez záznamu"}</span></p>
        {staff && <a className="button section-space" href={new URL("api/batteries/" + battery.code + "/label.svg", base)} download={battery.code + ".svg"}><Download size={17} />QR štítok</a>}
        {battery.status !== "retired" && <div className="battery-actions section-space">
          {Object.entries(batteryLabels).filter(([value]) => (staff || value === "used") &&
            (battery.status !== "damaged" || value === "retired" || value === "damaged")).map(([value, text]) =>
              <button key={value} className={action === value ? "selected" : ""} onClick={() => setAction(value)}>{text}</button>)}
        </div>}
        {action && <Form label={"Zapísať · " + batteryLabels[action]} submit={async data => {
          await api("batteries/" + battery.code + "/events", "POST", {action, note: data.note});
          setEvents(await api("batteries/" + battery.code + "/events")); setAction(null); await load();
        }}><label>Poznámka (voliteľná)<input name="note" maxLength="1000" /></label></Form>}
        <h3 className="section-space">História</h3><ul className="timeline">{events.map(event => <li key={event.id}>
          <strong>{batteryLabels[event.action]}</strong><span className="meta">{date(event.created_at)} · {event.name}</span>
          {event.note && <p className="body small">{event.note}</p>}
        </li>)}</ul>
      </> : <p>Batéria sa načítava alebo sa nenašla.</p>}
    </Modal>}
    {create && <Modal title="Nová batéria" close={() => setCreate(false)}><Form label="Pridať batériu" submit={async data => {
      await api("batteries", "POST", data); await load(); setCreate(false); setSelected(data.code);
    }}><label>Kód<input name="code" pattern="LF-B[0-9]{2,6}" placeholder="LF-B01" required /></label><label>Označenie<input name="label" maxLength="120" required /></label></Form></Modal>}
  </>;
}

function DrillLibrary() {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  async function load() {setItems(await api("drills"));}
  useEffect(() => {load().catch(e => setError(e.message));}, []);
  return <>
    <div className="toolbar"><label className="search"><Search size={18} /><input aria-label="Hľadať cvičenie" placeholder="Hľadať cvičenie…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="drill-grid">{items.filter(item => (item.title + " " + item.objective + " " + item.equipment).toLowerCase().includes(query.toLowerCase())).map(item => <article className="card drill-card" key={item.id}>
      <div className="toolbar"><BookOpen /><strong className="grow">{item.title}</strong><span className="badge">{item.duration_minutes} min</span></div>
      {item.objective && <p>{item.objective}</p>}{item.equipment && <span className="meta">Pomôcky: {item.equipment}</span>}
    </article>)}</div>
    {items.length === 0 && <Empty icon={BookOpen}>Knižnica cvičení je zatiaľ prázdna. Cvičenia pridáš v úpravách plánu tréningu.</Empty>}
  </>;
}

function PlayerDevelopmentPage() {
  const [members, setMembers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [development, setDevelopment] = useState(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  async function loadMembers() {setMembers((await api("members")).filter(member => member.role === "member"));}
  async function open(member) {setSelected(member); setDevelopment(await api("members/" + member.id + "/development"));}
  useEffect(() => {loadMembers().catch(e => setError(e.message));}, []);
  return <>
    <div className="toolbar"><label className="search"><Search size={18} /><input aria-label="Hľadať hráča" placeholder="Hľadať hráča…" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card flush"><ul className="people-list">{members.filter(m => m.name.toLowerCase().includes(query.toLowerCase())).map(member => <li key={member.id}>
      <button className="person-link" onClick={() => open(member)}><Avatar name={member.name} /><span className="grow"><strong>{member.name}</strong><span className="meta">{member.active ? "Aktívny člen" : "Neaktívny člen"}</span></span><ChevronRight size={18} /></button>
    </li>)}</ul></div>
    {selected && <Modal title={selected.name} close={() => {setSelected(null); setDevelopment(null);}}>
      {!development ? <p className="muted">Načítava sa…</p> : <>
        <section className="development-section"><h3>Súkromná poznámka trénerov</h3><Form label="Uložiť poznámku" submit={async ({note}) => {await api("members/" + selected.id + "/development/note", "PUT", {note}); setDevelopment({...development, note});}}><label>Poznámka<textarea name="note" rows="4" maxLength="4000" defaultValue={development.note} /></label></Form></section>
        <section className="development-section section-space"><h3>Zručnosti</h3>{development.skills.length === 0 && <p className="muted">Zručnosti zatiaľ nie sú ohodnotené.</p>}
          {development.skills.map(skill => <div className="skill-row" key={skill.skill}><strong>{skill.skill}</strong><span className="skill-level">{[1,2,3,4].map(level => <button type="button" aria-label={skill.skill + " " + level} className={level <= skill.level ? "filled" : ""} key={level} onClick={async () => {await api("members/" + selected.id + "/development/skills", "PUT", {...skill, level}); setDevelopment(await api("members/" + selected.id + "/development"));}}>●</button>)}</span></div>)}
          <Form reset label="Pridať zručnosť" submit={async values => {await api("members/" + selected.id + "/development/skills", "PUT", {...values, level: Number(values.level)}); setDevelopment(await api("members/" + selected.id + "/development"));}}>
            <label>Zručnosť<input name="skill" maxLength="120" required /></label><label>Úroveň<select name="level" defaultValue="1">{["Na začiatku", "Základy", "Rozvíja sa", "Samostatný", "Istý"].map((label, i) => <option key={i} value={i}>{label}</option>)}</select></label><label>Poznámka<input name="note" maxLength="1000" /></label>
          </Form>
        </section>
        <details className="section-space"><summary>Tréningový feedback ({development.feedback.length})</summary><ul className="records">{development.feedback.map(row => <li key={row.training_id}><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span>{row.went_well && <p>Podarilo sa: {row.went_well}</p>}{row.difficult && <p>Náročné: {row.difficult}</p>}{row.next_focus && <p>Nabudúce: {row.next_focus}</p>}</li>)}</ul></details>
      </>}
    </Modal>}
  </>;
}

const slotLabels = ["Striker 1", "Striker 2", "Defender 1", "Defender 2", "Defender 3"];
function normalizeLineup(rows=[]) {
  const result = [];
  for (const team of ["A", "B"]) {
    const teamRows = rows.filter(item => item.team === team);
    const occupied = new Set();
    for (const item of teamRows) {
      const oldRole = item.position || "";
      if (item.substitute || oldRole === "Substitute") {
        result.push({...item, team, slot: null, substitute: true, position: "Substitute"});
        continue;
      }
      let slot = Number(item.slot);
      if (!Number.isInteger(slot) || slot < 1 || slot > 5 || occupied.has(slot)) {
        const allowed = ["Striker", "Attacker"].includes(oldRole) ? [1,2] : oldRole ? [3,4,5] : [1,2,3,4,5];
        slot = allowed.find(number => !occupied.has(number)) || [1,2,3,4,5].find(number => !occupied.has(number));
      }
      if (!slot) continue;
      occupied.add(slot);
      result.push({...item, team, slot, substitute: false, position: slot <= 2 ? "Striker" : "Defender"});
    }
  }
  return result;
}

function DroneArena({players, roster}) {
  const starterPoints = {A:[[455,185],[455,315],[350,145],[265,250],[350,355]],B:[[545,185],[545,315],[650,145],[735,250],[650,355]]};
  const plotted = players.filter(player => !player.substitute && player.slot).map(player => {
    const person=roster.find(row=>row.id===player.member_id);
    const [x,y]=starterPoints[player.team][player.slot-1];
    return {player,person,x,y};
  });
  const subsA=players.filter(p=>p.team==="A"&&p.substitute), subsB=players.filter(p=>p.team==="B"&&p.substitute);
  return <section className="card arena-card"><h2>Drone Soccer · Class 20</h2>
    <svg className="drone-arena" viewBox="0 0 1000 500" role="img" aria-label="Schéma uzavretej drone soccer arény Class 20">
      <rect x="8" y="42" width="112" height="416" rx="12" className="pilot-zone team-A-zone" />
      <rect x="880" y="42" width="112" height="416" rx="12" className="pilot-zone team-B-zone" />
      <text x="64" y="68" className="arena-zone-label">PILOTI A</text><text x="936" y="68" className="arena-zone-label">PILOTI B</text>
      <rect x="120" y="42" width="760" height="416" rx="12" className="arena-frame" />
      <rect x="134" y="56" width="372" height="388" className="arena-half arena-half-a" />
      <rect x="506" y="56" width="360" height="388" className="arena-half arena-half-b" />
      <rect x="134" y="56" width="732" height="388" rx="5" className="arena-net" />
      <line x1="500" y1="56" x2="500" y2="444" className="arena-center-line" />
      <circle cx="500" cy="250" r="56" className="arena-center-circle" />
      <circle cx="275" cy="250" r="29" className="goal-ring-outer"/><circle cx="275" cy="250" r="19" className="goal-ring-inner"/>
      <circle cx="725" cy="250" r="29" className="goal-ring-outer"/><circle cx="725" cy="250" r="19" className="goal-ring-inner"/>
      <text x="275" y="300" className="arena-goal-label">BRÁNA A</text><text x="725" y="300" className="arena-goal-label">BRÁNA B</text>
      {plotted.map(({player,person,x,y})=><g className={"arena-player team-"+player.team} key={player.member_id}>
        <circle cx={x} cy={y} r="20"/><text x={x} y={y+5}>{initials(person?.name||"?")}</text>
      </g>)}
      {[...subsA.slice(0,3).map((p,i)=>({p,x:64,y:128+i*52})),...subsB.slice(0,3).map((p,i)=>({p,x:936,y:128+i*52}))].map(({p,x,y})=>{
        const person=roster.find(row=>row.id===p.member_id);
        return <g className={"arena-player team-"+p.team+" arena-substitute"} key={p.member_id}><circle cx={x} cy={y} r="17"/><text x={x} y={y+5}>{initials(person?.name||"?")}</text></g>;
      })}
      {subsA.length>3&&<text x="64" y="310" className="arena-extra">+{subsA.length-3}</text>}{subsB.length>3&&<text x="936" y="310" className="arena-extra">+{subsB.length-3}</text>}
    </svg>
    <div className="pitch-legend"><span><i className="team-dot team-a-dot"/>Tím A</span><span><i className="team-dot team-b-dot"/>Tím B</span><span className="muted small">Náhradníci sú v pilotnej zóne</span></div>
  </section>;
}

function TeamSlots({team,players,roster,editable,onSlot,onSub,onRemove}) {
  const teamPlayers=players.filter(player=>player.team===team);
  const getMember=id=>roster.find(member=>member.id===id);
  return <section className={"card team-slot-card team-card-"+team}>
    <h2>Tím {team}</h2>
    <div className="starter-slots">{slotLabels.map((label,index)=>{
      const player=teamPlayers.find(item=>!item.substitute&&item.slot===index+1);
      const person=player&&getMember(player.member_id);
      return <div className={"starter-slot "+(player?"occupied":"empty-slot")} key={index}>
        <span className="slot-role">{label}</span>
        {player?<><strong>{person?.name||"Hráč"}</strong>{editable&&<div className="slot-actions"><button className="text-button" onClick={()=>onSlot(team,index+1)}>Zmeniť</button><button className="text-button" aria-label={"Odobrať "+(person?.name||"hráča")} onClick={()=>onRemove(player.member_id)}>Odobrať</button></div>}</>:
          editable?<button className="slot-assign" onClick={()=>onSlot(team,index+1)}>+ Priradiť hráča</button>:<span className="slot-empty-label">Voľné miesto</span>}
      </div>;
    })}</div>
    <div className="substitutes-section"><div className="substitutes-heading"><strong>Náhradníci</strong><span className="badge">{teamPlayers.filter(item=>item.substitute).length}</span></div>
      {teamPlayers.filter(item=>item.substitute).map(player=><div className="substitute-row" key={player.member_id}><span>{getMember(player.member_id)?.name||"Hráč"}</span>{editable&&<button className="text-button" onClick={()=>onRemove(player.member_id)}>Odobrať</button>}</div>)}
      {editable&&<button className="add-substitute" onClick={()=>onSub(team)}>+ Pridať náhradníka</button>}
    </div>
  </section>;
}

function LineupDisplay({players,roster,editable=false,onChange}) {
  const [assigning,setAssigning]=useState(null);
  const assigned=new Set(players.map(player=>player.member_id));
  function setSlot(team,slot,member) {
    const next=players.filter(player=>player.member_id!==member.id&&!(player.team===team&&!player.substitute&&player.slot===slot));
    next.push({member_id:member.id,team,slot,position:slot<=2?"Striker":"Defender",substitute:false});
    onChange(next);setAssigning(null);
  }
  function setSub(team,member) {
    const next=players.filter(player=>player.member_id!==member.id);
    next.push({member_id:member.id,team,slot:null,position:"Substitute",substitute:true});
    onChange(next);setAssigning(null);
  }
  function remove(id){onChange(players.filter(player=>player.member_id!==id));}
  const available=roster.filter(member=>!assigned.has(member.id));
  return <>
    <div className="lineup-dashboard">
      <div className="lineup-team-stack">
        {['A','B'].map(team=><TeamSlots key={team} team={team} players={players} roster={roster} editable={editable}
          onSlot={(selectedTeam,slot)=>setAssigning({team:selectedTeam,slot})} onSub={selectedTeam=>setAssigning({team:selectedTeam,substitute:true})} onRemove={remove}/>) }
      </div>
      <div className="lineup-field-stack"><DroneArena players={players} roster={roster}/>
        <section className="card unassigned-card"><h3>Nezaradení hráči <span className="badge">{available.length}</span></h3>
          {available.length?<ul className="unassigned-list">{available.map(member=><li key={member.id}><Avatar name={member.name}/><span>{member.name}</span></li>)}</ul>:<p className="muted small">Všetci členovia sú zaradení alebo sú náhradníkmi.</p>}
        </section>
      </div>
    </div>
    {assigning&&<Modal title={assigning.substitute?"Pridať náhradníka · Tím "+assigning.team:"Priradiť hráča · Tím "+assigning.team+" · "+slotLabels[assigning.slot-1]} close={()=>setAssigning(null)}>
      <p className="muted small">Hráč, ktorý už je v zostave, sa presunie na nové miesto.</p>
      <ul className="people-list assignment-list">{roster.map(member=>{
        const current=players.find(player=>player.member_id===member.id);
        const status=current?(current.substitute?"Náhradník · tím "+current.team:"Tím "+current.team+" · "+slotLabels[current.slot-1]):"Nezaradený";
        return <li key={member.id}><button className="person-link" onClick={()=>assigning.substitute?setSub(assigning.team,member):setSlot(assigning.team,assigning.slot,member)}>
          <Avatar name={member.name}/><span className="grow"><strong>{member.name}</strong><span className="meta">{status}</span></span><ChevronRight size={18}/></button></li>;
      })}</ul>
    </Modal>}
  </>;
}

function TeamSheet({trainings}) {
  const events = trainings.filter(event => !event.cancelled && (event.kind === "match" || event.kind === "training")).sort((a,b) => new Date(b.starts_at)-new Date(a.starts_at));
  const [eventId, setEventId] = useState("general");
  const [roster, setRoster] = useState([]);
  const [players, setPlayers] = useState([]);
  const [source, setSource] = useState("general");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!eventId) return;
    let active = true;
    api(eventId === "general" ? "lineup/general" : "trainings/" + eventId + "/lineup").then(data => {if (active) {setRoster(data.roster); setPlayers(normalizeLineup(data.players)); setSource(data.source);}}).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  }, [eventId]);
  const event = events.find(item => String(item.id) === eventId);
  return <>
    <section className="card lineup-picker"><label>Zostava<select value={eventId} onChange={e => {setEventId(e.target.value); setError("");}}><option value="general">Základná zostava tímu</option>{events.map(item => <option key={item.id} value={item.id}>{date(item.starts_at)} · {item.title}</option>)}</select></label></section>
    {error && <p className="error" role="alert">{error}</p>}
    {eventId === "general" && <div className="notice">Základná zostava priebežne vyjadruje, s kým tréner počíta a na akej pozícii.</div>}
    {event && source === "general" && <div className="notice">Pre túto udalosť zatiaľ nie je uložená samostatná zostava; zobrazuje sa základná zostava tímu.</div>}
    {(event || eventId === "general") && <><div className="section-heading"><h2>{event?.title || "Základná zostava tímu"}</h2>{event && <span className="meta">{date(event.starts_at)}</span>}</div>
      {players.length ? <LineupDisplay players={players} roster={roster} /> : <Empty icon={Users}>{eventId === "general" ? "Základná zostava ešte nie je pripravená." : "Tréner zatiaľ nepripravil zostavu na túto udalosť."}</Empty>}
    </>}
    {!event && eventId !== "general" && events.length === 0 && <Empty icon={Users}>Zatiaľ nie sú naplánované tréningy ani zápasy.</Empty>}
  </>;
}

function LineupPlanner({trainings}) {
  const events = trainings.filter(event => event.kind === "match" || event.kind === "training").sort((a,b) => new Date(b.starts_at)-new Date(a.starts_at));
  const [eventId, setEventId] = useState("general");
  const [roster, setRoster] = useState([]);
  const [players, setPlayers] = useState([]);
  const [source, setSource] = useState("general");
  const [error, setError] = useState("");
  function chooseEventMode() {
    if (eventId !== "general") return;
    const next = events.find(event => new Date(event.starts_at) >= new Date()) || events[0];
    setEventId(next ? String(next.id) : "");
  }
  useEffect(() => {
    if (!eventId) return;
    let active = true;
    api(eventId === "general" ? "lineup/general" : "trainings/" + eventId + "/lineup").then(data => {if (active) {setRoster(data.roster); setPlayers(normalizeLineup(data.players)); setSource(data.source);}}).catch(e => {if (active) setError(e.message);});
    return () => {active = false;};
  }, [eventId]);
  const event = events.find(item=>String(item.id)===eventId);
  return <>
    <section className="card lineup-picker">
      <h2>Akú zostavu upravuješ?</h2>
      <div className="segmented lineup-mode-switch">
        <button type="button" className={eventId === "general" ? "selected" : ""} aria-pressed={eventId === "general"} onClick={() => {setEventId("general");setError("");}}>Základná zostava tímu</button>
        <button type="button" className={eventId !== "general" ? "selected" : ""} aria-pressed={eventId !== "general"} onClick={chooseEventMode}>Zostava na udalosť</button>
      </div>
      {eventId !== "general" && <label>Udalosť<select value={eventId} onChange={e => {setEventId(e.target.value); setError("");}}><option value="">Vyber tréning alebo zápas</option>{events.map(event => <option key={event.id} value={event.id}>{date(event.starts_at)} · {event.title}</option>)}</select></label>}
      {eventId === "general" && <p className="muted small">Toto je priebežná zostava tímu. Udalostná zostava sa upravuje samostatne.</p>}
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {eventId !== "general" && source === "general" && <div className="notice">Upravuješ zostavu na konkrétnu udalosť. Začínaš zo základnej zostavy; zmeny sa uložia iba pre túto udalosť.</div>}
    {eventId && <>
      <div className="lineup-context"><strong>{event?.title || "Základná zostava tímu"}</strong>{event&&<span className="meta">{date(event.starts_at)}</span>}</div>
      <LineupDisplay players={players} roster={roster} editable onChange={setPlayers}/>
      <div className="toolbar end section-space"><Action className="primary" run={async () => {await api(eventId === "general" ? "lineup/general" : "trainings/" + eventId + "/lineup", "PUT", {players}); setSource(eventId === "general" ? "general" : "event");}}>Uložiť zostavu</Action></div>
    </>}
  </>;
}

function Documents({staff}) {
  const [items, setItems] = useState([]);
  const [create, setCreate] = useState(false);
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  async function load() {setItems(await api("documents"));}
  useEffect(() => {load().catch(error => setError(error.message));}, []);
  return <>
    {staff && <div className="toolbar end"><button className="primary" onClick={() => {setFile(null); setCreate(true);}}><Plus size={18} />Dokument</button></div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card flush"><ul className="people-list">{items.map(item => <li key={item.id}><FileText /><div className="grow"><strong>{item.title}</strong><span className="meta">PDF · {date(item.created_at)}</span></div>
      <a className="icon-button" href={new URL("api/documents/" + item.id + "/download", base)} aria-label={"Stiahnuť " + item.title}><Download size={19} /></a>
      {staff && <Action className="icon-button danger" run={async () => {
        if (!window.confirm(localizeText("Odstrániť dokument „", activeLanguage) + item.title + "“?")) return;
        await api("documents/" + item.id, "DELETE"); await load();
      }}><X size={18} /><span className="sr-only">Odstrániť {item.title}</span></Action>}
    </li>)}</ul>{items.length === 0 && <Empty icon={FileText}>Klubové dokumenty sa zobrazia tu.</Empty>}</div>
    {create && <Modal title="Pridať dokument" close={() => setCreate(false)}><Form label="Nahrať dokument" submit={async data => {
      if (!file || file.size > 5 * 1024 * 1024) throw new Error("Vyber PDF s veľkosťou najviac 5 MB.");
      const title = [...new TextEncoder().encode(data.title)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const response = await fetch(new URL("api/documents", base), {method: "POST", headers: {"Content-Type": "application/pdf", "X-Document-Title": title}, body: file});
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || "Nahrávanie sa nepodarilo.");
      setCreate(false); await load();
    }}><label>Názov<input name="title" maxLength="120" required /></label>
      <label>PDF dokument (najviac 5 MB)<input type="file" accept="application/pdf,.pdf" onChange={event => setFile(event.target.files[0])} required /></label>
    </Form></Modal>}
  </>;
}

function InstallPanel({installation, install}) {
  if (installation.installed) return <section className="card">
    <p className="meta"><CheckCheck size={18} />Aplikácia je nainštalovaná.</p>
  </section>;
  return <section className="card install-card"><span className="quick-icon"><Download size={23} /></span>
    <div className="grow"><h2>DroneSoccer LF na tvojej ploche</h2><p className="muted small">Otváraj klub priamo cez ikonu aplikácie.</p>
      <button className="primary" disabled={installation.busy} onClick={install}><Download size={17} />
        {installation.busy ? "Otvára sa…" : installation.available ? "Nainštalovať aplikáciu" : "Ako nainštalovať"}
      </button></div>
  </section>;
}

function MemberQr({member,close}) {
  const own=member.self;
  const path=own ? "me/card" : "members/"+member.id+"/card";
  const [card,setCard]=useState(null),[error,setError]=useState("");
  const [version,setVersion]=useState(0);
  useEffect(()=>{let current=true;api(path).then(value=>{if(current)setCard(value);}).catch(e=>{if(current)setError(e.message);});return()=>{current=false;};},[path,version]);
  return <Modal title={own ? "Môj členský QR" : "Členský QR"} close={close}>
    {error && <p className="error" role="alert">{error}</p>}
    {card ? <div className="member-qr"><span className="badge">DroneSoccer LF</span><h2>{card.name}</h2>
      <img src={new URL("api/"+path+".svg?v="+version,base).href} alt={"Členský QR kód: "+card.name} />
      <p>Ukáž tento kód trénerovi na zápis dochádzky.</p>
      {navigator.clipboard && <Action run={()=>navigator.clipboard.writeText(card.payload)}>Kopírovať členský kód</Action>}
      {!own && <div className="section-space"><Action className="danger" run={async()=>{
        if(!window.confirm(localizeText("Obnoviť členský QR? Starý kód okamžite prestane platiť. Člen si nový zobrazí vo svojej appke.", activeLanguage))) return;
        setCard(await api(path+"/reset","POST"));setVersion(value=>value+1);
      }}>Obnoviť QR kód</Action></div>}
    </div> : !error && <Empty>Načítava sa QR kód…</Empty>}
  </Modal>;
}

function ClubScanner({user,initialEvent,refresh}) {
  const staff=user.role!=="member";
  const [mode,setMode]=useState(()=>staff && initialEvent ? "attendance" : "batteries");
  const [running,setRunning]=useState(false),[busy,setBusy]=useState(false);
  const [manual,setManual]=useState("");
  const [error,setError]=useState("");
  const [result,setResult]=useState(null),[value,setValue]=useState("");
  const [day,setDay]=useState(()=>initialEvent ? dayKey(initialEvent.starts_at) : today());
  const [events,setEvents]=useState([]),[eventId,setEventId]=useState(initialEvent?.id || null);
  const [eventsLoading,setEventsLoading]=useState(staff);
  const [recent,setRecent]=useState([]);
  const [saved,setSaved]=useState("");
  const [toast,setToast]=useState("");
  const [pendingMember,setPendingMember]=useState(null);
  const [newPrivateEvent,setNewPrivateEvent]=useState(false);
  const [action,setAction]=useState("used");
  const [requestId,setRequestId]=useState(null);
  const locked=useRef(false);
  const mounted=useRef(true);
  const selectedEvent=events.find(event=>event.id===eventId);
  useEffect(()=>()=>{mounted.current=false;},[]);
  useEffect(()=>{
    if(!staff) return;
    let current=true;
    setEventsLoading(true);setEvents([]);setEventId(initialEvent?.id || null);
    const query=day ? "?day="+encodeURIComponent(day) : "";
    api("scan/events"+query).then(rows=>{
      if(!current) return;
      setEvents(rows);
      const candidates=rows.filter(event=>event.is_current);
      setEventId(previous=>initialEvent && rows.some(event=>event.id===initialEvent.id && event.can_record) ? initialEvent.id : rows.some(event=>event.id===previous && event.can_record) ? previous : candidates.length===1 ? candidates[0].id : null);
    }).catch(e=>{if(current){setEventId(null);setError(e.message);}}).finally(()=>{if(current)setEventsLoading(false);});
    return()=>{current=false;};
  },[staff,day,initialEvent?.id]);
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(""),1800);return()=>clearTimeout(timer);},[toast]);
  function next(){locked.current=false;setResult(null);setSaved("");setError("");setManual("");setRunning(true);}
  async function decode(raw){
    if(locked.current) return;
    locked.current=true;setRunning(false);setBusy(true);setResult(null);setError("");setSaved("");setValue(raw);
    try {
      const response=await api("scan","POST",{value:raw,event_id:mode==="attendance" && !eventsLoading && selectedEvent?.can_record ? eventId : null});
      if(!mounted.current) return;
      if(response.type==="member"){
        if(response.recorded){
          setPendingMember(null);
          setRecent(previous=>[{id:response.id,name:response.name,event:response.event_title},...previous].slice(0,12));
          setToast(`Zapísaná dochádzka: ${response.name} · ${response.event_title}`);
          setResult(null);await refresh();
        } else setPendingMember(response);
      } else {setResult(response);setAction(response.status==="damaged" ? "damaged" : "used");setRequestId(crypto.randomUUID());}
    } catch(e){if(mounted.current){setResult(null);setError(e.message);}}
    finally{if(mounted.current)setBusy(false);}
  }
  return <>
    <section className="card"><h2>Skenovať QR alebo čiarový kód</h2>
      {staff && <div className="scanner-mode" role="tablist" aria-label="Režim skenovania">
        <button role="tab" aria-selected={mode==="batteries"} className={mode==="batteries"?"selected":""} onClick={()=>{setMode("batteries");setPendingMember(null);setResult(null);setError("");}}>Batérie</button>
        <button role="tab" aria-selected={mode==="attendance"} className={mode==="attendance"?"selected":""} onClick={()=>{setMode("attendance");setPendingMember(null);setResult(null);setError("");}}>Dochádzka</button>
      </div>}
      <p className="muted">{mode==="attendance" ? "Naskenuj členský QR. Prítomnosť sa zapíše automaticky." : staff ? "Skenuj kód LF-B alebo GS1-128; pri GS1 môže byť kód LF-B priamo v údajoch alebo číselné sériové číslo v AI 21. Neznámu batériu môžeš pridať." : "Naskenuj kód batérie LF-B alebo GS1-128 so sériovým číslom v AI 21."}</p>
      {staff && mode==="attendance" && <div className="scan-event-picker">
        <label>Deň udalosti<input type="date" value={day} onChange={event=>{setEventId(null);setDay(event.target.value);}} disabled={busy} /></label>
        <label>Dochádzka na udalosť<select value={eventsLoading ? "" : eventId || ""} disabled={eventsLoading || busy} onChange={event=>setEventId(Number(event.target.value) || null)}>
          <option value="">{eventsLoading ? "Načítavajú sa udalosti…" : "Vyber udalosť pre dochádzku"}</option>
          {events.map(event=><option key={event.id} value={event.id} disabled={!event.can_record}>{clock(event.starts_at)} · {event.title}{!event.can_record ? " – ešte sa nezačala" : ""}</option>)}
        </select></label>
        {!eventsLoading && !eventId && <p className="small muted">Ak sa nedá jednoznačne určiť prebiehajúca udalosť, vyber ju ručne. Batérie možno skenovať aj bez výberu udalosti.</p>}
      </div>}
      {!running && <button className="primary scan-open-camera" disabled={busy || (mode==="attendance" && eventsLoading)} onClick={next}><ScanLine size={20} />Otvoriť kameru</button>}
      <details className="scan-manual"><summary>Zadať kód ručne alebo cez USB skener</summary>
        <Form label={busy ? "Spracúva sa…" : "Spracovať kód"} submit={async()=>{if(busy)return;locked.current=false;await decode(manual);}}>
          <label className="section-space">Kód<input value={manual} onChange={event=>setManual(event.target.value)} placeholder={mode==="attendance"?"LF-M:…":"LF-B01"} maxLength="2048" autoComplete="off" autoCapitalize="none" spellCheck="false" required disabled={busy} /></label>
        </Form>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
    {running && <Modal title={mode==="attendance" ? "Skenovať dochádzku" : "Skenovať batérie"} close={()=>setRunning(false)}>
      <div className={"scan-camera-stage "+(mode==="attendance"?"attendance-camera":"battery-camera")}>
        <CameraScanner running={running} onDecode={decode} onError={message=>{setRunning(false);setError(message);}} />
      </div>
      <button className="primary scan-stop-modal" onClick={()=>setRunning(false)}>Zastaviť skener</button>
    </Modal>}
    {toast && <div className="scan-success-toast" role="status"><Check size={16}/>{toast}</div>}
    {pendingMember && <Modal title={pendingMember.name} close={()=>setPendingMember(null)}>
      <p>Vyber udalosť pre zápis dochádzky alebo vytvor novú udalosť.</p>
      <label>Deň udalosti<input type="date" value={day} onChange={event=>setDay(event.target.value)}/></label>
      {events.filter(event=>event.can_record).map(event=><button className="card scan-event-option" key={event.id} onClick={async()=>{
        try{const response=await api("scan","POST",{value:pendingMember.payload,event_id:event.id});setPendingMember(null);if(response.recorded){setToast(`Zapísaná dochádzka: ${response.name} · ${response.event_title}`);await refresh();}}
        catch(e){setError(e.message);setPendingMember(null);}
      }}>{date(event.starts_at)} · {event.title}{!event.can_record?" (ešte sa nezačala)":""}</button>)}
      <button className="primary section-space" onClick={()=>setNewPrivateEvent(true)}><Plus size={18}/>Vytvoriť novú udalosť</button>
      {newPrivateEvent && <Form label="Vytvoriť udalosť a zapísať prítomnosť" submit={async data=>{
        const starts_at=trainingISO(data.starts_at),ends_at=data.ends_at?trainingISO(data.ends_at):null;
        if(ends_at&&ends_at<=starts_at)throw new Error("Koniec musí nasledovať po začiatku.");
        const created=await api("scan/private-events","POST",{title:data.title||"Neplánovaný tréning",starts_at,ends_at,location:data.location});
        const response=await api("scan","POST",{value:pendingMember.payload,event_id:created.id});setNewPrivateEvent(false);setPendingMember(null);
        setToast(`Zapísaná dochádzka: ${response.name} · ${response.event_title}`);await refresh();
      }}><label>Názov<input name="title" defaultValue="Neplánovaný tréning" maxLength="120" required/></label>
        <label>Začiatok<input name="starts_at" type="datetime-local" defaultValue={clubLocal(new Date())} required/></label>
        <label>Koniec<input name="ends_at" type="datetime-local"/></label><label>Miesto<input name="location" maxLength="120" defaultValue="Hala" required/></label></Form>}
    </Modal>}
    {result?.type==="battery" && <section className="card scan-result"><Battery size={26} /><h2>{result.code}</h2>
      {!result.exists ? <><p>Batéria ešte nie je evidovaná.</p><Form label="Pridať batériu" submit={async data=>{
        setBusy(true);
        try {
          try{await api("batteries","POST",{code:result.code,label:data.label});}catch(e){if(e.status!==409)throw e;}
          const updated=await api("scan","POST",{value:result.code});setResult(updated);setSaved("");
        } finally {setBusy(false);}
      }}><label>Označenie batérie<input name="label" defaultValue={result.code} maxLength="120" required /></label></Form></> : <>
        <p>{result.label}</p><p><span className="badge">{batteryLabels[result.status] || "Bez záznamu"}</span></p>
        {["damaged","retired"].includes(result.status) && <p className="notice">Túto batériu nepoužívaj.</p>}
        {!saved && result.status!=="retired" && (staff || result.status!=="damaged") && <Form label="Uložiť záznam" submit={async data=>{
          setBusy(true);
          try {
            await api("batteries/"+result.code+"/events","POST",{action:staff ? action : "used",note:data.note,request_id:requestId});
            setSaved("Záznam bol uložený.");setResult({...result,status:staff ? action : "used"});await refresh();
          } finally {setBusy(false);}
        }}>
          {staff && <label>Úkon<select value={action} onChange={event=>{setAction(event.target.value);setRequestId(crypto.randomUUID());}}>
            {Object.entries(batteryLabels).filter(([key])=>result.status!=="damaged" || ["damaged","retired"].includes(key)).map(([key,label])=><option value={key} key={key}>{label}</option>)}
          </select></label>}
          {!staff && result.status==="damaged" ? <p className="error">Poškodenú batériu nemožno použiť.</p> : <label>Poznámka<input name="note" maxLength="1000" placeholder="Voliteľná poznámka" /></label>}
        </Form>}
      </>}
      {saved && <p className="success" role="status">{saved}</p>}
    </section>}
    {recent.length>0 && <section className="card"><h2>Posledné zápisy v tomto skenovaní</h2><ul className="records">{recent.map((person,index)=><li key={index}><Check size={17} /><span><strong>{person.name}</strong><span className="meta">{person.event}</span></span></li>)}</ul></section>}
  </>;
}

const supportsPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
async function disablePush() {
  if(!supportsPush()) return;
  const registration=await navigator.serviceWorker.ready;
  const subscription=await registration.pushManager.getSubscription();
  if(subscription){
    await api("push/subscriptions","DELETE",{endpoint:subscription.endpoint});
    await subscription.unsubscribe();
  }
  for(const notification of await registration.getNotifications()) notification.close();
}

function PushSettings({user,reloadUser}) {
  const [enabled,setEnabled]=useState(false);
  const [state,setState]=useState("Načítava sa…");
  const [saved,setSaved]=useState("");
  const supported=supportsPush();
  async function check(){
    if(!supported){setState("Tento prehliadač zatiaľ neponúka push. Na iPhone otvor aplikáciu pridanú na plochu (iOS 16.4 alebo novší).");return;}
    const registration=await navigator.serviceWorker.ready;
    const subscription=await registration.pushManager.getSubscription();
    setEnabled(Boolean(subscription) && Notification.permission==="granted");
    setState(Notification.permission==="denied" ? "Upozornenia sú zablokované. Povoľ ich v nastaveniach prehliadača alebo zariadenia." : subscription ? "Toto zariadenie je prihlásené na push upozornenia." : "Push upozornenia na tomto zariadení nie sú zapnuté.");
  }
  useEffect(()=>{check().catch(()=>setState("Nepodarilo sa zistiť stav upozornení."));},[]);
  return <section className="card push-settings"><h2>Upozornenia</h2>
    <p className="muted">Vyber, na čo chceš dostávať push upozornenia. Výber platí na všetkých tvojich zariadeniach.</p>
    <Form key={[user.push_messages,user.push_calendar,user.push_announcements].join(":")} label="Uložiť výber upozornení" submit={async data=>{
      await api("me/notification-preferences","PUT",{push_messages:data.messages==="on",push_calendar:data.calendar==="on",push_announcements:data.announcements==="on"});
      await reloadUser();setSaved("Výber upozornení bol uložený.");
    }}>
      <label className="checkbox"><input type="checkbox" name="messages" defaultChecked={user.push_messages!==false} />Správy – súkromné aj skupinové</label>
      <label className="checkbox"><input type="checkbox" name="calendar" defaultChecked={user.push_calendar!==false} />Kalendár – nové udalosti, zmeny a zrušenia</label>
      <label className="checkbox"><input type="checkbox" name="announcements" defaultChecked={user.push_announcements!==false} />Oznamy – manuálne zverejnené oznamy</label>
    </Form>
    {saved && <p className="success" role="status">{saved}</p>}
    <p className="small">Oznamy a správy zostanú v aplikácii dostupné aj pri vypnutom push.</p>
    <h3>Toto zariadenie</h3><p className="muted" role="status">{state}</p>
    {supported && <div className="actions"><Action run={async()=>{
      if(Notification.permission==="denied") throw new Error("Povoľ upozornenia v nastaveniach prehliadača alebo zariadenia.");
      const permission=await Notification.requestPermission();
      if(permission!=="granted"){await check();return;}
      const registration=await navigator.serviceWorker.ready;
      const config=await api("push/config");
      const text=config.public_key.replace(/-/g,"+").replace(/_/g,"/");
      const key=Uint8Array.from(atob(text+"=".repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
      const subscription=await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
      await api("push/subscriptions","POST",subscription.toJSON());await check();
    }}>{enabled ? "Obnoviť prihlásenie zariadenia" : "Zapnúť push na tomto zariadení"}</Action>
    {enabled && <Action run={async()=>{await disablePush();await check();}}>Vypnúť push na tomto zariadení</Action>}</div>}
  </section>;
}

function RoleApplications({user}) {
  const [catalog,setCatalog]=useState([]),[requests,setRequests]=useState([]),[confirmRole,setConfirmRole]=useState(null),[saved,setSaved]=useState(""),[error,setError]=useState("");
  useEffect(()=>{Promise.all([api("role-catalog"),api("me/role-requests")]).then(([c,r])=>{setCatalog(c);setRequests(r);}).catch(e=>setError(e.message));},[]);
  const names=Object.fromEntries((user.roles||[]).map(key=>[key,true]));
  const pending=new Set(requests.filter(x=>x.status==="pending").map(x=>x.role_key));
  async function submit(role){await api("me/role-requests","POST",{roles:[role.key]});setConfirmRole(null);setSaved("Žiadosť bola odoslaná vedeniu klubu.");setRequests(await api("me/role-requests"));}
  return <section className="card role-application-panel"><h2>Ďalšie klubové roly</h2>
    {error&&<p className="error" role="alert">{error}</p>}{saved&&<p className="success" role="status">{saved}</p>}
    {catalog.filter(role=>role.available).map(role=>{const owned=names[role.key],waiting=pending.has(role.key);return <details className="role-application-option" key={role.key}>
      <summary><strong>{role.name}</strong>{(owned||waiting)&&<span className="badge">{owned?"Už pridelená":"Čaká na schválenie"}</span>}</summary>
      <p>{role.description}</p>
      <div className="role-capabilities">{(role.capabilities||[]).map(feature=><span className="role-capability" key={feature.name}><span>{feature.name}</span><span className={"badge "+(feature.available?"positive":"planned-role")}>{feature.available?"Dostupné":"Zatiaľ nedostupné"}</span></span>)}</div>
      <Action className="primary section-space" disabled={owned||waiting} run={()=>setConfirmRole(role)}>{owned?"Už pridelená":waiting?"Čaká na schválenie":"Požiadať o rolu"}</Action>
    </details>})}
    {requests.filter(row=>row.status!=="pending").length>0&&<details className="section-space"><summary>Predchádzajúce žiadosti</summary><ul className="records">{requests.filter(row=>row.status!=="pending").map(row=><li key={row.id}><strong>{row.name}</strong><span className="badge">{row.status==="approved"?"Schválená":"Zamietnutá"}</span></li>)}</ul></details>}
    {confirmRole&&<Modal title="Odoslať žiadosť o rolu?" close={()=>setConfirmRole(null)}><p>Žiadosť o rolu „{confirmRole.name}“ bude poslaná vedeniu klubu na posúdenie.</p><div className="actions"><Action className="primary" run={()=>submit(confirmRole)}>Potvrdiť a odoslať</Action><button onClick={()=>setConfirmRole(null)}>Zrušiť</button></div></Modal>}
  </section>;
}

function Profile({user, reloadUser, installation, install, saveInstallPreferences, openCard, languagePreference, onLanguageChange}) {
  const [attendance, setAttendance] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {api("me/attendance").then(setAttendance).catch(error => setError(error.message));}, []);
  const attended = attendance.filter(row => row.attended).length;
  return <>
    {(user.roles||[]).includes("player") && <button className="card qr-profile-button" onClick={openCard}><QrCode size={25} /><span>Môj členský QR kód</span><ChevronRight /></button>}
    <section className="card profile-card"><Avatar name={user.name} /><h2>{user.name}</h2><p className="muted">{user.email || "admin"}</p><span className="badge">{(user.roles||[]).map(role=>roleNames[role]||role).join(" · ")||roles[user.role]}</span>
      <div className="actions section-space"><button onClick={() => setEdit("profile")}><Pencil size={16} />Upraviť profil</button>
        {user.role !== "superadmin" && <button onClick={() => setEdit("password")}>Zmeniť heslo</button>}</div>
    </section>
    {saved && <p className="success" role="status">{saved}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <section className="card language-settings"><h2>Jazyk aplikácie</h2>
      <label>Jazyk aplikácie<select value={languagePreference} onChange={event=>onLanguageChange(event.target.value)}>
        <option value="system">Podľa jazyka systému</option>
        <option value="sk">Slovenčina</option>
        <option value="en">English</option>
        <option value="uk">Українська</option>
      </select></label>
      <p className="small muted">Zmena sa uloží iba v tomto zariadení.</p>
    </section>
    {(user.roles||[]).includes("player") && <section className="card"><h2>Moja dochádzka</h2>
      {attendance.length ? <><p className="big-number">{attended}<span> / {attendance.length}</span></p><p className="muted">navštívených udalostí so zaznamenanou dochádzkou</p>
        <ul className="records">{attendance.map(row => <li key={row.id}><div className="grow"><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span></div><span className="badge">{row.attended ? "Prítomný" : "Neprítomný"}</span></li>)}</ul></> : <p className="muted">Tréner zatiaľ nezapísal dochádzku.</p>}
    </section>}
    {user.role!=="superadmin"&&<RoleApplications user={user}/>}
    {user.role!=="superadmin" && <PushSettings user={user} reloadUser={reloadUser} />}
    <section className="card install-settings"><h2>Nastavenia inštalácie</h2>
      <Form key={String(user.pwa_show_card) + ":" + user.pwa_show_popup} label="Uložiť nastavenia" submit={async data => {
        await saveInstallPreferences({pwa_show_card: data.card === "on", pwa_show_popup: data.popup === "on"});
        setSaved("Nastavenia inštalácie boli uložené.");
      }}>
        <label className="checkbox"><input type="checkbox" name="card" defaultChecked={user.pwa_show_card !== false} />Zobrazovať kartu na domovskej stránke</label>
        <label className="checkbox"><input type="checkbox" name="popup" defaultChecked={user.pwa_show_popup !== false} />Ponúkať inštaláciu po prihlásení</label>
      </Form>
    </section>
    <InstallPanel installation={installation} install={install} />
    {edit && <Modal title={edit === "profile" ? "Upraviť profil" : "Zmeniť heslo"} close={() => setEdit(null)}>
      <Form label="Uložiť" submit={async data => {
        await api(edit === "profile" ? "me" : "me/password", "PUT", data);
        if (edit === "profile") await reloadUser();
        setSaved(edit === "profile" ? "Profil bol uložený." : "Heslo bolo zmenené."); setEdit(null);
      }}>
        {edit === "profile" ? <label>Meno<input name="name" maxLength="120" defaultValue={user.name} required /></label> : <>
          <label>Aktuálne heslo<input name="current_password" type="password" autoComplete="current-password" maxLength="128" required /></label>
          <label>Nové heslo<input name="password" type="password" autoComplete="new-password" minLength="8" maxLength="128" required /></label></>}
      </Form>
    </Modal>}
  </>;
}
const navigation = [
  ["home", "Domov", House], ["calendar", "Kalendár", CalendarDays], ["attendance", "Dochádzka", ClipboardCheck], ["scanner", "Skenovať", ScanLine],
  ["messages", "Správy", MessageCircle], ["announcements", "Oznamy", Megaphone],
  ["members", "Členovia", Users], ["team", "Tímy", Users], ["development", "Rozvoj hráčov", Users], ["lineups", "Zostavy", ClipboardCheck], ["drills", "Knižnica cvičení", BookOpen], ["equipment", "Vybavenie", Battery],
  ["documents", "Dokumenty", FileText],
];

function Home({user, trainings, announcements, conversations, refresh, navigate, openTraining}) {
  const staff = user.role !== "member";
  const next = trainings.filter(upcoming);
  const unread = conversations.reduce((sum, row) => sum + row.unread, 0);
  const waiting = trainings.filter(t => !t.cancelled && past(t) && t.counts?.attendance_pending > 0);
  const notice = announcements.find(item => item.pinned) || announcements[0];
  return <>
    <div className="welcome"><div><h1>Ahoj, {user.name.split(" ")[0]}.</h1></div>
      <span className="welcome-date">{new Date().toLocaleDateString(uiLocale(), {weekday: "long", day: "numeric", month: "long", timeZone})}</span>
    </div>
    <div className="home-grid">
      <section className="home-main"><div className="section-heading"><h2>Najbližšie v klube</h2><button className="text-button" onClick={() => navigate("calendar")}>Kalendár<ChevronRight size={16} /></button></div>
        {next.length ? <TrainingCard training={next[0]} staff={staff} prominent refresh={refresh} open={() => openTraining(next[0].id)} /> : <Empty>Najbližšia udalosť ešte nie je naplánovaná.</Empty>}
        {next.slice(1, 3).map(t => <TrainingCard training={t} staff={staff} refresh={refresh} key={t.id} open={() => openTraining(t.id)} />)}
      </section>
      <aside className="home-side">
        {user.role !== "superadmin" && <button className="card quick-link" onClick={() => navigate("messages")}><span className="quick-icon"><MessageCircle /></span><span className="grow"><strong>{unread ? unread + " neprečítaných správ" : "Správy s tímom"}</strong><span className="meta">{staff ? "Otvor konverzácie s členmi" : "Napíš členovi alebo trénerovi"}</span></span><ChevronRight size={18} /></button>}
        {staff && waiting.length > 0 && <button className="card quick-link" onClick={() => openTraining(waiting[0].id)}>
          <span className="quick-icon"><CheckCheck /></span><span className="grow"><strong>Doplniť dochádzku</strong><span className="meta">{waiting[0].title} · {date(waiting[0].starts_at)}</span></span><ChevronRight size={18} /></button>}
        {notice && <article className="card notice-card"><div className="section-heading"><span className="eyebrow">{notice.pinned ? "Pripnutý oznam" : "Nový oznam"}</span><Megaphone size={19} /></div>
          <h2>{notice.title}</h2><p className="body">{notice.body}</p>
          <button className="text-button" onClick={() => navigate("announcements")}>Všetky oznamy<ArrowUpRight size={16} /></button>
        </article>}
        {!staff && next.filter(t => !t.response).length > 1 && <button className="card quick-link" onClick={() => navigate("calendar")}><CircleHelp /><span className="grow"><strong>Potvrď svoju účasť</strong><span className="meta">{next.filter(t => !t.response).length} udalostí čaká na odpoveď</span></span><ChevronRight size={18} /></button>}
      </aside>
    </div>
  </>;
}

function Drawer({close, children}) {
  const ref = useRef(null);
  useEffect(() => {
    ref.current.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {document.body.style.overflow = old;};
  }, []);
  return <dialog ref={ref} className="drawer" aria-label="Navigácia" onCancel={event => {event.preventDefault(); close();}}
    onClick={event => {if (event.target === ref.current) close();}}>
    <div className="drawer-head"><strong>Menu</strong><button aria-label="Zavrieť menu" className="icon-button" onClick={close}><X /></button></div>
    {children}
  </dialog>;
}

function App() {
  const [language, setLanguage] = useState(initialLanguage);
  const [languagePreference, setLanguagePreference] = useState(() => localStorage.getItem("lf-ds-hub-language") || "system");
  activeLanguage = language;
  const installation = usePwaInstall();
  const platform = installationPlatform();
  const [installHelp, setInstallHelp] = useState(false);
  const [installError, setInstallError] = useState("");
  const [installHidden, setInstallHidden] = useState(false);
  const [installPopup, setInstallPopup] = useState(false);
  const loginPromotionShown = useRef(null);
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState(() => hash().has("battery") ? "equipment" : hash().get("page") || "home");
  const [menu, setMenu] = useState(false);
  const [route, setRoute] = useState(location.hash);
  const [snapshot, setSnapshot] = useState(null);
  const session = useRef(null);
  const empty = {trainings: [], announcements: [], conversations: [], places: []};
  const data = snapshot && snapshot.owner === user ? snapshot.data : empty;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [trainingId, setTrainingId] = useState(() => Number(hash().get("event")) || null);
  const [activeBattery, setActiveBattery] = useState(() => hash().get("battery"));
  const [contact, setContact] = useState(() => Number(hash().get("contact")) || null);
  const [createTraining, setCreateTraining] = useState(false);
  const [scanEvent,setScanEvent]=useState(null);
  const [cardMember,setCardMember]=useState(null);
  const [notifications, setNotifications] = useState(false);
  const [trialBannerEnabled,setTrialBannerEnabled]=useState(true);
  const [roleRequestCount,setRoleRequestCount]=useState(0);
  const staff = user?.role === "coach" || user?.role === "superadmin";
  const superadmin = user?.role === "superadmin";
  const visibleNavigation = navigation.filter(([key]) => user?.menu_access?.includes(key) && (key !== "team" || user?.role !== "superadmin") && (key !== "messages" || !superadmin));
  const allowedPages = [...visibleNavigation.map(([key]) => key), "profile"];
  const currentPage = allowedPages.includes(page) ? page : "home";
  const title = currentPage === "profile" ? "Môj profil a nastavenia" : visibleNavigation.find(([key]) => key === currentPage)?.[1];
  useEffect(() => {
    document.documentElement.lang = language;
    translatePage(document.body, language);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === "characterData" || record.type === "attributes") translateNode(record.target, language);
        else for (const node of record.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) translatePage(node, language);
          else if (node.nodeType === Node.TEXT_NODE) translateNode(node, language);
        }
      }
    });
    observer.observe(document.body, {subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:["aria-label","placeholder","title","alt"]});
    return () => observer.disconnect();
  }, [language]);
  function changeLanguagePreference(preference) {
    localStorage.setItem("lf-ds-hub-language", preference);
    setLanguagePreference(preference);
    setLanguage(preference === "system" ? detectLanguage() : preference);
  }
  async function install() {
    setInstallError("");
    setInstallPopup(false);
    if (!installation.available) {setInstallHelp(true); return;}
    try {
      const outcome = await promptInstallation();
      if (outcome === "dismissed") setInstallHidden(true);
      if (outcome === "unavailable") setInstallHelp(true);
    } catch {
      setInstallError("Inštalačný dialóg sa nepodarilo otvoriť. Použi menu prehliadača.");
      setInstallHelp(true);
    }
  }
  async function saveInstallPreferences(preferences) {
    const owner = session.current;
    if (!owner) return;
    const saved = await api("me/install-preferences", "PUT", preferences);
    if (session.current !== owner) return;
    const updated = {...owner, ...saved};
    session.current = updated;
    setSnapshot(previous => previous?.owner === owner ? {...previous, owner: updated} : previous);
    setUser(updated);
    if (!saved.pwa_show_popup) setInstallPopup(false);
  }
  async function stopInstallPromotions() {
    await saveInstallPreferences({pwa_show_card: false, pwa_show_popup: false});
    setInstallHidden(true);
    setInstallPopup(false);
  }
  async function loadUser() {
    try {
      const account = await api("me"); session.current = account; setUser(account);
    } catch (error) {
      if (error.status !== 401) setError(error.message);
      session.current = null; setUser(null); setLoading(false);
    }
  }
  useEffect(()=>{api("public/settings").then(settings=>setTrialBannerEnabled(settings.trial_banner_enabled)).catch(()=>{});},[]);
  async function refresh() {
    let owner = session.current;
    if (!owner) return;
    try {
      const refreshed=await api("me");
      if(session.current!==owner)return;
      if(JSON.stringify([owner.role,owner.roles,owner.menu_access])!==JSON.stringify([refreshed.role,refreshed.roles,refreshed.menu_access])){
        owner=refreshed;session.current=refreshed;setUser(refreshed);
      }
      const access=new Set(owner.menu_access||[]);
      const canReviewRoles=owner.menu_access?.includes("members")&&(owner.role==="superadmin"||owner.roles?.includes("club_leader")||owner.roles?.includes("deputy_leader"));
      const [trainings, announcements, conversations, places,roleRequests,siteSettings] = await Promise.all([
        access.has("calendar")?api("trainings"):Promise.resolve([]),access.has("announcements")?api("announcements"):Promise.resolve([]),
        access.has("messages")&&owner.role!=="superadmin"?api("conversations"):Promise.resolve([]),access.has("calendar")?api("places"):Promise.resolve([]),
        canReviewRoles?api("role-requests"):Promise.resolve([]),api("public/settings"),
      ]);
      if (session.current === owner) {setRoleRequestCount(roleRequests.length);setTrialBannerEnabled(siteSettings.trial_banner_enabled);setSnapshot({owner, data: {trainings, announcements, conversations, places}}); setError(""); setLoading(false);}
    } catch (error) {
      if (session.current !== owner) return;
      if (error.status === 401) {session.current = null; setSnapshot(null); setUser(null);}
      else setError(error.message);
      setLoading(false);
    }
  }
  function navigate(next) {
    const target = new URL(location.href);
    target.hash = "page=" + next;
    if (menu) history.replaceState({}, "", target); else if (next !== page) history.pushState({}, "", target);
    setMenu(false); setNotifications(false); setTrainingId(null); setPage(next); setActiveBattery(null);
    if (next !== "messages") setContact(null);
    window.scrollTo({top: 0});
  }
  function openScanner(event=null) {setScanEvent(event);setTrainingId(null);navigate("scanner");}
  function openMenu() {history.pushState({drawer: true}, "", location.href); setMenu(true);}
  function closeMenu() {if (history.state?.drawer) history.back(); else setMenu(false);}
  function messageMember(id) {setContact(id); navigate("messages");}
  async function logout() {
    await disablePush().catch(()=>{});
    await api("logout", "POST"); session.current = null; setSnapshot(null); setUser(null);
    setTrainingId(null); setMenu(false); setNotifications(false); setCreateTraining(false); setContact(null); history.replaceState({}, "", base);
    setPage("home");
    setInstallHelp(false); setInstallPopup(false); setInstallHidden(false);setCardMember(null);setScanEvent(null);
    loginPromotionShown.current = null;
  }
  useEffect(() => {loadUser();}, []);
  useEffect(() => {
    const onNavigation = () => {
      setRoute(location.hash);
      setMenu(Boolean(history.state?.drawer));
      setActiveBattery(hash().get("battery"));
      setPage(hash().has("battery") ? "equipment" : hash().get("page") || "home");
      setTrainingId(Number(hash().get("event")) || null); setContact(Number(hash().get("contact")) || null);
    };
    addEventListener("popstate", onNavigation); addEventListener("hashchange", onNavigation);
    return () => {removeEventListener("popstate", onNavigation); removeEventListener("hashchange", onNavigation);};
  }, []);
  useEffect(() => {
    if (!user) return;
    refresh();
    const timer = setInterval(() => {if (!document.hidden) refresh();}, 15000);
    const focus = () => {if (!document.hidden) refresh();};
    addEventListener("visibilitychange", focus);
    return () => {clearInterval(timer); removeEventListener("visibilitychange", focus);};
  }, [user]);
  useEffect(() => {
    if (!user) {
      loginPromotionShown.current = null;
      setInstallPopup(false);
      setInstallHidden(false);
      return;
    }
    if (loading || loginPromotionShown.current === user.id) return;
    loginPromotionShown.current = user.id;
    if (!installation.installed && user.pwa_show_popup !== false) setInstallPopup(true);
  }, [user?.id, user?.pwa_show_popup, loading, installation.installed]);
  const unread = data.conversations.reduce((sum, row) => sum + row.unread, 0);
  const unreadNotices = data.announcements.filter(item => !item.is_read).length;
  const training = data.trainings.find(t => t.id === trainingId);
  const menuContent = <><nav aria-label="Hlavná navigácia">{visibleNavigation.map(([key, label, Icon]) =>
    <button key={key} className={currentPage === key ? "active" : ""} aria-current={currentPage === key ? "page" : undefined} onClick={() => navigate(key)}>
      <Icon size={20} /><span>{label}</span>{key === "messages" && unread > 0 && <span className="counter">{unread}</span>}{key==="members"&&roleRequestCount>0&&<span className="counter" aria-label={roleRequestCount+" čakajúcich žiadostí o roly"}>{roleRequestCount}</span>}
    </button>)}</nav><div className="menu-footer"><button className="person-link" aria-label="Môj profil" onClick={() => navigate("profile")}><Avatar name={user?.name || "Používateľ"} /><span className="grow"><strong>{user?.name}</strong><span className="meta">Profil a nastavenia</span></span><Settings2 size={18} /></button>
      <Action className="logout-button" run={logout}><LogOut size={18} />Odhlásiť sa</Action></div></>;
  return <div className={user ? "app" : "signed-out"}>
    <header className="topbar">
      {user && <button className="icon-button hamburger" aria-label="Otvoriť menu" aria-expanded={menu} onClick={openMenu}><Menu /></button>}
      <a className="brand" href="#page=home" onClick={event => {event.preventDefault(); if (user) navigate("home");}}>
        <span className="brand-symbol" aria-hidden="true"><Drone size={24} /></span><span><strong>Drone Soccer Hub</strong><small>LF TUKE</small></span>
      </a>
      {user && <button className="icon-button scan-shortcut" aria-label="Skenovať kód" onClick={()=>openScanner()}><ScanLine size={22} /></button>}
      {(user?.roles||[]).includes("player") && <button className="icon-button" aria-label="Môj členský QR kód" onClick={()=>setCardMember({self:true})}><QrCode size={22} /></button>}
      {user && <button className="icon-button notification-button" aria-label={"Oznámenia" + (unread + unreadNotices ? " (" + (unread + unreadNotices) + ")" : "")} onClick={() => setNotifications(true)}><Bell size={22} />{unread + unreadNotices > 0 && <i />}</button>}
    </header>
    {user && <aside className="sidebar">{menuContent}</aside>}
    {user && menu && <Drawer close={closeMenu}>{menuContent}</Drawer>}
    <main className={currentPage === "messages" && user ? "content messages-page" : "content"}>
    {trialBannerEnabled&&<aside className="development-banner" aria-label="Aplikácia vo vývoji">
        <Construction size={22} aria-hidden="true" />
        <div><strong>Aplikácia je v skúšobnej prevádzke</strong><p>Nie všetky funkcie sú zatiaľ dostupné. Funkcie aj vzhľad aplikácie priebežne dopĺňame a upravujeme.</p></div>
      </aside>}
      {error && <div className="error-banner" role="alert">{error}<Action run={refresh}>Skúsiť znova</Action></div>}
      {user === undefined ? <Empty>Načítava sa…</Empty> : !user ? <Login onLogin={loadUser} /> : <>
        {currentPage !== "home" && <div className="page-heading"><div><h1>{title}</h1></div></div>}
        {loading ? <Empty>Načítava sa…</Empty> : <>
          {currentPage === "home" && <>
            {!installation.installed && user.pwa_show_card !== false && !installHidden && <div className="install-promotion">
              <InstallPanel installation={installation} install={install} />
              <button className="icon-button" aria-label="Skryť kartu teraz" onClick={() => setInstallHidden(true)}><X size={18} /></button>
              <Action className="text-button install-opt-out" run={stopInstallPromotions}>Už nezobrazovať</Action>
            </div>}
            {staff && user.menu_access?.includes("calendar") && <div className="toolbar end home-action"><button className="primary" onClick={() => setCreateTraining(true)}><Plus size={18} />Naplánovať udalosť</button></div>}
            <Home user={user} {...data} refresh={refresh} navigate={navigate} openTraining={setTrainingId} />
          </>}
          {currentPage === "calendar" && <Calendar trainings={data.trainings} staff={staff} places={data.places} refresh={refresh} openTraining={setTrainingId} />}
          {currentPage === "scanner" && <ClubScanner key={user.id+":"+(scanEvent?.id || "general")} user={user} initialEvent={scanEvent} refresh={refresh} />}
          {currentPage === "attendance" && staff && <AttendanceOverview openScanner={openScanner} />}
          {currentPage === "messages" && <Messages key={user.id + ":" + contact + ":" + route} user={user} conversations={data.conversations} refresh={refresh} initialContact={contact} />}
          {currentPage === "announcements" && <Bulletin items={data.announcements} staff={staff} refresh={refresh} />}
          {currentPage === "members" && <Members key="members" user={user} userId={user.id} staff={staff} superadmin={superadmin} onTrialBanner={setTrialBannerEnabled} onMessage={messageMember} onCard={setCardMember} />}
          {currentPage === "team" && user.role !== "superadmin" && <TeamSheet trainings={data.trainings} />}
          {currentPage === "development" && staff && <PlayerDevelopmentPage />}
          {currentPage === "lineups" && staff && <LineupPlanner trainings={data.trainings} />}
          {currentPage === "drills" && staff && <DrillLibrary />}
          {currentPage === "equipment" && <Batteries key={user.id + ":" + activeBattery} staff={staff} initialCode={activeBattery} openScanner={openScanner} />}
          {currentPage === "documents" && <Documents staff={staff} />}
          {currentPage === "profile" && <Profile user={user} reloadUser={loadUser} installation={installation} install={install} saveInstallPreferences={saveInstallPreferences} openCard={()=>setCardMember({self:true})} languagePreference={languagePreference} onLanguageChange={changeLanguagePreference} />}
        </>}
      </>}
    </main>
    {user && installPopup && user.pwa_show_popup !== false && !installation.installed && <Modal title="Maj klub vždy poruke" close={() => setInstallPopup(false)}>
      <InstallPanel installation={installation} install={install} />
      <div className="install-popup-actions">
        <button onClick={() => setInstallPopup(false)}>Teraz nie</button>
        <Action className="text-button" run={async () => {
          await saveInstallPreferences({pwa_show_card: user.pwa_show_card !== false, pwa_show_popup: false});
        }}>Vypnúť popup po prihlásení</Action>
        <Action className="text-button" run={stopInstallPromotions}>Už mi to neponúkať</Action>
      </div>
    </Modal>}
    {installHelp && !installation.installed && <Modal title="Inštalácia DroneSoccer LF" close={() => setInstallHelp(false)}>
      {installError && <p className="error" role="alert">{installError}</p>}
      {platform === "ios" ? <ol className="install-steps"><li>Otvor túto stránku v Safari.</li>
        <li>Otvor <strong>Zdieľať</strong> v menu prehliadača.</li>
        <li>Vyber <strong>Pridať na plochu</strong>.</li>
        <li>Zapni <strong>Otvoriť ako webovú aplikáciu</strong>, ak sa zobrazí, a potvrď <strong>Pridať</strong>.</li>
      </ol> : platform === "android" ? <ol className="install-steps">
        <li>Otvor menu prehliadača vpravo hore.</li>
        <li>Vyber <strong>Inštalovať aplikáciu</strong> alebo <strong>Pridať na plochu</strong>.</li>
        <li>Potvrď inštaláciu DroneSoccer LF.</li>
      </ol> : <><p>V adresnom riadku alebo menu prehliadača vyhľadaj možnosť <strong>Inštalovať aplikáciu</strong>.</p>
        <p>Ak túto možnosť prehliadač ponúka, potvrď inštaláciu DroneSoccer LF.</p></>}
    </Modal>}
    {user && cardMember && <MemberQr key={cardMember.self ? "self" : cardMember.id} member={cardMember} close={()=>setCardMember(null)} />}
    {user && training && <TrainingDetail key={training.id} training={training} staff={staff} places={data.places} refresh={refresh} openScanner={openScanner} close={() => setTrainingId(null)} />}
    {user && createTraining && <Modal title="Nová udalosť" close={() => setCreateTraining(false)}><TrainingForm places={data.places} done={async () => {setCreateTraining(false); await refresh();}} /></Modal>}
    {user && notifications && <Modal title="Oznámenia" close={() => setNotifications(false)}>
      {!superadmin && <button className="card quick-link" onClick={() => navigate("messages")}><MessageCircle /><span className="grow"><strong>Správy</strong><span className="meta">{unread ? unread + " neprečítaných" : "Všetko máš prečítané"}</span></span><ChevronRight /></button>}
      {data.announcements.filter(item => !item.is_read).map(item => <button className="card quick-link" key={item.id} onClick={() => navigate("announcements")}><Megaphone /><span className="grow"><strong>{item.title}</strong><span className="meta">{date(item.created_at)}</span></span><ChevronRight /></button>)}
    </Modal>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("sw.js", base)).catch(console.error);
}
