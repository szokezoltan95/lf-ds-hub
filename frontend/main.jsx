import React, {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {Drone, Menu, X, House, CalendarDays, MessageCircle, Megaphone, Users, Battery, ShieldCheck,
  LogOut, Bell, Plus, ChevronLeft, ChevronRight, MapPin, Clock, Check, CircleHelp,
  Search, Pin, FileText, Download, ArrowUpRight, Settings2, Send, CheckCheck, Pencil} from "lucide-react";
import "@fontsource/dm-sans/latin-400.css";
import "@fontsource/dm-sans/latin-ext-400.css";
import "@fontsource/dm-sans/latin-600.css";
import "@fontsource/dm-sans/latin-ext-600.css";
import "./style.css";

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
  return <article className={"card training-card " + (prominent ? "prominent " : "") + (training.cancelled ? "cancelled" : "")}>
    <button className="event-link" onClick={open}>
      <span className="date-tile"><strong>{day.toLocaleDateString("sk-SK", {day: "numeric", timeZone})}</strong>
        <span>{day.toLocaleDateString("sk-SK", {month: "short", timeZone})}</span></span>
      <span className="event-text"><span className="eyebrow">{kinds[training.kind] || "Tréning"}</span><strong>{training.title}</strong>
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

function TrainingDetail({training, staff, places, close, refresh}) {
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
            if (!window.confirm("Zrušiť túto udalosť?")) return;
            await api("trainings/" + training.id + "/cancel", "POST"); await refresh();
          }}>Zrušiť udalosť</Action>
        </div>}
      </> : <>
        {tab === "rsvp" && <div className="chips">
          {[["all", "Všetci"], ["yes", "Prídu"], ["no", "Neprídu"], ["maybe", "Nevedia"], ["none", "Bez odpovede"]].map(([value, text]) =>
            <button className={filter === value ? "selected" : ""} key={value} onClick={() => setFilter(value)}>{text}</button>)}
        </div>}
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
            const hasEvent = trainings.some(t => dayKey(t.starts_at) === key && !t.cancelled);
            return <button key={key} aria-label={"Vybrať " + key} aria-pressed={selectedDay === key}
              className={(key === today() ? "today " : "") + (key === selectedDay ? "selected " : "")}
              onClick={() => setSelectedDay(selectedDay === key ? null : key)}>{i + 1}{hasEvent && <i />}</button>;
          })}</div>
        {staff && selectedDay && <button className="text-button" onClick={() => setCreate(true)}><Plus size={16} />Pridať udalosť na {selectedDay.split("-").reverse().join(".")}</button>}
      </section>}
    <div className="event-list">{shown.length ? shown.map((t, i) => <React.Fragment key={t.id}>
      {(i === 0 || dayKey(shown[i - 1].starts_at) !== dayKey(t.starts_at)) && <h2 className="day-heading">{new Date(t.starts_at).toLocaleDateString("sk-SK", {weekday: "long", day: "numeric", month: "long", timeZone})}</h2>}
      <TrainingCard training={t} staff={staff} refresh={refresh} open={() => openTraining(t.id)} />
    </React.Fragment>) : <Empty>V tomto období nie sú žiadne udalosti.</Empty>}</div>
    {create && <Modal title="Nová udalosť" close={() => setCreate(false)}><TrainingForm initialDay={selectedDay} places={places} done={async () => {setCreate(false); await refresh();}} /></Modal>}
  </>;
}
function Members({superadmin, management = false, onMessage}) {
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
  const found = members.filter(m => (management || m.role === "member") &&
    (m.name + " " + (m.email || "")).toLowerCase().includes(query.toLowerCase()) &&
    (management || filter === "all" || (filter === "invited" ? !m.registered && m.active : filter === "inactive" ? !m.active : m.active && m.registered)));
  const status = m => !m.active ? "Neaktívny" : !m.registered ? "Pozvaný" : "Aktívny";
  return <>
    <div className="toolbar"><label className="search"><Search size={18} /><input type="search" aria-label="Hľadať člena" placeholder="Hľadať podľa mena…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <button className="primary" onClick={() => {setLink(""); setForm(management ? "coach" : "invite");}}><Plus size={18} />{management ? "Tréner" : "Pozvať"}</button></div>
    {!management && <div className="chips">{[["active", "Aktívni"], ["invited", "Pozvaní"], ["inactive", "Neaktívni"], ["all", "Všetci"]].map(([value, text]) =>
      <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{text}</button>)}</div>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="card flush"><ul className="people-list">{found.map(member => <li key={member.id}>
      <button className="person-link" onClick={() => {setSelected(member); setLink("");}}>
        <Avatar name={member.name} /><span className="grow"><strong>{member.name}</strong><span className="meta">{management ? roles[member.role] : member.email}</span>
          <span className="meta">{management ? member.email || "admin" : member.recorded_count > 0 ? "Dochádzka " + member.attended_count + "/" + member.recorded_count : "Dochádzka zatiaľ bez záznamu"}</span></span>
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
      {selected.role !== "superadmin" && <div className="actions">
        {selected.active && selected.registered && selected.role === "member" && <button className="primary" onClick={() => {onMessage(selected.id); setSelected(null);}}><MessageCircle size={17} />Napísať správu</button>}
        <Action run={async () => {
          await api("members/" + selected.id + "/active", "PUT", {active: !selected.active});
          setSelected({...selected, active: !selected.active}); await load();
        }}>{selected.active ? "Deaktivovať" : "Aktivovať"}</Action>
        {selected.active && selected.registered && <Action run={async () => {
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

function Bulletin({items, staff, refresh}) {
  const [create, setCreate] = useState(false);
  return <>
    {staff && <div className="toolbar end"><button className="primary" onClick={() => setCreate(true)}><Plus size={18} />Nový oznam</button></div>}
    {items.length ? <div className="bulletin-list">{items.map(item => <article className="card" key={item.id}>
      <div className="row-between"><span className="meta">{date(item.created_at)}</span>{item.pinned && <span className="badge"><Pin size={13} />Pripnuté</span>}</div>
      <h2>{item.title}</h2><p className="body">{item.body}</p><div className="actions section-space">
        {!item.is_read ? <Action className="text-button" run={async () => {await api("announcements/" + item.id + "/read", "POST"); await refresh();}}><CheckCheck size={16} />Prečítané</Action> : <span className="meta"><CheckCheck size={16} />Prečítané</span>}
        {staff && <Action className="text-button" run={async () => {await api("announcements/" + item.id + "/pin", "PUT", {pinned: !item.pinned}); await refresh();}}><Pin size={16} />{item.pinned ? "Odopnúť" : "Pripnúť"}</Action>}
      </div>
    </article>)}</div> : <Empty icon={Megaphone}>Zatiaľ žiadne oznamy.</Empty>}
    {create && <Modal title="Nový oznam" close={() => setCreate(false)}><Form label="Zverejniť oznam" submit={async data => {
      await api("announcements", "POST", {...data, pinned: data.pinned === "on"}); setCreate(false); await refresh();
    }}>
      <label>Názov<input name="title" maxLength="120" required /></label>
      <label>Text<textarea name="body" maxLength="4000" required /></label>
      <label className="checkbox"><input name="pinned" type="checkbox" />Pripnúť na nástenku</label>
    </Form></Modal>}
  </>;
}

function Messages({user, conversations, refresh, initialContact}) {
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(initialContact || null);
  const [messages, setMessages] = useState([]);
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const scroller = useRef(null);
  const scrollPending = useRef(true);
  useEffect(() => {api("contacts").then(setContacts).catch(error => setError(error.message));}, []);
  const ids = new Set(conversations.map(item => item.contact_id));
  const people = [...conversations.map(c => ({...c, id: c.contact_id})), ...contacts.filter(c => !ids.has(c.id))];
  const person = people.find(item => item.id === selected);
  const canSend = contacts.some(item => item.id === selected);
  const latest = conversations.find(c => c.contact_id === selected)?.id;
  useEffect(() => {
    let current = true;
    scrollPending.current = true;
    setError("");
    if (selected) api("messages?contact_id=" + selected).then(async rows => {
      if (!current) return;
      setMessages(rows);
      setMore(rows.length === 200);
      const unread = rows.filter(row => row.recipient_id === user.id && !row.read_at);
      if (unread.length) {await api("messages/read", "POST", unread.map(row => row.id)); if (current) await refresh();}
    }).catch(error => {if (current) setError(error.message);});
    return () => {current = false;};
  }, [selected, latest, user.id]);
  useEffect(() => {
    if (scroller.current && scrollPending.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
      scrollPending.current = false;
    }
  }, [messages]);
  return <div className={"chat card flush " + (selected ? "conversation-open" : "")}>
    <aside className="conversation-list">
      <label className="search"><Search size={18} /><input type="search" aria-label="Hľadať konverzáciu" placeholder="Hľadať konverzáciu…" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {people.filter(p => p.name.toLowerCase().includes(query.toLowerCase())).map(person => <button className={"conversation-row " + (selected === person.id ? "active" : "")} key={person.id} onClick={() => {if (selected !== person.id) {setMessages([]); setMore(false);} setSelected(person.id);}}>
        <Avatar name={person.name} /><span className="grow"><strong>{person.name}</strong><span className="preview">{person.body || "Začať konverzáciu"}</span></span>
        <span className="conversation-meta">{person.created_at && <small>{clock(person.created_at)}</small>}{person.unread > 0 && <span className="counter">{person.unread}</span>}</span>
      </button>)}
      {people.length === 0 && <Empty icon={MessageCircle}>Zatiaľ nemáš žiadne kontakty.</Empty>}
    </aside>
    <section className="conversation-pane">
      {selected ? <>
        <div className="chat-head"><button className="icon-button chat-back" aria-label="Späť na konverzácie" onClick={() => setSelected(null)}><ChevronLeft /></button><Avatar name={person?.name || "Kontakt"} /><strong>{person?.name || "Kontakt"}</strong></div>
        <div className="message-stream" ref={scroller}>
          {error && <p className="error" role="alert">{error}</p>}
          {more && <Action className="text-button" run={async () => {
            const page = await api("messages?contact_id=" + selected + "&before=" + messages.at(-1).id);
            setMessages([...messages, ...page]); setMore(page.length === 200);
          }}>Staršie správy</Action>}
          {messages.length ? [...messages].reverse().map(item => <div className={"message " + (item.sender_id === user.id ? "outgoing" : "")} key={item.id}>
            <p>{item.body}</p><span>{date(item.created_at)}{item.sender_id === user.id && item.read_at && <CheckCheck size={13} />}</span>
          </div>) : <p className="muted small">Tu sa začína vaša konverzácia.</p>}
        </div>
        {canSend ? <div className="composer"><Form key={selected} label={<><Send size={18} /><span className="sr-only">Odoslať správu</span></>} reset submit={async data => {
          await api("messages", "POST", {recipient_id: selected, body: data.body});
          setMessages(await api("messages?contact_id=" + selected)); await refresh();
        }}><label className="sr-only" htmlFor="message-body">Správa</label><textarea id="message-body" name="body" rows="1" maxLength="4000" placeholder="Napíš správu…" required /></Form></div> : <p className="notice">Tomuto účtu už nemožno posielať správy.</p>}
      </> : <Empty icon={MessageCircle}>Vyber konverzáciu alebo kontakt.</Empty>}
    </section>
  </div>;
}

function Batteries({staff, initialCode}) {
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
          {Object.entries(batteryLabels).filter(([value]) => (value !== "retired" || staff) &&
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

function Profile({user, reloadUser}) {
  const [attendance, setAttendance] = useState([]);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  useEffect(() => {api("me/attendance").then(setAttendance).catch(error => setError(error.message));}, []);
  const attended = attendance.filter(row => row.attended).length;
  return <>
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
    <details className="card"><summary>Pridať aplikáciu na plochu</summary><p>Na iPhone otvor portál v Safari a vyber Zdieľať → Pridať na plochu. Zapni Otvoriť ako webovú aplikáciu, ak sa zobrazí.</p><p>Na Androide otvor menu prehliadača a vyber Inštalovať aplikáciu alebo Pridať na plochu.</p></details>
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
  ["home", "Domov", House], ["calendar", "Kalendár", CalendarDays],
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
      <p className="muted">{staff ? "Všetko pre najbližší tréning na jednom mieste." : "Tvoj tím, tréningy a nové správy."}</p></div>
      <span className="welcome-date">{new Date().toLocaleDateString("sk-SK", {weekday: "long", day: "numeric", month: "long", timeZone})}</span>
    </div>
    <div className="home-grid">
      <section className="home-main"><div className="section-heading"><h2>Najbližšie v klube</h2><button className="text-button" onClick={() => navigate("calendar")}>Kalendár<ChevronRight size={16} /></button></div>
        {next.length ? <TrainingCard training={next[0]} staff={staff} prominent refresh={refresh} open={() => openTraining(next[0].id)} /> : <Empty>Najbližšia udalosť ešte nie je naplánovaná.</Empty>}
        {next.slice(1, 3).map(t => <TrainingCard training={t} staff={staff} refresh={refresh} key={t.id} open={() => openTraining(t.id)} />)}
      </section>
      <aside className="home-side">
        <button className="card quick-link" onClick={() => navigate("messages")}><span className="quick-icon"><MessageCircle /></span><span className="grow"><strong>{unread ? unread + " neprečítaných správ" : "Správy s tímom"}</strong><span className="meta">{staff ? "Otvor konverzácie s členmi" : "Napíš svojmu trénerovi"}</span></span><ChevronRight size={18} /></button>
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
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState(() => hash().has("battery") ? "equipment" : hash().get("page") || "home");
  const [menu, setMenu] = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const session = useRef(null);
  const empty = {trainings: [], announcements: [], conversations: [], places: []};
  const data = snapshot && snapshot.owner === user ? snapshot.data : empty;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [trainingId, setTrainingId] = useState(null);
  const [activeBattery, setActiveBattery] = useState(() => hash().get("battery"));
  const [contact, setContact] = useState(null);
  const [createTraining, setCreateTraining] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const staff = user?.role === "coach" || user?.role === "superadmin";
  const superadmin = user?.role === "superadmin";
  const visibleNavigation = navigation.filter(([key]) => (key !== "members" || staff) && (key !== "management" || superadmin));
  const allowedPages = [...visibleNavigation.map(([key]) => key), "profile"];
  const currentPage = allowedPages.includes(page) ? page : "home";
  const title = currentPage === "profile" ? "Môj profil" : visibleNavigation.find(([key]) => key === currentPage)?.[1];
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
        api("trainings"), api("announcements"), api("conversations"), api("places"),
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
  function openMenu() {history.pushState({drawer: true}, "", location.href); setMenu(true);}
  function closeMenu() {if (history.state?.drawer) history.back(); else setMenu(false);}
  function messageMember(id) {setContact(id); navigate("messages");}
  async function logout() {
    await api("logout", "POST"); session.current = null; setSnapshot(null); setUser(null);
    setTrainingId(null); setMenu(false); setNotifications(false); setCreateTraining(false); setContact(null); history.replaceState({}, "", base);
    setPage("home");
  }
  useEffect(() => {loadUser();}, []);
  useEffect(() => {
    const onNavigation = () => {
      setMenu(Boolean(history.state?.drawer));
      setActiveBattery(hash().get("battery"));
      setPage(hash().has("battery") ? "equipment" : hash().get("page") || "home");
      setTrainingId(null); setContact(null);
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
  const unread = data.conversations.reduce((sum, row) => sum + row.unread, 0);
  const unreadNotices = data.announcements.filter(item => !item.is_read).length;
  const training = data.trainings.find(t => t.id === trainingId);
  const menuContent = <><nav aria-label="Hlavná navigácia">{visibleNavigation.map(([key, label, Icon]) =>
    <button key={key} className={currentPage === key ? "active" : ""} aria-current={currentPage === key ? "page" : undefined} onClick={() => navigate(key)}>
      <Icon size={20} /><span>{label}</span>{key === "messages" && unread > 0 && <span className="counter">{unread}</span>}
    </button>)}</nav><div className="menu-footer"><button className="person-link" aria-label="Môj profil" onClick={() => navigate("profile")}><Avatar name={user?.name || "Používateľ"} /><span className="grow"><strong>{user?.name}</strong><span className="meta">{roles[user?.role]}</span></span><Settings2 size={18} /></button>
      <Action className="logout-button" run={logout}><LogOut size={18} />Odhlásiť sa</Action></div></>;
  return <div className={user ? "app" : "signed-out"}>
    <header className="topbar">
      {user && <button className="icon-button hamburger" aria-label="Otvoriť menu" aria-expanded={menu} onClick={openMenu}><Menu /></button>}
      <a className="brand" href="#page=home" onClick={event => {event.preventDefault(); if (user) navigate("home");}}>
        <span className="brand-symbol" aria-hidden="true"><Drone size={24} /></span><span><strong>LF DS Hub</strong><small>Drone Soccer · LF TUKE</small></span>
      </a>
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
            {staff && <div className="toolbar end home-action"><button className="primary" onClick={() => setCreateTraining(true)}><Plus size={18} />Naplánovať udalosť</button></div>}
            <Home user={user} {...data} refresh={refresh} navigate={navigate} openTraining={setTrainingId} />
          </>}
          {currentPage === "calendar" && <Calendar trainings={data.trainings} staff={staff} places={data.places} refresh={refresh} openTraining={setTrainingId} />}
          {currentPage === "messages" && <Messages key={user.id + ":" + contact} user={user} conversations={data.conversations} refresh={refresh} initialContact={contact} />}
          {currentPage === "announcements" && <Bulletin items={data.announcements} staff={staff} refresh={refresh} />}
          {currentPage === "members" && staff && <Members key="members" superadmin={superadmin} onMessage={messageMember} />}
          {currentPage === "management" && superadmin && <Members key="management" superadmin management onMessage={messageMember} />}
          {currentPage === "equipment" && <Batteries key={user.id + ":" + activeBattery} staff={staff} initialCode={activeBattery} />}
          {currentPage === "documents" && <Documents staff={staff} />}
          {currentPage === "profile" && <Profile user={user} reloadUser={loadUser} />}
        </>}
      </>}
    </main>
    {user && training && <TrainingDetail key={training.id} training={training} staff={staff} places={data.places} refresh={refresh} close={() => setTrainingId(null)} />}
    {user && createTraining && <Modal title="Nová udalosť" close={() => setCreateTraining(false)}><TrainingForm places={data.places} done={async () => {setCreateTraining(false); await refresh();}} /></Modal>}
    {user && notifications && <Modal title="Oznámenia" close={() => setNotifications(false)}>
      <button className="card quick-link" onClick={() => navigate("messages")}><MessageCircle /><span className="grow"><strong>Správy</strong><span className="meta">{unread ? unread + " neprečítaných" : "Všetko máš prečítané"}</span></span><ChevronRight /></button>
      {data.announcements.filter(item => !item.is_read).map(item => <button className="card quick-link" key={item.id} onClick={() => navigate("announcements")}><Megaphone /><span className="grow"><strong>{item.title}</strong><span className="meta">{date(item.created_at)}</span></span><ChevronRight /></button>)}
    </Modal>}
  </div>;
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("sw.js", base)).catch(console.error);
}
