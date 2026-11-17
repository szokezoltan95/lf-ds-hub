import React, {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
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

function Action({run, children}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <span className="action"><button type="button" disabled={busy} onClick={async () => {
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
      <label>Nové heslo<input name="password" type="password" minLength="12" maxLength="128" autoComplete="new-password" required /></label>
      <small>Použi aspoň 12 znakov.</small>
    </Form> : <Form key="login" label="Prihlásiť sa" submit={async data => {
      await api("login", "POST", data);
      await onLogin();
    }}>
      <label>E-mail<input type="email" name="email" autoComplete="username" maxLength="254" required /></label>
      <label>Heslo<input type="password" name="password" autoComplete="current-password" maxLength="128" required /></label>
    </Form>}
  </section>;
}

function TrainingForm({training, done}) {
  return <Form label={training ? "Uložiť zmeny" : "Pridať tréning"} reset={!training}
    submit={async data => {
      await api(training ? "trainings/" + training.id : "trainings", training ? "PUT" : "POST", {
        ...data, starts_at: trainingISO(data.starts_at), weeks: Number(data.weeks || 1),
      });
      await done();
    }}>
    <label>Názov<input name="title" maxLength="120" defaultValue={training?.title} required /></label>
    <div className="form-row">
      <label>Začiatok (slovenský čas)<input type="datetime-local" name="starts_at" defaultValue={training && clubLocal(training.starts_at)} required /></label>
      <label>Miesto<input name="location" maxLength="120" defaultValue={training?.location} required /></label>
    </div>
    <label>Pokyny<textarea name="instructions" maxLength="1000" defaultValue={training?.instructions} /></label>
    {!training && <label>Počet týždenných termínov<input type="number" name="weeks" min="1" max="26" defaultValue="1" required /></label>}
  </Form>;
}

function Roster({training}) {
  const [rows, setRows] = useState(null);
  const path = "trainings/" + training.id;
  async function load() { setRows(await api(path + "/roster")); }
  return <div>
    <Action run={rows ? () => setRows(null) : load}>{rows ? "Skryť účasť" : "Zobraziť účasť"}</Action>
    {rows && <Action run={load}>Obnoviť prehľad</Action>}
    {rows && (rows.length ? <ul className="records">{rows.map(row => <li key={row.id}>
      <strong>{row.name}</strong>
      <span>{labels[row.response] || "Bez odpovede"}{row.attended === true ? " · Prítomný" : row.attended === false ? " · Neprítomný" : ""}</span>
      {row.note && <p>{row.note}</p>}
      {past(training) && !training.cancelled && <div className="actions">{[true, false].map(attended =>
        <Action key={String(attended)} run={async () => {
          await api(path + "/attendance/" + row.id, "PUT", {attended});
          await load();
        }}>{attended ? "Prítomný" : "Neprítomný"}</Action>)}</div>}
    </li>)}</ul> : <p>Zatiaľ bez účastníkov.</p>)}
  </div>;
}

function TrainingCard({training, admin, refresh}) {
  const [edit, setEdit] = useState(false);
  const [cancel, setCancel] = useState(false);
  return <article className="card">
    <p className="meta">{date(training.starts_at)} · {training.location}</p>
    <h2>{training.title}</h2>
    {training.cancelled && <p className="notice">Tréning bol zrušený</p>}
    {training.instructions && <p className="body">{training.instructions}</p>}
    {admin && <div className="actions">
      <Roster key={training.starts_at + training.location + training.cancelled} training={training} />
      {!training.cancelled && <button onClick={() => setEdit(!edit)}>{edit ? "Zavrieť úpravy" : "Upraviť"}</button>}
      {!training.cancelled && <button onClick={() => setCancel(!cancel)}>{cancel ? "Späť" : "Zrušiť tréning"}</button>}
      {cancel && !training.cancelled && <Action run={async () => {
        await api("trainings/" + training.id + "/cancel", "POST");
        setCancel(false);
        setEdit(false);
        await refresh();
      }}>Potvrdiť zrušenie</Action>}
    </div>}
    {edit && <TrainingForm key={training.id} training={training} done={async () => {setEdit(false); await refresh();}} />}
    {!admin && !past(training) && !training.cancelled &&
      <Form key={training.response + training.starts_at + training.location} label="Uložiť odpoveď" submit={async data => {
        await api("trainings/" + training.id + "/rsvp", "PUT", data);
        await refresh();
      }}>
        <label>Účasť<select name="response" defaultValue={training.response || ""} required>
          <option value="" disabled>Vyber odpoveď</option>
          {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Poznámka pre trénera<input name="note" maxLength="1000" defaultValue={training.note || ""} /></label>
      </Form>}
  </article>;
}

function Members() {
  const [members, setMembers] = useState([]);
  const [link, setLink] = useState("");
  const [attendance, setAttendance] = useState(null);
  const [error, setError] = useState("");
  async function load() { setMembers(await api("members")); }
  useEffect(() => {load().catch(error => setError(error.message));}, []);
  return <>
    <section className="card auth-link"><h2>Pozvať člena</h2>
      <Form label="Vytvoriť pozvánku" reset submit={async data => {
        const result = await api("members/invite", "POST", data);
        setLink(result.invite_url);
        await load();
      }}>
        <label>Meno<input name="name" maxLength="120" required /></label>
        <label>E-mail<input name="email" type="email" maxLength="254" required /></label>
      </Form>
      {link && <div className="invite"><label>Odkaz pre člena (platí 7 dní)<input readOnly value={link} onFocus={e => e.target.select()} /></label>
        {navigator.clipboard && <Action run={() => navigator.clipboard.writeText(link)}>Kopírovať odkaz</Action>}
      </div>}
    </section>
    <section className="card"><h2>Zoznam členov</h2>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="records">{members.map(member => <li key={member.id}>
        <strong>{member.name}</strong><span>{member.email} · {member.role === "admin" ? "Správca" : !member.active ? "Neaktívny" : member.registered ? "Aktívny" : "Pozvaný"}</span>
        {member.role !== "admin" && <div className="actions">
          <Action run={async () => {
            await api("members/" + member.id + "/active", "PUT", {active: !member.active});
            await load();
          }}>{member.active ? "Deaktivovať" : "Aktivovať"}</Action>
          {member.active && member.registered && <Action run={async () => {
            const result = await api("members/" + member.id + "/reset", "POST");
            setLink(result.invite_url);
            document.querySelector(".auth-link")?.scrollIntoView();
          }}>Vytvoriť odkaz na obnovu hesla</Action>}
          <Action run={async () => setAttendance(attendance?.member === member.id ? null : {
            member: member.id, rows: await api("members/" + member.id + "/attendance"),
          })}>Dochádzka</Action>
        </div>}
        {attendance?.member === member.id && (attendance.rows.length ? <ul>{attendance.rows.map((row, i) =>
          <li key={i}>{date(row.starts_at)} · {row.title} · {row.attended ? "Prítomný" : "Neprítomný"}</li>
        )}</ul> : <p>Zatiaľ bez záznamu.</p>)}
      </li>)}</ul>
    </section>
  </>;
}

function Bulletin({items, admin, refresh}) {
  return <>
    {admin && <section className="card"><h2>Nový oznam</h2>
      <Form label="Zverejniť" reset submit={async data => {await api("announcements", "POST", data); await refresh();}}>
        <label>Názov<input name="title" maxLength="120" required /></label>
        <label>Text<textarea name="body" maxLength="4000" required /></label>
      </Form>
    </section>}
    {items.length ? items.map(item => <article className="card" key={item.id}>
      <p className="meta">{date(item.created_at)}</p><h2>{item.title}</h2><p className="body">{item.body}</p>
    </article>) : <p>Zatiaľ žiadne oznamy.</p>}
  </>;
}

function Messages({items, user, refresh}) {
  const [contacts, setContacts] = useState([]);
  const [older, setOlder] = useState([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {api("contacts").then(setContacts).catch(error => setError(error.message));}, []);
  const messages = [...new Map([...items, ...older].map(item => [item.id, item])).values()];
  const unread = items.filter(item => item.recipient_id === user.id && !item.read_at);
  return <>
    <section className="card"><h2>Napísať správu</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {contacts.length ? <Form label="Odoslať" reset submit={async data => {
        await api("messages", "POST", {...data, recipient_id: Number(data.recipient_id)});
        await refresh();
      }}>
        <label>Adresát<select name="recipient_id" required>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Správa<textarea name="body" maxLength="4000" required /></label>
      </Form> : <p>Nie je dostupný žiadny adresát.</p>}
    </section>
    {unread.length > 0 && <Action run={async () => {await api("messages/read", "POST", unread.map(m => m.id)); await refresh();}}>Označiť nové správy ako prečítané</Action>}
    {messages.length ? messages.map(item => <article className="card" key={item.id}>
      <p className="meta">{date(item.created_at)} · {item.sender_id === user.id ? "Pre " + item.recipient : "Od " + item.sender}</p>
      <p className="body">{item.body}</p>
    </article>) : <p>Zatiaľ žiadne správy.</p>}
    {more && items.length === 200 && <Action run={async () => {
      const page = await api("messages?before=" + messages.at(-1).id);
      setOlder([...older, ...page]);
      setMore(page.length === 200);
    }}>Staršie správy</Action>}
  </>;
}

function Batteries({admin}) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(() => hash().get("battery") || "");
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  async function load() { setItems(await api("batteries")); }
  async function loadEvents(code) { setEvents(await api("batteries/" + encodeURIComponent(code) + "/events")); }
  useEffect(() => {load().catch(error => setError(error.message));}, []);
  useEffect(() => {
    let current = true;
    setEvents([]);
    if (/^LF-B[0-9]{2,6}$/.test(selected)) {
      api("batteries/" + selected + "/events").then(events => {if (current) setEvents(events);})
        .catch(error => {if (current) setError(error.message);});
    }
    return () => {current = false;};
  }, [selected]);
  const battery = items.find(item => item.code === selected);
  return <>
    {error && <p className="error" role="alert">{error}</p>}
    {admin && <section className="card"><h2>Pridať batériu</h2>
      <Form label="Pridať" reset submit={async data => {await api("batteries", "POST", data); await load(); setSelected(data.code);}}>
        <label>Kód<input name="code" placeholder="LF-B01" pattern="LF-B[0-9]{2,6}" required /></label>
        <label>Označenie<input name="label" maxLength="120" required /></label>
      </Form>
    </section>}
    <section className="card">
      <label>Batéria<select value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">Vyber batériu</option>{items.map(b => <option key={b.code} value={b.code}>{b.code} · {b.label}</option>)}
      </select></label>
      {selected && !battery && items.length > 0 && <p>Batéria sa nenašla.</p>}
      {battery && <>
        <h2>{battery.code} · {battery.label}</h2>
        <p>{batteryLabels[battery.status] || "Bez záznamu"} · {battery.charges} evidovaných nabití</p>
        {admin && <p><a href={new URL("api/batteries/" + battery.code + "/label.svg", base)} download={battery.code + ".svg"}>Stiahnuť QR štítok</a></p>}
        {battery.status !== "retired" && (battery.status !== "damaged" || admin) &&
          <Form key={battery.code + battery.status} label="Zapísať úkon" reset submit={async data => {
            await api("batteries/" + battery.code + "/events", "POST", data);
            await Promise.all([load(), loadEvents(battery.code)]);
          }}>
            <label>Úkon<select name="action" required>
              {Object.entries(batteryLabels).filter(([action]) => (action !== "retired" || admin) && (battery.status !== "damaged" || action === "retired"))
                .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label>Poznámka<input name="note" maxLength="1000" /></label>
          </Form>}
        <h3>História</h3>
        <ul className="records">{events.map(event => <li key={event.id}>{date(event.created_at)} · {batteryLabels[event.action]} · {event.name}{event.note && " · " + event.note}</li>)}</ul>
      </>}
    </section>
  </>;
}

function App() {
  const [user, setUser] = useState(undefined);
  const [page, setPage] = useState(() => hash().has("battery") ? "Batérie" : "Prehľad");
  const empty = {trainings: [], announcements: [], messages: []};
  const [snapshot, setSnapshot] = useState(null);
  const session = useRef(null);
  const data = snapshot?.owner && snapshot.owner === user ? snapshot.data : empty;
  const [error, setError] = useState("");
  const admin = user?.role === "admin";
  async function loadUser() {
    try {
      const signedIn = await api("me");
      session.current = signedIn;
      setUser(signedIn);
    } catch (error) {
      if (error.status !== 401) setError(error.message);
      setUser(null);
    }
  }
  async function refresh() {
    try {
      const [trainings, announcements, messages] = await Promise.all([api("trainings"), api("announcements"), api("messages")]);
      if (session.current === user) {
        setSnapshot({owner: user, data: {trainings, announcements, messages}});
        setError("");
      }
    } catch (error) {
      if (session.current !== user) return;
      if (error.status === 401) {
        session.current = null;
        setSnapshot(null);
        setUser(null);
      } else setError(error.message);
    }
  }
  const [activeBattery, setActiveBattery] = useState(() => hash().get("battery"));
  useEffect(() => {loadUser();}, []);
  useEffect(() => {
    const navigate = () => {
      setActiveBattery(hash().get("battery"));
      if (hash().has("battery")) setPage("Batérie");
    };
    addEventListener("hashchange", navigate);
    return () => removeEventListener("hashchange", navigate);
  }, []);
  useEffect(() => {
    if (!user) return;
    refresh();
    const timer = setInterval(() => {if (!document.hidden) refresh();}, 30000);
    return () => clearInterval(timer);
  }, [user]);
  const unread = data.messages.filter(item => user && item.recipient_id === user.id && !item.read_at).length;
  const upcoming = data.trainings.filter(t => !t.cancelled && !past(t));
  return <>
    <header><div className="shell brand">
      <img src="./icon-192.png" width="46" height="46" alt="" />
      <div><strong>LF DS Hub</strong><span>Drone Soccer · LF TUKE</span></div>
      {user && <div className="account"><span>{user.name}</span><Action run={async () => {
        await api("logout", "POST"); session.current = null; setSnapshot(null); setError("");
        setPage(hash().has("battery") ? "Batérie" : "Prehľad"); setUser(null);
      }}>Odhlásiť</Action></div>}
    </div></header>
    <main className="shell">
      {error && <p className="error" role="alert">{error}</p>}
      {user === undefined ? <p>Načítava sa…</p> : !user ? <Login onLogin={loadUser} /> : <>
        <nav aria-label="Hlavná navigácia">
          {["Prehľad", "Tréningy", "Oznamy", "Správy", ...(admin ? ["Členovia"] : []), "Batérie"].map(tab =>
            <button key={tab} aria-current={page === tab ? "page" : undefined} onClick={() => setPage(tab)}>
              {tab}{tab === "Správy" && unread > 0 && " (" + unread + ")"}
            </button>)}
        </nav>
        <h1>{page}</h1>
        {page === "Prehľad" && <div className="dashboard">
          <section><h2>Najbližší tréning</h2>{upcoming.length ? <TrainingCard training={upcoming[0]} admin={admin} refresh={refresh} /> : <p>Žiadny naplánovaný tréning.</p>}</section>
          <section className="card"><h2>Oznamy a správy</h2>
            {data.announcements.length ? <><p className="meta">{date(data.announcements[0].created_at)}</p>
              <h3>{data.announcements[0].title}</h3><p className="body">{data.announcements[0].body}</p></> : <p>Zatiaľ žiadne oznamy.</p>}
            <div className="actions"><button onClick={() => setPage("Oznamy")}>Všetky oznamy</button>
              <button onClick={() => setPage("Správy")}>{unread ? "Neprečítané správy (" + unread + ")" : "Otvoriť správy"}</button></div>
          </section>
          <details className="card install"><summary>Pridať aplikáciu na plochu</summary>
            <p>Na iPhone otvor portál v Safari a vyber Zdieľať → Pridať na plochu. Ak sa zobrazí voľba Otvoriť ako webovú aplikáciu, zapni ju.</p>
            <p>Na Androide otvor menu prehliadača a vyber Inštalovať aplikáciu alebo Pridať na plochu.</p>
          </details>
        </div>}
        {page === "Tréningy" && <>
          {admin && <details className="card"><summary>Naplánovať tréning</summary><TrainingForm done={refresh} /></details>}
          {data.trainings.length ? data.trainings.map(t => <TrainingCard key={t.id} training={t} admin={admin} refresh={refresh} />) : <p>Žiadne tréningy.</p>}
        </>}
        {page === "Oznamy" && <Bulletin items={data.announcements} admin={admin} refresh={refresh} />}
        {page === "Správy" && <Messages items={data.messages} user={user} refresh={refresh} />}
        {page === "Členovia" && admin && <Members />}
        {page === "Batérie" && <Batteries key={activeBattery} admin={admin} />}
      </>}
    </main>
  </>;
}

createRoot(document.getElementById("root")).render(<App />);
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(new URL("sw.js", base)).catch(console.error);
}
