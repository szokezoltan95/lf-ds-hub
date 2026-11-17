import React, {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Drone, Menu, X, House, CalendarDays, MessageCircle, Megaphone, Users, Battery, ShieldCheck,
  LogOut, Bell, Plus, ChevronLeft, ChevronRight, MapPin, Clock, Check, CircleHelp,
  Search, ScanLine, QrCode, ClipboardCheck, Pin, FileText, Download, ArrowUpRight, Settings2, Send, CheckCheck, Pencil} from "lucide-react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-ext-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-ext-600.css";
import "./style.css";
import {CameraScanner} from "./scanner.jsx";
import {usePwaInstall, promptInstallation, installationPlatform} from "./install.js";

const base = new URL("./", location.href);
const labels = {yes: "Prídem", no: "Neprídem", maybe: "Ešte neviem"};
const batteryLabels = {used: "Použitá", charged: "Nabitá", stored: "V sklade", damaged: "Poškodená", retired: "Vyradená"};
const timeZone = "Europe/Bratislava";
const date = value => new Date(value).toLocaleString("sk-SK", {dateStyle: "medium", timeStyle: "short", timeZone});
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
    const error = new Error(typeof payload.detail === "string" ? payload.detail :
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
  const [accepted, setAccepted] = useState(false);
  const reset = hash().has("reset");
  return <section className="card auth">
    <h1>{invite ? (reset ? "Obnova hesla" : "Aktivácia účtu") : "Prihlásenie"}</h1>
    {accepted && <p role="status">Účet je pripravený. Prihlás sa e-mailom z pozvánky.</p>}
    {invite ? <Form key="accept" label={reset ? "Nastaviť heslo" : "Aktivovať účet"} submit={async ({password}) => {
      await api("members/accept", "POST", {token: invite, password});
      history.replaceState(null, "", location.pathname);
      setInvite(null);
      setAccepted(true);
    }}>
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
const roles = {superadmin: "Superadmin", coach: "Tréner", member: "Člen"};
const initials = name => name.split(" ").filter(Boolean).map(part => part[0]).slice(0, 2).join("").toUpperCase();
const dayKey = timestamp => clubLocal(timestamp).slice(0, 10);
const today = () => dayKey(new Date());
const clock = timestamp => new Date(timestamp).toLocaleTimeString("sk-SK", {hour: "2-digit", minute: "2-digit", timeZone});
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
      <span className="date-tile"><strong>{day.toLocaleDateString("sk-SK", {day: "numeric", timeZone})}</strong>
        <span>{day.toLocaleDateString("sk-SK", {month: "short", timeZone})}</span></span>
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
        {[["info", "Informácie"], ...(staff ? [["rsvp", "Účasť"], ["attendance", "Dochádzka"]] : [])].map(([value, text]) =>
          <button role="tab" aria-selected={tab === value} key={value} onClick={() => setTab(value)}>{text}</button>)}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {tab === "info" ? <>
        {training.cancelled && <p className="notice">Udalosť bola zrušená</p>}
        <div className="detail-facts"><p><CalendarDays />{date(training.starts_at)}</p>
          {training.ends_at && <p><Clock />Do {clock(training.ends_at)}</p>}
          <p><MapPin />{training.location}</p></div>
        {training.instructions && <p className="body">{training.instructions}</p>}
        {!staff && upcoming(training) && <RSVP training={training} refresh={refresh} />}
        {staff && !training.cancelled && <div className="actions section-space">
          <button onClick={() => setEdit(true)}><Pencil size={17} />Upraviť</button>
          <Action className="danger" run={async () => {
            if (!window.confirm("Zrušiť udalosť a zverejniť oznam pre tím? Udalosť zostane v kalendári označená ako zrušená.")) return;
            await api("trainings/" + training.id + "/cancel", "POST"); await refresh();
          }}>Zrušiť udalosť</Action>
        </div>}
        {staff && training.can_delete && <div className="section-space"><Action className="danger" run={async () => {
          if (!window.confirm("Natrvalo vymazať túto udalosť aj jej prihlášky, dochádzku a súvisiace automatické oznamy? Bez odoslania upozornenia. Táto akcia sa nedá vrátiť.")) return;
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
          <h2>{start.toLocaleDateString("sk-SK", {month: "long", year: "numeric", timeZone: "UTC"})}</h2>
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
      {(i === 0 || dayKey(shown[i - 1].starts_at) !== dayKey(t.starts_at)) && <h2 className="day-heading">{new Date(t.starts_at).toLocaleDateString("sk-SK", {weekday: "long", day: "numeric", month: "long", timeZone})}</h2>}
      <TrainingCard training={t} staff={staff} refresh={refresh} open={() => openTraining(t.id)} />
    </React.Fragment>) : <Empty>V tomto období nie sú žiadne udalosti.</Empty>}</div>
    {create && <Modal title="Nová udalosť" close={() => setCreate(false)}><TrainingForm initialDay={selectedDay} places={places} done={async () => {setCreate(false); await refresh();}} /></Modal>}
  </>;
}
function Members({superadmin, management = false, onMessage, onCard, userId}) {
  const [members, setMembers] = useState([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("active");
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState(null);
  const [link, setLink] = useState("");
  const [attendance, setAttendance] = useState([]);
  const [error, setError] = useState("");
  async function load() {setMembers(await api("members"));}
  useEffect(() => {load().catch(error => setError(error.message));}, []);
  useEffect(() => {
    let current = true;
    setAttendance([]);
    if (selected?.role === "member") api("members/" + selected.id + "/attendance")
      .then(rows => {if (current) setAttendance(rows);}).catch(error => {if (current) setError(error.message);});
    return () => {current = false;};
  }, [selected?.id, selected?.role]);
  const found = members.filter(m => m.role !== "superadmin" &&
    (m.name + " " + (m.email || "")).toLowerCase().includes(query.toLowerCase()) &&
    (management || filter === "all" || (filter === "coaches" ? m.role === "coach" && m.active : filter === "invited" ? !m.registered && m.active : filter === "inactive" ? !m.active : m.active && m.registered)));
  const status = m => !m.active ? "Neaktívny" : !m.registered ? "Pozvaný" : "Aktívny";
  return <>
    <div className="toolbar"><label className="search"><Search size={18} /><input type="search" aria-label="Hľadať člena" placeholder="Hľadať podľa mena…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button className="primary" onClick={() => {setLink(""); setForm(management ? "coach" : "invite");}}><Plus size={18} />{management ? "Tréner" : "Pozvať"}</button></div>
    {!management && <div className="chips">{[["active", "Aktívni"], ["coaches", "Tréneri"], ["invited", "Pozvaní"], ["inactive", "Neaktívni"], ["all", "Všetci"]].map(([value, text]) =>
      <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{text}</button>)}</div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card flush"><ul className="people-list">{found.map(member => <li key={member.id}>
      <button className="person-link" onClick={() => {setSelected(member); setLink("");}}>
        <Avatar name={member.name} /><span className="grow"><strong>{member.name}</strong><span className="meta">{roles[member.role]}{!management && " · " + member.email}</span>
          <span className="meta">{management ? member.email : member.role === "coach" ? "Tréner tímu" : member.recorded_count > 0 ? "Dochádzka " + member.attended_count + "/" + member.recorded_count : "Dochádzka zatiaľ bez záznamu"}</span></span>
        <span className={"badge " + (member.active ? "positive" : "")}>{status(member)}</span><ChevronRight size={18} />
      </button>
    </li>)}</ul>{found.length === 0 && <Empty icon={Users}>Žiadne zodpovedajúce účty.</Empty>}</div>
    {form && <Modal title={form === "coach" ? "Nový trénerský účet" : "Pozvať člena"} close={() => setForm(null)}>
      {link ? <InviteLink link={link} /> : <Form label={form === "coach" ? "Vytvoriť účet" : "Vytvoriť pozvánku"} submit={async data => {
        const result = await api(form === "coach" ? "members/coaches" : "members/invite", "POST", data);
        await load();
        if (result.invite_url) setLink(result.invite_url); else setForm(null);
      }}>
        <label>Meno<input name="name" maxLength="120" autoComplete="name" required /></label>
        <label>E-mail<input name="email" type="email" maxLength="254" autoComplete="email" required /></label>
        {form === "coach" && <label>Heslo<input name="password" type="password" autoComplete="new-password" minLength="8" maxLength="128" required /></label>}
      </Form>}
    </Modal>}
    {selected && <Modal title={selected.name} close={() => setSelected(null)}>
      <div className="profile-heading"><Avatar name={selected.name} /><div><span className="badge">{roles[selected.role]}</span><p>{selected.email || "admin"}</p></div></div>
      {selected.role === "member" && selected.active && <button className="section-space" onClick={()=>onCard(selected)}><QrCode size={17} />Členský QR kód</button>}
      {selected.role !== "superadmin" && <div className="actions">
        {!superadmin && selected.id !== userId && selected.active && selected.registered && <button className="primary" onClick={() => {onMessage(selected.id); setSelected(null);}}><MessageCircle size={17} />Napísať správu</button>}
        {(superadmin || selected.role === "member") && <Action run={async () => {
          await api("members/" + selected.id + "/active", "PUT", {active: !selected.active});
          setSelected({...selected, active: !selected.active}); await load();
        }}>{selected.active ? "Deaktivovať" : "Aktivovať"}</Action>}
        {(superadmin || selected.role === "member") && selected.active && selected.registered && <Action run={async () => {
          const result = await api("members/" + selected.id + "/reset", "POST"); setLink(result.invite_url);
        }}>Obnoviť heslo</Action>}
        {selected.active && !selected.registered && selected.role === "member" && <Action run={async () => {
          const result = await api("members/invite", "POST", {name: selected.name, email: selected.email}); setLink(result.invite_url);
        }}>Nová pozvánka</Action>}
      </div>}
      {link && <InviteLink link={link} />}
      {selected.role === "member" && <section className="section-space"><h3>Dochádzka</h3>
        {attendance.length ? <ul className="records">{attendance.map((row, i) => <li key={i}><div className="grow"><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span></div>
          <span className={"badge " + (row.attended ? "positive" : "")}>{row.attended ? "Prítomný" : "Neprítomný"}</span></li>)}</ul> : <p className="muted">Zatiaľ bez záznamu.</p>}
      </section>}
      {superadmin && management && selected.role !== "superadmin" && <section className="section-space"><h3>Správa účtu</h3><div className="actions">
        {selected.registered && <Action run={async () => {
          const role = selected.role === "coach" ? "member" : "coach";
          if (!window.confirm("Zmeniť rolu účtu na „" + roles[role] + "“?")) return;
          await api("members/" + selected.id + "/role", "PUT", {role});
          setSelected({...selected, role}); setLink(""); await load();
        }}>{selected.role === "coach" ? "Zmeniť na člena" : "Povýšiť na trénera"}</Action>}
        {selected.role === "member" && <Action className="danger" run={async () => {
          if (!window.confirm("Natrvalo odstrániť účet „" + selected.name + "“, jeho dochádzku a súkromné správy?")) return;
          await api("members/" + selected.id, "DELETE"); setSelected(null); await load();
        }}>Natrvalo odstrániť člena</Action>}
      </div></section>}
    </Modal>}
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
      <form onSubmit={event => {
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
      </form>
    </section>
    {error && <p className="error" role="alert">{error}</p>}
    {loading ? <Empty>Načítava sa dochádzka…</Empty> : result && <>
      <div className="attendance-overview-toolbar"><label>Vyhľadať člena<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Meno člena" /></label>
        <p className="meta" role="status">Členovia: {people.length} · Udalosti: {events.length}</p></div>
      <p className="small muted">Obdobie zahŕňa oba krajné dni podľa času na Slovensku. Zobrazení sú aj neaktívni členovia. Účasť potvrdená vopred sa nepočíta ako dochádzka.</p>
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
        <p className="meta section-space">Súhrn počíta iba zapísanú dochádzku na začatých, nezrušených udalostiach. Dochádzku upravíš v detaile udalosti v kalendári.</p>
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
      <p className="meta">Oznamy spravujú tréneri a systémový správca. Pri úprave sa potvrdenia prečítania vynulujú.</p>
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
            if(!window.confirm("Natrvalo vymazať oznam aj prílohy? Bez odoslania upozornenia.")) return;
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
        if (!window.confirm("Odstrániť dokument „" + item.title + "“?")) return;
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
        if(!window.confirm("Obnoviť členský QR? Starý kód okamžite prestane platiť. Člen si nový zobrazí vo svojej appke.")) return;
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
      <p className="muted">{mode==="attendance" ? "Naskenuj členský QR. Prítomnosť sa zapíše automaticky." : staff ? "Skenuj kód LF-B na batérii. Neznámu batériu môžeš pridať." : "Naskenuj existujúcu batériu LF-B a zapíš jej použitie."}</p>
      {staff && mode==="attendance" && <div className="scan-event-picker">
        <label>Deň udalosti<input type="date" value={day} onChange={event=>{setEventId(null);setDay(event.target.value);}} disabled={busy} /></label>
        <label>Dochádzka na udalosť<select value={eventsLoading ? "" : eventId || ""} disabled={eventsLoading || busy} onChange={event=>setEventId(Number(event.target.value) || null)}>
          <option value="">{eventsLoading ? "Načítavajú sa udalosti…" : "Vyber udalosť pre dochádzku"}</option>
          {events.map(event=><option key={event.id} value={event.id} disabled={!event.can_record}>{clock(event.starts_at)} · {event.title}{!event.can_record ? " – ešte sa nezačala" : ""}</option>)}
        </select></label>
        {!eventsLoading && !eventId && <p className="small muted">Ak sa nedá jednoznačne určiť prebiehajúca udalosť, vyber ju ručne. Batérie možno skenovať aj bez výberu udalosti.</p>}
      </div>}
      {!running && <button className="primary scan-open-camera" disabled={busy || (mode==="attendance" && eventsLoading)} onClick={next}><ScanLine size={20} />Otvoriť kameru</button>}
      {running && <div className={"scan-camera-stage "+(mode==="attendance"?"attendance-camera":"battery-camera")}>
        <CameraScanner running={running} onDecode={decode} onError={message=>{setRunning(false);setError(message);}} />
        <button className="scan-stop" onClick={()=>setRunning(false)}>Zastaviť skener</button>
      </div>}
      <details className="scan-manual"><summary>Zadať kód ručne alebo cez USB skener</summary>
        <Form label={busy ? "Spracúva sa…" : "Spracovať kód"} submit={async()=>{if(busy)return;locked.current=false;await decode(manual);}}>
          <label className="section-space">Kód<input value={manual} onChange={event=>setManual(event.target.value)} placeholder={mode==="attendance"?"LF-M:…":"LF-B01"} maxLength="2048" autoComplete="off" autoCapitalize="none" spellCheck="false" required disabled={busy} /></label>
        </Form>
      </details>
      {error && <p className="error" role="alert">{error}</p>}
    </section>
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

function Profile({user, reloadUser, installation, install, saveInstallPreferences, openCard}) {
  const [attendance, setAttendance] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {api("me/attendance").then(setAttendance).catch(error => setError(error.message));}, []);
  const attended = attendance.filter(row => row.attended).length;
  return <>
    {user.role==="member" && <button className="card qr-profile-button" onClick={openCard}><QrCode size={25} /><span>Môj členský QR kód</span><ChevronRight /></button>}
    <section className="card profile-card"><Avatar name={user.name} /><h2>{user.name}</h2><p className="muted">{user.email || "admin"}</p><span className="badge">{roles[user.role]}</span>
      <div className="actions section-space"><button onClick={() => setEdit("profile")}><Pencil size={16} />Upraviť profil</button>
        {user.role !== "superadmin" && <button onClick={() => setEdit("password")}>Zmeniť heslo</button>}</div>
    </section>
    {saved && <p className="success" role="status">{saved}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {user.role === "member" && <section className="card"><h2>Moja dochádzka</h2>
      {attendance.length ? <><p className="big-number">{attended}<span> / {attendance.length}</span></p><p className="muted">navštívených udalostí so zaznamenanou dochádzkou</p>
        <ul className="records">{attendance.map(row => <li key={row.id}><div className="grow"><strong>{row.title}</strong><span className="meta">{date(row.starts_at)}</span></div><span className="badge">{row.attended ? "Prítomný" : "Neprítomný"}</span></li>)}</ul></> : <p className="muted">Tréner zatiaľ nezapísal dochádzku.</p>}
    </section>}
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
  ["members", "Členovia", Users], ["equipment", "Vybavenie", Battery],
  ["documents", "Dokumenty", FileText], ["management", "Správa používateľov", ShieldCheck],
];

function Home({user, trainings, announcements, conversations, refresh, navigate, openTraining}) {
  const staff = user.role !== "member";
  const next = trainings.filter(upcoming);
  const unread = conversations.reduce((sum, row) => sum + row.unread, 0);
  const waiting = trainings.filter(t => !t.cancelled && past(t) && t.counts?.attendance_pending > 0);
  const notice = announcements.find(item => item.pinned) || announcements[0];
  return <>
    <div className="welcome"><div><p className="eyebrow">Drone Soccer · LF TUKE</p><h1>Ahoj, {user.name.split(" ")[0]}.</h1>
      <p className="muted">{staff ? "Všetko pre najbližšiu udalosť na jednom mieste." : "Tvoj tím, tréningy a nové správy."}</p></div>
      <span className="welcome-date">{new Date().toLocaleDateString("sk-SK", {weekday: "long", day: "numeric", month: "long", timeZone})}</span>
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
    <div className="drawer-head"><strong>LF DS Hub</strong><button aria-label="Zavrieť menu" className="icon-button" onClick={close}><X /></button></div>
    {children}
  </dialog>;
}

function App() {
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
  const staff = user?.role === "coach" || user?.role === "superadmin";
  const superadmin = user?.role === "superadmin";
  const visibleNavigation = navigation.filter(([key]) => (key !== "members" || staff) && (key !== "attendance" || staff) && (key !== "management" || superadmin) && (key !== "messages" || !superadmin));
  const allowedPages = [...visibleNavigation.map(([key]) => key), "profile"];
  const currentPage = allowedPages.includes(page) ? page : "home";
  const title = currentPage === "profile" ? "Môj profil a nastavenia" : visibleNavigation.find(([key]) => key === currentPage)?.[1];
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
  async function refresh() {
    const owner = session.current;
    if (!owner) return;
    try {
      const [trainings, announcements, conversations, places] = await Promise.all([
        api("trainings"), api("announcements"), owner.role === "superadmin" ? Promise.resolve([]) : api("conversations"), api("places"),
      ]);
      if (session.current === owner) {setSnapshot({owner, data: {trainings, announcements, conversations, places}}); setError(""); setLoading(false);}
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
      <Icon size={20} /><span>{label}</span>{key === "messages" && unread > 0 && <span className="counter">{unread}</span>}
    </button>)}</nav><div className="menu-footer"><button className="person-link" aria-label="Môj profil" onClick={() => navigate("profile")}><Avatar name={user?.name || "Používateľ"} /><span className="grow"><strong>{user?.name}</strong><span className="meta">Profil a nastavenia</span></span><Settings2 size={18} /></button>
      <Action className="logout-button" run={logout}><LogOut size={18} />Odhlásiť sa</Action></div></>;
  return <div className={user ? "app" : "signed-out"}>
    <header className="topbar">
      {user && <button className="icon-button hamburger" aria-label="Otvoriť menu" aria-expanded={menu} onClick={openMenu}><Menu /></button>}
      <a className="brand" href="#page=home" onClick={event => {event.preventDefault(); if (user) navigate("home");}}>
        <span className="brand-symbol" aria-hidden="true"><Drone size={24} /></span><span><strong>LF DS Hub</strong><small>Drone Soccer · LF TUKE</small></span>
      </a>
      {user && <button className="icon-button scan-shortcut" aria-label="Skenovať kód" onClick={()=>openScanner()}><ScanLine size={22} /></button>}
      {user?.role==="member" && <button className="icon-button" aria-label="Môj členský QR kód" onClick={()=>setCardMember({self:true})}><QrCode size={22} /></button>}
      {user && <button className="icon-button notification-button" aria-label={"Oznámenia" + (unread + unreadNotices ? " (" + (unread + unreadNotices) + ")" : "")} onClick={() => setNotifications(true)}><Bell size={22} />{unread + unreadNotices > 0 && <i />}</button>}
    </header>
    {user && <aside className="sidebar">{menuContent}</aside>}
    {user && menu && <Drawer close={closeMenu}>{menuContent}</Drawer>}
    <main className={currentPage === "messages" && user ? "content messages-page" : "content"}>
      {error && <div className="error-banner" role="alert">{error}<Action run={refresh}>Skúsiť znova</Action></div>}
      {user === undefined ? <Empty>Načítava sa…</Empty> : !user ? <Login onLogin={loadUser} /> : <>
        {currentPage !== "home" && <div className="page-heading"><div><p className="eyebrow">Drone Soccer LF TUKE</p><h1>{title}</h1></div></div>}
        {loading ? <Empty>Načítava sa…</Empty> : <>
          {currentPage === "home" && <>
            {!installation.installed && user.pwa_show_card !== false && !installHidden && <div className="install-promotion">
              <InstallPanel installation={installation} install={install} />
              <button className="icon-button" aria-label="Skryť kartu teraz" onClick={() => setInstallHidden(true)}><X size={18} /></button>
              <Action className="text-button install-opt-out" run={stopInstallPromotions}>Už nezobrazovať</Action>
            </div>}
            {staff && <div className="toolbar end home-action"><button className="primary" onClick={() => setCreateTraining(true)}><Plus size={18} />Naplánovať udalosť</button></div>}
            <Home user={user} {...data} refresh={refresh} navigate={navigate} openTraining={setTrainingId} />
          </>}
          {currentPage === "calendar" && <Calendar trainings={data.trainings} staff={staff} places={data.places} refresh={refresh} openTraining={setTrainingId} />}
          {currentPage === "scanner" && <ClubScanner key={user.id+":"+(scanEvent?.id || "general")} user={user} initialEvent={scanEvent} refresh={refresh} />}
          {currentPage === "attendance" && staff && <AttendanceOverview openScanner={openScanner} />}
          {currentPage === "messages" && <Messages key={user.id + ":" + contact + ":" + route} user={user} conversations={data.conversations} refresh={refresh} initialContact={contact} />}
          {currentPage === "announcements" && <Bulletin items={data.announcements} staff={staff} refresh={refresh} />}
          {currentPage === "members" && staff && <Members key="members" userId={user.id} superadmin={superadmin} onMessage={messageMember} onCard={setCardMember} />}
          {currentPage === "management" && superadmin && <Members key="management" userId={user.id} superadmin management onMessage={messageMember} onCard={setCardMember} />}
          {currentPage === "equipment" && <Batteries key={user.id + ":" + activeBattery} staff={staff} initialCode={activeBattery} openScanner={openScanner} />}
          {currentPage === "documents" && <Documents staff={staff} />}
          {currentPage === "profile" && <Profile user={user} reloadUser={loadUser} installation={installation} install={install} saveInstallPreferences={saveInstallPreferences} openCard={()=>setCardMember({self:true})} />}
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
