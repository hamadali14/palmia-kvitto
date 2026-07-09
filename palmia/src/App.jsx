import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  LayoutDashboard,
  Receipt,
  Plus,
  Minus,
  Trash2,
  FileDown,
  Search,
  ChevronDown,
  TrendingUp,
  Wallet,
  ShoppingBag,
  Package,
  Check,
  Sparkles,
  Download,
  AlertTriangle,
  Menu,
  X,
  Cloud,
  LogOut,
  Coins,
  Boxes,
} from "lucide-react";

/* ============================ produkter ============================ */
/* Varje produkt: pris (vad kunden betalar) + keep (din andel av vinsten).
   Skyldig till leverantoren = pris - keep. Bade pris och keep gar att andra. */
const defaultProducts = () => [
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `bb${i + 1}`,
    name: `Bundle Bundle ${i + 1}`,
    price: 850,
    keep: 500,
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `b${i + 1}`,
    name: `Bundle ${i + 1}`,
    price: 350,
    keep: 250,
  })),
];
/* modul-spegel sa rena funktioner (saleTotals, PDF) kan sla upp produkter */
let PRODUCTS = defaultProducts();
const setModuleProducts = (list) => {
  if (Array.isArray(list) && list.length) PRODUCTS = list;
};
const productById = (id) => PRODUCTS.find((p) => p.id === id) || null;

/* ============================ lagring ============================ */
const LS = {
  sales: "palmia_sales",
  counter: "palmia_used_numbers",
  products: "palmia_products",
};
function readLS(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function writeLS(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* lagring otillganglig */
  }
}

/* ============================ moln + inloggning (Supabase) ============================ */
/* Fyll i dina Supabase-uppgifter nedan. Med dem pa kravs inloggning och all data
   sparas sakert i molnet (en rad per forsaljning) och synkas mellan dina enheter.
   Lamnar du dem tomma anvands endast lokal lagring utan inloggning. */
const SUPABASE_URL = "https://lxvtgcddboccaqzxayyf.supabase.co"
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4dnRnY2RkYm9jY2FxenhheXlmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1NDU5NTksImV4cCI6MjA5OTEyMTk1OX0.dzdS0gSwIODgJmmhqt3om3kWxB00ETK6_xVh7Vm4d6A"
const CLOUD_ON = Boolean(SUPABASE_URL && SUPABASE_KEY);

let _sbClient = null;
async function getSb() {
  if (!CLOUD_ON) return null;
  if (_sbClient) return _sbClient;
  const mod = await import(
    /* @vite-ignore */ "https://esm.sh/@supabase/supabase-js@2"
  );
  const createClient = mod.createClient || (mod.default && mod.default.createClient);
  _sbClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  return _sbClient;
}

/* mappning mellan app-objekt och databasrad */
const saleToRow = (s) => ({
  id: s.id,
  number: s.number,
  date: s.date,
  method: s.method,
  items: s.items,
  total: s.total,
  profit: s.profit,
  units: s.units,
});
const rowToSale = (r) => {
  const items = Array.isArray(r.items) ? r.items : [];
  const t = saleTotals(items);
  return {
    id: r.id,
    number: r.number,
    date: r.date,
    method: r.method,
    items,
    total: t.total,
    profit: t.profit,
    owe: t.owe,
    units: t.units,
    createdAt: r.created_at || new Date().toISOString(),
  };
};

async function cloudFetchSales() {
  const sb = await getSb();
  if (!sb) return { error: "offline" };
  const { data, error } = await sb
    .from("sales")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return { error };
  return { data: (data || []).map(rowToSale) };
}
async function cloudInsertSale(sale) {
  const sb = await getSb();
  if (!sb) return { error: "offline" };
  const { error } = await sb.from("sales").insert(saleToRow(sale));
  return { error };
}
async function cloudDeleteSale(id) {
  const sb = await getSb();
  if (!sb) return { error: "offline" };
  const { error } = await sb.from("sales").delete().eq("id", id);
  return { error };
}
async function cloudDeleteAll() {
  const sb = await getSb();
  if (!sb) return { error: "offline" };
  const { error } = await sb.from("sales").delete().neq("id", "___none___");
  return { error };
}

/* produkter i molnet (kraver en 'settings'-tabell; saknas den anvands lokalt) */
async function cloudSaveProducts(products) {
  const sb = await getSb();
  if (!sb) return;
  try {
    await sb
      .from("settings")
      .upsert({ id: "products", data: products }, { onConflict: "user_id,id" });
  } catch {
    /* settings-tabell saknas - produkter sparas bara lokalt */
  }
}
async function cloudLoadProducts() {
  const sb = await getSb();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("settings")
      .select("data")
      .eq("id", "products")
      .maybeSingle();
    if (error) return null;
    return data ? data.data : null;
  } catch {
    return null;
  }
}

/* ============================ format & helpers ============================ */
const SEK = (n) =>
  new Intl.NumberFormat("sv-SE", {
    style: "currency",
    currency: "SEK",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(n) ? n : 0);

const num = (v) => {
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const todayISO = () => {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const yearOf = (iso) => (iso ? iso.slice(0, 4) : String(new Date().getFullYear()));
const prettyDate = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
};
const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const safeName = (s) =>
  String(s || "")
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "kvitto";

/* slumpmassigt men giltigt kvittonummer, unikt mot redan anvanda */
function makeNumber(dateISO, used) {
  const y = yearOf(dateISO);
  for (let i = 0; i < 9999; i++) {
    const n = `PALMIA-${y}-${String(Math.floor(1000 + Math.random() * 9000))}`;
    if (!used.includes(n)) return n;
  }
  return `PALMIA-${y}-${Date.now().toString().slice(-4)}`;
}

/* per-rad: vinst = min(pris, keep), skyldig = max(0, pris - keep) */
function lineCalc(unitPrice, keep, qty) {
  const p = Math.max(0, num(unitPrice));
  const k = Math.max(0, num(keep));
  const q = Math.max(0, Math.floor(num(qty)));
  return {
    total: p * q,
    profit: Math.min(p, k) * q,
    owe: Math.max(0, p - k) * q,
    units: q,
  };
}
/* effektivt pris/keep for en rad (snapshot om det finns, annars produktens nuvarande) */
function linePrice(it) {
  if (it.unitPrice != null) return it.unitPrice;
  const p = productById(it.productId);
  return p ? p.price : 0;
}
function lineKeep(it) {
  if (it.keep != null) return it.keep;
  const p = productById(it.productId);
  return p ? p.keep : 0;
}

/* summering av en forsaljning (fungerar for bade sparade snapshots och utkast) */
function saleTotals(items) {
  let total = 0;
  let profit = 0;
  let owe = 0;
  let units = 0;
  for (const it of items) {
    if (!it.productId) continue;
    const c = lineCalc(linePrice(it), lineKeep(it), it.qty);
    total += c.total;
    profit += c.profit;
    owe += c.owe;
    units += c.units;
  }
  return { total, profit, owe, units };
}

/* ============================ UI-kontext (toast + confirm) ============================ */
const UI = createContext({ toast: () => {}, confirm: async () => false });
const useUI = () => useContext(UI);

function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [ask, setAsk] = useState(null);

  const toast = useCallback((msg, tone = "ok") => {
    const id = uid();
    setToasts((t) => [...t, { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        setAsk({ ...opts, resolve });
      }),
    []
  );

  const close = (val) => {
    if (ask) ask.resolve(val);
    setAsk(null);
  };

  return (
    <UI.Provider value={{ toast, confirm }}>
      {children}
      <div className="pf-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`pf-toast pf-toast-${t.tone}`}>
            {t.tone === "ok" ? <Check size={16} /> : <AlertTriangle size={16} />}
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
      {ask && (
        <div className="pf-modal-wrap" onMouseDown={() => close(false)}>
          <div className="pf-modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{ask.title}</h3>
            {ask.body && <p>{ask.body}</p>}
            <div className="pf-modal-row">
              <button className="pf-btn pf-ghost" onClick={() => close(false)}>
                {ask.cancel || "Avbryt"}
              </button>
              <button
                className={`pf-btn ${ask.danger ? "pf-danger" : "pf-primary"}`}
                onClick={() => close(true)}
              >
                {ask.ok || "Bekrafta"}
              </button>
            </div>
          </div>
        </div>
      )}
    </UI.Provider>
  );
}

/* ============================ primitiver ============================ */
function Btn({ children, variant = "ghost", icon: Icon, ...rest }) {
  return (
    <button className={`pf-btn pf-${variant}`} {...rest}>
      {Icon && <Icon size={17} />}
      <span>{children}</span>
    </button>
  );
}
function Card({ title, right, children, className = "" }) {
  return (
    <section className={`pf-card ${className}`}>
      {(title || right) && (
        <header className="pf-card-head">
          <h2>{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}
function Stepper({ value, onChange, min = 1 }) {
  const v = Math.max(min, Math.floor(num(value)) || min);
  return (
    <div className="pf-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, v - 1))} aria-label="Minska">
        <Minus size={15} />
      </button>
      <input
        inputMode="numeric"
        value={v}
        onChange={(e) => onChange(Math.max(min, Math.floor(num(e.target.value)) || min))}
      />
      <button type="button" onClick={() => onChange(v + 1)} aria-label="Oka">
        <Plus size={15} />
      </button>
    </div>
  );
}

/* sokbar produktvaljare */
function ProductPicker({ value, onPick, products }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrap = useRef(null);
  const selected = productById(value);

  useEffect(() => {
    function onDoc(e) {
      if (wrap.current && !wrap.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (products || []).filter((p) => !s || p.name.toLowerCase().includes(s));
  }, [q, products]);

  return (
    <div className="pf-picker" ref={wrap}>
      <button
        type="button"
        className={`pf-picker-btn ${selected ? "" : "pf-placeholder"}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{selected ? selected.name : "Valj produkt ..."}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="pf-picker-pop">
          <div className="pf-picker-search">
            <Search size={15} />
            <input
              autoFocus
              placeholder="Sok bundle ..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="pf-picker-list">
            {list.length === 0 && <div className="pf-picker-empty">Ingen traff.</div>}
            {list.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`pf-picker-item ${p.id === value ? "is-sel" : ""}`}
                onClick={() => {
                  onPick(p.id);
                  setOpen(false);
                  setQ("");
                }}
              >
                <span className="pf-pi-name">{p.name}</span>
                <span className="pf-pi-price">{SEK(p.price)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================ PDF-mall (och live-preview) ============================ */
/* Endast solida farger + web-safe CSS sa html2canvas renderar troget. Ingen vinst visas. */
function PdfDocument({ sale }) {
  const t = saleTotals(sale.items);
  const rows = sale.items
    .map((it) => {
      const prod = productById(it.productId);
      return {
        name: it.name || (prod ? prod.name : "Produkt"),
        price: linePrice(it),
        qty: Math.max(0, Math.floor(num(it.qty))),
      };
    })
    .filter((r) => r.qty > 0);

  return (
    <div className="pf-pdf">
      <div className="pf-pdf-top">
        <div>
          <div className="pf-pdf-brand">Palmia</div>
          <div className="pf-pdf-sub">Handgjorda parfymer</div>
        </div>
        <div className="pf-pdf-meta">
          <div className="pf-pdf-doctype">Kvitto</div>
          <div className="pf-pdf-metaline">Nr {sale.number}</div>
          <div className="pf-pdf-metaline">Datum {prettyDate(sale.date)}</div>
        </div>
      </div>

      <div className="pf-pdf-rule" />

      <table className="pf-pdf-table">
        <thead>
          <tr>
            <th className="l">Produkt</th>
            <th className="c">Antal</th>
            <th className="r">Pris</th>
            <th className="r">Summa</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="l">{r.name}</td>
              <td className="c">{r.qty}</td>
              <td className="r">{SEK(r.price)}</td>
              <td className="r">{SEK(r.price * r.qty)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td className="l pf-pdf-dim" colSpan={4}>
                Inga produkter tillagda.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="pf-pdf-total">
        <span>Att betala</span>
        <span>{SEK(t.total)}</span>
      </div>

      <div className="pf-pdf-pay">
        <span>Betalning</span>
        <span>{sale.method || "Swish"}</span>
      </div>

      <div className="pf-pdf-foot">
        <div className="pf-pdf-thanks">Tack for ditt kop.</div>
        <div className="pf-pdf-note">
          Privat forsaljning av hobbyverksamhet. Ej momsregistrerad. Detta ar ett
          betalningskvitto, inte en foretagsfaktura.
        </div>
      </div>
    </div>
  );
}

function ScaledPreview({ sale }) {
  const wrap = useRef(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, el.clientWidth / 794));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="pf-preview" ref={wrap}>
      <div
        className="pf-preview-inner"
        style={{ transform: `scale(${scale})`, height: 1123 * scale }}
      >
        <PdfDocument sale={sale} />
      </div>
    </div>
  );
}

/* ============================ PDF-generering ============================ */
/* Ritas direkt med jsPDF (vektor/text). Ingen html2canvas -> mycket stabilare.
   ASCII-sakra strangar och vanliga mellanslag sa inbyggda typsnitt renderar ratt. */
const pdfKr = (n) =>
  `${Math.round(Number(n) || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")} kr`;

async function generatePdf(sale) {
  const filename = `Palmia-kvitto-${safeName(sale.number)}-${sale.date}.pdf`;
  try {
    const mod = await import("jspdf");
    const JsPDF = mod.jsPDF || mod.default;
    const doc = new JsPDF({ unit: "mm", format: "a4" });

    const L = 20;
    const R = 190;
    const ink = [34, 29, 23];
    const grey = [124, 113, 96];
    const gold = [201, 154, 60];
    const soft = [225, 216, 199];
    const faint = [240, 231, 216];

    const rows = sale.items
      .map((it) => {
        const prod = productById(it.productId);
        return {
          name: it.name || (prod ? prod.name : "Produkt"),
          price: linePrice(it),
          qty: Math.max(0, Math.floor(num(it.qty))),
        };
      })
      .filter((r) => r.qty > 0);
    const t = saleTotals(sale.items);

    /* huvud */
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.setFont("times", "bold");
    doc.setFontSize(30);
    doc.text("Palmia", L, 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(grey[0], grey[1], grey[2]);
    doc.text("HANDGJORDA PARFYMER", L, 36);

    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.setFont("times", "normal");
    doc.setFontSize(16);
    doc.text("Kvitto", R, 28, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(grey[0], grey[1], grey[2]);
    doc.text(`Nr ${sale.number}`, R, 34, { align: "right" });
    doc.text(`Datum ${prettyDate(sale.date)}`, R, 39, { align: "right" });

    /* guldstreck */
    doc.setDrawColor(gold[0], gold[1], gold[2]);
    doc.setLineWidth(0.9);
    doc.line(L, 46, L + 24, 46);

    /* tabellhuvud */
    let y = 58;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(grey[0], grey[1], grey[2]);
    doc.text("PRODUKT", L, y);
    doc.text("ANTAL", 128, y, { align: "right" });
    doc.text("PRIS", 160, y, { align: "right" });
    doc.text("SUMMA", R, y, { align: "right" });
    y += 2.5;
    doc.setDrawColor(soft[0], soft[1], soft[2]);
    doc.setLineWidth(0.3);
    doc.line(L, y, R, y);
    y += 7;

    /* rader */
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    if (rows.length === 0) {
      doc.setTextColor(grey[0], grey[1], grey[2]);
      doc.text("Inga produkter tillagda.", L, y);
      y += 8;
      doc.setTextColor(ink[0], ink[1], ink[2]);
    }
    for (const r of rows) {
      if (y > 250) {
        doc.addPage();
        y = 28;
      }
      const nameLines = doc.splitTextToSize(r.name, 80);
      doc.text(nameLines, L, y);
      doc.text(String(r.qty), 128, y, { align: "right" });
      doc.text(pdfKr(r.price), 160, y, { align: "right" });
      doc.text(pdfKr(r.price * r.qty), R, y, { align: "right" });
      const h = Math.max(7, nameLines.length * 5);
      y += h;
      doc.setDrawColor(faint[0], faint[1], faint[2]);
      doc.setLineWidth(0.2);
      doc.line(L, y - 3, R, y - 3);
    }

    /* summa */
    y += 6;
    doc.setFont("times", "normal");
    doc.setFontSize(12);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    doc.text("Att betala", L, y);
    doc.setFont("times", "bold");
    doc.setFontSize(17);
    doc.text(pdfKr(t.total), R, y + 1, { align: "right" });

    /* betalning */
    y += 10;
    doc.setDrawColor(faint[0], faint[1], faint[2]);
    doc.setLineWidth(0.2);
    doc.line(L, y - 4, R, y - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(grey[0], grey[1], grey[2]);
    doc.text("Betalning", L, y);
    doc.text(sale.method || "Swish", R, y, { align: "right" });

    /* fot */
    doc.setFont("times", "normal");
    doc.setFontSize(14);
    doc.setTextColor(gold[0], gold[1], gold[2]);
    doc.text("Tack for ditt kop.", L, 262);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(grey[0], grey[1], grey[2]);
    const note = doc.splitTextToSize(
      "Privat forsaljning av hobbyverksamhet. Ej momsregistrerad. Detta ar ett betalningskvitto, inte en foretagsfaktura.",
      150
    );
    doc.text(note, L, 270);

    doc.save(filename);
    return true;
  } catch {
    return false;
  }
}

/* ============================ vyer ============================ */
function StatCard({ icon: Icon, label, value, accent, owe }) {
  return (
    <div className={`pf-stat ${accent ? "pf-stat-accent" : ""} ${owe ? "pf-stat-owe" : ""}`}>
      <div className="pf-stat-ic">
        <Icon size={18} />
      </div>
      <div className="pf-stat-body">
        <div className="pf-stat-label">{label}</div>
        <div className="pf-stat-value">{value}</div>
      </div>
    </div>
  );
}

function Dashboard({ sales, onExport, goNew }) {
  const agg = useMemo(() => {
    let revenue = 0;
    let profit = 0;
    let owe = 0;
    let units = 0;
    const per = new Map();
    for (const s of sales) {
      revenue += s.total;
      profit += s.profit;
      owe += s.owe || 0;
      for (const it of s.items) {
        if (!it.productId) continue;
        const prod = productById(it.productId);
        const name = it.name || (prod ? prod.name : it.productId);
        const c = lineCalc(linePrice(it), lineKeep(it), it.qty);
        if (c.units <= 0) continue;
        units += c.units;
        const cur = per.get(it.productId) || { name, units: 0, revenue: 0, profit: 0, owe: 0 };
        cur.units += c.units;
        cur.revenue += c.total;
        cur.profit += c.profit;
        cur.owe += c.owe;
        per.set(it.productId, cur);
      }
    }
    const products = [...per.values()].sort((a, b) => b.units - a.units || b.profit - a.profit);
    return { revenue, profit, owe, units, products };
  }, [sales]);

  const recent = useMemo(
    () => [...sales].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5),
    [sales]
  );

  return (
    <div className="pf-view">
      <div className="pf-view-head">
        <div>
          <h1>Oversikt</h1>
          <p className="pf-lead">Din forsaljning, vinst och skuld — samlat.</p>
        </div>
        <Btn variant="primary" icon={Plus} onClick={goNew}>
          Ny forsaljning
        </Btn>
      </div>

      <div className="pf-stats">
        <StatCard icon={Wallet} label="Total forsaljning" value={SEK(agg.revenue)} />
        <StatCard icon={TrendingUp} label="Total vinst" value={SEK(agg.profit)} accent />
        <StatCard icon={Coins} label="Skyldig totalt" value={SEK(agg.owe)} owe />
        <StatCard icon={ShoppingBag} label="Salda enheter" value={agg.units} />
      </div>

      <div className="pf-grid2">
        <Card title="Salda produkter" right={<span className="pf-badge">{agg.products.length} sorter</span>}>
          {agg.products.length === 0 ? (
            <div className="pf-empty">
              <Package size={22} />
              <p>Inga forsaljningar an. Skapa din forsta for att se statistik.</p>
            </div>
          ) : (
            <div className="pf-table-wrap">
              <table className="pf-table">
                <thead>
                  <tr>
                    <th className="l">Produkt</th>
                    <th className="r">Salda</th>
                    <th className="r">Intakt</th>
                    <th className="r">Vinst</th>
                    <th className="r">Skyldig</th>
                  </tr>
                </thead>
                <tbody>
                  {agg.products.map((p) => (
                    <tr key={p.name}>
                      <td className="l">{p.name}</td>
                      <td className="r">{p.units}</td>
                      <td className="r">{SEK(p.revenue)}</td>
                      <td className="r pf-profit">{SEK(p.profit)}</td>
                      <td className="r pf-owe">{SEK(p.owe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Senaste forsaljningar">
          {recent.length === 0 ? (
            <div className="pf-empty">
              <Receipt size={22} />
              <p>Historiken visas har.</p>
            </div>
          ) : (
            <ul className="pf-recent">
              {recent.map((s) => (
                <li key={s.id}>
                  <div className="pf-recent-main">
                    <span className="pf-mono">{s.number}</span>
                    <span className="pf-recent-date">{prettyDate(s.date)}</span>
                  </div>
                  <div className="pf-recent-right">
                    <span className="pf-recent-total">{SEK(s.total)}</span>
                    <button className="pf-icon-btn" title="Ladda ner PDF" onClick={() => onExport(s)}>
                      <FileDown size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function NewSale({ draft, setDraft, onSave, onExportDraft, products }) {
  const t = saleTotals(draft.items);

  const setItem = (id, patch) =>
    setDraft((d) => ({
      ...d,
      items: d.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
  const pickProduct = (id, prodId) => {
    const prod = products.find((x) => x.id === prodId);
    setItem(id, { productId: prodId, unitPrice: prod ? prod.price : "" });
  };
  const addItem = () =>
    setDraft((d) => ({ ...d, items: [...d.items, { id: uid(), productId: "", qty: 1 }] }));
  const removeItem = (id) =>
    setDraft((d) => {
      const items = d.items.filter((it) => it.id !== id);
      return { ...d, items: items.length ? items : [{ id: uid(), productId: "", qty: 1 }] };
    });

  const previewSale = {
    number: draft.number,
    date: draft.date,
    method: draft.method,
    items: draft.items,
  };

  return (
    <div className="pf-view">
      <div className="pf-view-head">
        <div>
          <h1>Ny forsaljning</h1>
          <p className="pf-lead">
            Valj produkt — pris fylls i men gar att andra. "100%" tar hela vinsten (inget skyldigt).
          </p>
        </div>
      </div>

      <div className="pf-sale-grid">
        <div className="pf-sale-left">
          <Card title="Produkter" right={<span className="pf-badge">Steg 1</span>}>
            <div className="pf-lines">
              {draft.items.map((it) => {
                const p = productById(it.productId);
                const priceVal = it.unitPrice != null ? it.unitPrice : p ? p.price : "";
                const c = p ? lineCalc(priceVal, p.keep, it.qty) : { total: 0, owe: 0 };
                const isFull = p && num(priceVal) <= p.keep;
                return (
                  <div className="pf-line" key={it.id}>
                    <div className="pf-line-pick">
                      <label className="pf-lbl">Produkt</label>
                      <ProductPicker
                        value={it.productId}
                        products={products}
                        onPick={(id) => pickProduct(it.id, id)}
                      />
                    </div>
                    <div className="pf-line-qty">
                      <label className="pf-lbl">Antal</label>
                      <Stepper value={it.qty} onChange={(q) => setItem(it.id, { qty: q })} />
                    </div>
                    <div className="pf-line-price">
                      <label className="pf-lbl">A-pris (kr)</label>
                      <div className="pf-price-wrap">
                        <input
                          className="pf-input pf-price-input"
                          inputMode="numeric"
                          disabled={!p}
                          value={priceVal}
                          onChange={(e) => setItem(it.id, { unitPrice: e.target.value })}
                        />
                        <button
                          type="button"
                          className={`pf-full-btn ${isFull ? "is-on" : ""}`}
                          title="100% vinst - satt pris till din andel, inget skyldigt"
                          disabled={!p}
                          onClick={() => setItem(it.id, { unitPrice: p.keep })}
                        >
                          100%
                        </button>
                      </div>
                    </div>
                    <div className="pf-line-sum">
                      <label className="pf-lbl">Radtotal</label>
                      <div className="pf-line-static pf-strong">{SEK(c.total)}</div>
                    </div>
                    <button
                      className="pf-line-del"
                      title="Ta bort rad"
                      onClick={() => removeItem(it.id)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })}
            </div>
            <button className="pf-add" onClick={addItem}>
              <Plus size={16} /> Lagg till produkt
            </button>
          </Card>

          <Card title="Kvittoinformation" right={<span className="pf-badge">Auto</span>}>
            <div className="pf-info-grid">
              <div>
                <label className="pf-lbl">Kvittonummer</label>
                <div className="pf-line-static pf-mono">{draft.number}</div>
              </div>
              <div>
                <label className="pf-lbl">Datum</label>
                <input
                  type="date"
                  className="pf-input"
                  value={draft.date}
                  onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))}
                />
              </div>
              <div>
                <label className="pf-lbl">Betalning</label>
                <select
                  className="pf-input"
                  value={draft.method}
                  onChange={(e) => setDraft((d) => ({ ...d, method: e.target.value }))}
                >
                  <option>Swish</option>
                  <option>Kontant</option>
                  <option>Overforing</option>
                  <option>Kort</option>
                </select>
              </div>
            </div>
          </Card>

          <div className="pf-summary">
            <div className="pf-summary-row">
              <span>Att betala</span>
              <span className="pf-summary-total">{SEK(t.total)}</span>
            </div>
            <div className="pf-summary-row pf-summary-profit">
              <span>Din vinst (visas ej pa kvittot)</span>
              <span>{SEK(t.profit)}</span>
            </div>
            <div className="pf-summary-row pf-summary-owe">
              <span>Skyldig leverantoren</span>
              <span>{SEK(t.owe)}</span>
            </div>
            <div className="pf-summary-actions">
              <Btn variant="ghost" icon={FileDown} onClick={onExportDraft}>
                Ladda ner PDF
              </Btn>
              <Btn variant="primary" icon={Check} onClick={onSave}>
                Spara forsaljning
              </Btn>
            </div>
          </div>
        </div>

        <div className="pf-sale-right">
          <div className="pf-preview-label">Forhandsvisning</div>
          <ScaledPreview sale={previewSale} />
        </div>
      </div>
    </div>
  );
}

function History({ sales, onExport, onDelete, onClear, onBackup }) {
  const sorted = useMemo(
    () => [...sales].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
    [sales]
  );
  return (
    <div className="pf-view">
      <div className="pf-view-head">
        <div>
          <h1>Historik</h1>
          <p className="pf-lead">Alla sparade forsaljningar. Ladda ner PDF nar du vill.</p>
        </div>
        <div className="pf-head-actions">
          <Btn variant="ghost" icon={Download} onClick={onBackup}>
            Sakerhetskopia
          </Btn>
          <Btn variant="ghost" icon={Trash2} onClick={onClear}>
            Rensa allt
          </Btn>
        </div>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <div className="pf-empty">
            <Receipt size={22} />
            <p>Inga sparade forsaljningar an.</p>
          </div>
        </Card>
      ) : (
        <div className="pf-hist-list">
          {sorted.map((s) => (
            <div className="pf-hist-item" key={s.id}>
              <div className="pf-hist-id">
                <span className="pf-mono">{s.number}</span>
                <span className="pf-hist-date">
                  {prettyDate(s.date)}
                  {s._pending ? " · ej synkad" : ""}
                </span>
              </div>
              <div className="pf-hist-figs">
                <div>
                  <span className="pf-hist-k">Enheter</span>
                  <span className="pf-hist-v">{s.units}</span>
                </div>
                <div>
                  <span className="pf-hist-k">Summa</span>
                  <span className="pf-hist-v">{SEK(s.total)}</span>
                </div>
                <div>
                  <span className="pf-hist-k">Vinst</span>
                  <span className="pf-hist-v pf-profit">{SEK(s.profit)}</span>
                </div>
                <div>
                  <span className="pf-hist-k">Skyldig</span>
                  <span className="pf-hist-v pf-owe">{SEK(s.owe || 0)}</span>
                </div>
              </div>
              <div className="pf-hist-act">
                <button className="pf-icon-btn" title="Ladda ner PDF" onClick={() => onExport(s)}>
                  <FileDown size={16} />
                </button>
                <button className="pf-icon-btn pf-icon-danger" title="Radera" onClick={() => onDelete(s)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================ produkter-sida ============================ */
function Products({ products, onChange, sales }) {
  const stats = useMemo(() => {
    const m = new Map();
    for (const s of sales) {
      for (const it of s.items) {
        if (!it.productId) continue;
        const c = lineCalc(linePrice(it), lineKeep(it), it.qty);
        const cur = m.get(it.productId) || { units: 0, profit: 0, owe: 0 };
        cur.units += c.units;
        cur.profit += c.profit;
        cur.owe += c.owe;
        m.set(it.productId, cur);
      }
    }
    return m;
  }, [sales]);

  return (
    <div className="pf-view">
      <div className="pf-view-head">
        <div>
          <h1>Produkter</h1>
          <p className="pf-lead">
            Andra pris och din vinst-andel. Skyldig till leverantoren = pris minus din andel.
          </p>
        </div>
      </div>

      <div className="pf-prod-list">
        {products.map((p) => {
          const st = stats.get(p.id) || { units: 0, profit: 0, owe: 0 };
          const cost = Math.max(0, num(p.price) - num(p.keep));
          return (
            <div className="pf-prod" key={p.id}>
              <div className="pf-prod-name">{p.name}</div>
              <div className="pf-prod-fields">
                <label className="pf-prod-f">
                  <span>Pris (kr)</span>
                  <input
                    className="pf-input"
                    inputMode="numeric"
                    value={p.price}
                    onChange={(e) => onChange(p.id, { price: e.target.value })}
                  />
                </label>
                <label className="pf-prod-f">
                  <span>Din vinst (kr)</span>
                  <input
                    className="pf-input"
                    inputMode="numeric"
                    value={p.keep}
                    onChange={(e) => onChange(p.id, { keep: e.target.value })}
                  />
                </label>
                <div className="pf-prod-f">
                  <span>Skyldig / st</span>
                  <div className="pf-prod-static pf-owe">{SEK(cost)}</div>
                </div>
              </div>
              <div className="pf-prod-stats">
                <div>
                  <span className="pf-hist-k">Salda</span>
                  <span className="pf-hist-v">{st.units}</span>
                </div>
                <div>
                  <span className="pf-hist-k">Vinst</span>
                  <span className="pf-hist-v pf-profit">{SEK(st.profit)}</span>
                </div>
                <div>
                  <span className="pf-hist-k">Skyldig</span>
                  <span className="pf-hist-v pf-owe">{SEK(st.owe)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ rot ============================ */
const NAV = [
  { key: "dashboard", label: "Oversikt", icon: LayoutDashboard },
  { key: "new", label: "Ny forsaljning", icon: Plus },
  { key: "history", label: "Historik", icon: Receipt },
  { key: "products", label: "Produkter", icon: Boxes },
];

function Shell({ onLogout }) {
  const { toast, confirm } = useUI();
  const [view, setView] = useState("dashboard");
  const [menuOpen, setMenuOpen] = useState(false);
  const [sales, setSales] = useState(() => readLS(LS.sales, []));
  const [products, setProducts] = useState(() => {
    const saved = readLS(LS.products, null);
    return Array.isArray(saved) && saved.length ? saved : defaultProducts();
  });
  const [syncState, setSyncState] = useState(CLOUD_ON ? "syncing" : "local");
  const [draft, setDraft] = useState(() => ({
    number: "",
    date: todayISO(),
    method: "Swish",
    items: [{ id: uid(), productId: "", qty: 1 }],
  }));

  /* hall modul-spegeln i synk sa rena funktioner (saleTotals, PDF) ser ratt produkter */
  setModuleProducts(products);

  const prodReady = useRef(!CLOUD_ON);

  /* ladda produkter fran molnet vid start (om det finns) */
  useEffect(() => {
    if (!CLOUD_ON) return;
    let cancelled = false;
    (async () => {
      const remote = await cloudLoadProducts();
      if (cancelled) return;
      if (Array.isArray(remote) && remote.length) {
        setProducts(remote);
      } else {
        cloudSaveProducts(readLS(LS.products, products));
      }
      prodReady.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* spara produkter lokalt (direkt) + i molnet nar det ar laddat */
  useEffect(() => {
    writeLS(LS.products, products);
    if (CLOUD_ON && prodReady.current) cloudSaveProducts(products);
  }, [products]);

  const updateProduct = useCallback((id, patch) => {
    setProducts((list) => list.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  const salesRef = useRef(sales);
  useEffect(() => {
    salesRef.current = sales;
  }, [sales]);
  const flushing = useRef(false);

  /* harled anvanda kvittonummer fran forsaljningarna (aldrig ur synk) */
  const usedNumbers = useMemo(() => sales.map((s) => s.number), [sales]);

  /* lokal cache (direkt, funkar offline) */
  useEffect(() => {
    writeLS(LS.sales, sales);
  }, [sales]);

  /* skjut upp osynkade forsaljningar till molnet */
  const flushPending = useCallback(async () => {
    if (!CLOUD_ON || flushing.current) return;
    flushing.current = true;
    try {
      const pend = salesRef.current.filter((s) => s._pending);
      for (const s of pend) {
        const clean = { ...s };
        delete clean._pending;
        const { error } = await cloudInsertSale(clean);
        if (error) break; // fortfarande offline
        setSales((cur) =>
          cur.map((x) => (x.id === s.id ? { ...x, _pending: false } : x))
        );
      }
      setSyncState("ok");
    } catch {
      setSyncState("offline");
    } finally {
      flushing.current = false;
    }
  }, []);

  /* moln: hamta all data vid start (molnet ar sanningskallan) */
  useEffect(() => {
    if (!CLOUD_ON) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await cloudFetchSales();
      if (cancelled) return;
      if (error) {
        setSyncState("offline");
        return;
      }
      setSales((local) => {
        const cloudIds = new Set(data.map((s) => s.id));
        const pending = local.filter((s) => s._pending && !cloudIds.has(s.id));
        return [...pending, ...data].sort((a, b) =>
          a.createdAt < b.createdAt ? 1 : -1
        );
      });
      setSyncState("ok");
      flushPending();
    })();
    return () => {
      cancelled = true;
    };
  }, [flushPending]);

  /* forsok synka osynkat med jamna mellanrum */
  useEffect(() => {
    if (!CLOUD_ON) return;
    const id = setInterval(() => flushPending(), 15000);
    return () => clearInterval(id);
  }, [flushPending]);

  /* auto-nummer: satts nar det saknas eller nar aret andras */
  useEffect(() => {
    setDraft((d) => {
      const y = yearOf(d.date);
      if (d.number && d.number.startsWith(`PALMIA-${y}-`)) return d;
      return { ...d, number: makeNumber(d.date, usedNumbers) };
    });
  }, [draft.date, usedNumbers]);

  const exportSale = useCallback(
    async (sale) => {
      const ok = await generatePdf(sale);
      if (!ok) toast("Kunde inte skapa PDF. Kontrollera att jspdf ar installerat.", "warn");
    },
    [toast]
  );

  const saveSale = useCallback(async () => {
    const t = saleTotals(draft.items);
    const hasProduct = draft.items.some((it) => productById(it.productId));
    if (!hasProduct) {
      toast("Lagg till minst en produkt forst.", "warn");
      return;
    }
    if (!draft.date) {
      toast("Valj ett datum.", "warn");
      return;
    }
    const number =
      draft.number && !usedNumbers.includes(draft.number)
        ? draft.number
        : makeNumber(draft.date, usedNumbers);
    const sale = {
      id: uid(),
      number,
      date: draft.date,
      method: draft.method,
      items: draft.items
        .filter((it) => productById(it.productId) && Math.floor(num(it.qty)) > 0)
        .map((it) => {
          const prod = productById(it.productId);
          const unitPrice = it.unitPrice != null ? num(it.unitPrice) : num(prod.price);
          return {
            productId: it.productId,
            name: prod.name,
            qty: Math.max(1, Math.floor(num(it.qty))),
            unitPrice,
            keep: num(prod.keep),
          };
        }),
      total: t.total,
      profit: t.profit,
      owe: t.owe,
      units: t.units,
      createdAt: new Date().toISOString(),
    };
    const resetDraft = () => {
      setDraft({
        number: "",
        date: todayISO(),
        method: draft.method,
        items: [{ id: uid(), productId: "", qty: 1 }],
      });
      setView("history");
    };

    if (!CLOUD_ON) {
      setSales((s) => [sale, ...s]);
      resetDraft();
      toast(`Forsaljning ${number} sparad.`, "ok");
      return;
    }

    /* lagg till direkt (som osynkad), forsok spara i molnet */
    setSales((s) => [{ ...sale, _pending: true }, ...s]);
    resetDraft();
    const { error } = await cloudInsertSale(sale);
    if (!error) {
      setSales((s) => s.map((x) => (x.id === sale.id ? { ...x, _pending: false } : x)));
      setSyncState("ok");
      toast(`Forsaljning ${number} sparad.`, "ok");
    } else {
      setSyncState("offline");
      toast("Sparad lokalt - synkas nar internet ateransluter.", "warn");
    }
  }, [draft, usedNumbers, toast]);

  const exportDraft = useCallback(() => {
    const hasProduct = draft.items.some((it) => productById(it.productId));
    if (!hasProduct) {
      toast("Lagg till minst en produkt forst.", "warn");
      return;
    }
    exportSale({
      number: draft.number || makeNumber(draft.date, usedNumbers),
      date: draft.date,
      method: draft.method,
      items: draft.items,
    });
  }, [draft, usedNumbers, exportSale, toast]);

  const deleteSale = useCallback(
    async (sale) => {
      const ok = await confirm({
        title: "Radera forsaljning?",
        body: `${sale.number} tas bort permanent.`,
        ok: "Radera",
        danger: true,
      });
      if (!ok) return;
      if (CLOUD_ON && !sale._pending) {
        const { error } = await cloudDeleteSale(sale.id);
        if (error) {
          toast("Kunde inte radera nu - forsok igen nar du ar online.", "warn");
          return;
        }
      }
      setSales((s) => s.filter((x) => x.id !== sale.id));
      toast("Forsaljning raderad.", "ok");
    },
    [confirm, toast]
  );

  const clearAll = useCallback(async () => {
    const ok = await confirm({
      title: "Rensa all data?",
      body: CLOUD_ON
        ? "Alla forsaljningar raderas fran ditt konto och alla enheter. Detta gar inte att angra."
        : "Alla sparade forsaljningar raderas fran den har webblasaren. Detta gar inte att angra.",
      ok: "Rensa allt",
      danger: true,
    });
    if (!ok) return;
    if (CLOUD_ON) {
      const { error } = await cloudDeleteAll();
      if (error) {
        toast("Kunde inte rensa nu - forsok igen nar du ar online.", "warn");
        return;
      }
    }
    setSales([]);
    toast("All data rensad.", "ok");
  }, [confirm, toast]);

  const backup = useCallback(() => {
    try {
      const blob = new Blob([JSON.stringify({ sales }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `palmia-backup-${todayISO()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("Sakerhetskopia nedladdad.", "ok");
    } catch {
      toast("Kunde inte skapa kopia.", "warn");
    }
  }, [sales, toast]);

  return (
    <div className="pf-app">
      <StyleInjector />

      <aside className="pf-side">
        <div className="pf-logo">
          <span className="pf-logo-mark">Palmia</span>
          <span className="pf-logo-sub">Forsaljning</span>
        </div>
        <nav className="pf-nav">
          {NAV.map((n) => (
            <button
              key={n.key}
              className={`pf-nav-btn ${view === (n.key === "new" ? "new" : n.key) ? "is-active" : ""}`}
              onClick={() => setView(n.key === "new" ? "new" : n.key)}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="pf-side-foot-wrap">
          <div className="pf-side-foot">
            {CLOUD_ON ? <Cloud size={13} /> : <Sparkles size={13} />}
            <span>
              {!CLOUD_ON
                ? "Data sparas lokalt i din webblasare."
                : syncState === "offline"
                ? "Offline - synkas nar internet finns."
                : "Synkas mellan dina enheter."}
            </span>
          </div>
          {onLogout && (
            <button className="pf-logout" onClick={onLogout}>
              <LogOut size={15} /> <span>Logga ut</span>
            </button>
          )}
        </div>
      </aside>

      <div className="pf-topbar">
        <span className="pf-logo-mark">Palmia</span>
        <button
          className="pf-menu-btn"
          aria-label="Meny"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        {menuOpen && (
          <>
            <div className="pf-menu-overlay" onClick={() => setMenuOpen(false)} />
            <div className="pf-menu-panel" role="menu">
              {NAV.map((n) => {
                const key = n.key === "new" ? "new" : n.key;
                return (
                  <button
                    key={n.key}
                    role="menuitem"
                    className={`pf-menu-item ${view === key ? "is-active" : ""}`}
                    onClick={() => {
                      setView(key);
                      setMenuOpen(false);
                    }}
                  >
                    <n.icon size={18} />
                    <span>{n.label}</span>
                  </button>
                );
              })}
              {onLogout && (
                <button
                  role="menuitem"
                  className="pf-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                >
                  <LogOut size={18} />
                  <span>Logga ut</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <main className="pf-main">
        {view === "dashboard" && (
          <Dashboard sales={sales} onExport={exportSale} goNew={() => setView("new")} />
        )}
        {view === "new" && (
          <NewSale
            draft={draft}
            setDraft={setDraft}
            onSave={saveSale}
            onExportDraft={exportDraft}
            products={products}
          />
        )}
        {view === "history" && (
          <History
            sales={sales}
            onExport={exportSale}
            onDelete={deleteSale}
            onClear={clearAll}
            onBackup={backup}
          />
        )}
        {view === "products" && (
          <Products products={products} onChange={updateProduct} sales={sales} />
        )}
      </main>
    </div>
  );
}

/* ============================ inloggning ============================ */
function Login() {
  const [mode, setMode] = useState("in"); // in | up
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submit = async () => {
    setMsg("");
    if (!email || !pw) {
      setMsg("Fyll i e-post och losenord.");
      return;
    }
    setBusy(true);
    try {
      const sb = await getSb();
      if (!sb) {
        setMsg("Ingen anslutning till servern.");
        setBusy(false);
        return;
      }
      const res =
        mode === "in"
          ? await sb.auth.signInWithPassword({ email, password: pw })
          : await sb.auth.signUp({ email, password: pw });
      if (res.error) {
        setMsg(res.error.message || "Nagot gick fel.");
      } else if (mode === "up" && !res.data.session) {
        setMsg("Konto skapat. Kolla din e-post om bekraftelse kravs, logga sedan in.");
        setMode("in");
      }
      /* vid lyckad inloggning byter Root vy automatiskt via onAuthStateChange */
    } catch {
      setMsg("Nagot gick fel. Forsok igen.");
    }
    setBusy(false);
  };

  return (
    <div className="pf-login">
      <StyleInjector />
      <div className="pf-login-card">
        <div className="pf-login-brand">Palmia</div>
        <div className="pf-login-sub">Forsaljning</div>
        <p className="pf-login-lead">
          {mode === "in" ? "Logga in for att se din forsaljning." : "Skapa ett konto."}
        </p>
        <label className="pf-lbl">E-post</label>
        <input
          className="pf-input"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <label className="pf-lbl" style={{ marginTop: 12 }}>
          Losenord
        </label>
        <input
          className="pf-input"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        {msg && <div className="pf-login-msg">{msg}</div>}
        <button className="pf-btn pf-primary pf-login-btn" disabled={busy} onClick={submit}>
          {busy ? "..." : mode === "in" ? "Logga in" : "Skapa konto"}
        </button>
        <button
          className="pf-login-switch"
          onClick={() => {
            setMode((m) => (m === "in" ? "up" : "in"));
            setMsg("");
          }}
        >
          {mode === "in" ? "Har du inget konto? Skapa ett" : "Har du redan ett konto? Logga in"}
        </button>
      </div>
    </div>
  );
}

/* ============================ rot med inloggnings-grind ============================ */
function Root() {
  const [phase, setPhase] = useState(CLOUD_ON ? "loading" : "local");

  useEffect(() => {
    if (!CLOUD_ON) return;
    let cancelled = false;
    let unsub = null;
    (async () => {
      let sb = null;
      try {
        sb = await getSb();
      } catch {
        sb = null;
      }
      if (cancelled) return;
      if (!sb) {
        setPhase("local"); // klarar sig utan moln om klienten inte kan laddas
        return;
      }
      try {
        const { data } = await sb.auth.getSession();
        if (cancelled) return;
        setPhase(data.session ? "in" : "out");
        const sub = sb.auth.onAuthStateChange((_e, session) => {
          setPhase(session ? "in" : "out");
        });
        unsub = () => sub.data.subscription.unsubscribe();
      } catch {
        if (!cancelled) setPhase("local");
      }
    })();
    return () => {
      cancelled = true;
      if (unsub) unsub();
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      const sb = await getSb();
      if (sb) await sb.auth.signOut();
    } catch {
      /* ignore */
    }
  }, []);

  if (phase === "loading") {
    return (
      <div className="pf-splash">
        <StyleInjector />
        <div className="pf-splash-brand">Palmia</div>
      </div>
    );
  }
  if (phase === "out") return <Login />;
  return <Shell onLogout={phase === "in" ? logout : null} />;
}

export default function App() {
  return (
    <UIProvider>
      <Root />
    </UIProvider>
  );
}

/* ============================ stil ============================ */
function StyleInjector() {
  useEffect(() => {
    const id = "palmia-fonts";
    if (!document.getElementById(id)) {
      const l1 = document.createElement("link");
      l1.rel = "preconnect";
      l1.href = "https://fonts.googleapis.com";
      const l2 = document.createElement("link");
      l2.rel = "preconnect";
      l2.href = "https://fonts.gstatic.com";
      l2.crossOrigin = "anonymous";
      const l3 = document.createElement("link");
      l3.id = id;
      l3.rel = "stylesheet";
      l3.href =
        "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Jost:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";
      document.head.appendChild(l1);
      document.head.appendChild(l2);
      document.head.appendChild(l3);
    }
  }, []);
  return <style>{CSS}</style>;
}

const CSS = `
:root{
  --cream:#F1E9DB; --raised:#FBF7EF; --ink:#221D17; --muted:#7C7160;
  --line:#E2D8C7; --line-soft:#EDE4D5; --gold:#C99A3C; --gold-deep:#A87F2C;
  --brown:#332A22; --brown-hi:#463A2E; --profit:#1C6B60; --danger:#B4472F; --owe:#B06A3B;
  --shadow:0 18px 44px -30px rgba(60,45,25,.55);
}
*{box-sizing:border-box}
html,body,#root{height:100%}
html,body{background:#EFE6D6; overflow-x:hidden; width:100%}
body{margin:0; -webkit-text-size-adjust:100%; text-size-adjust:100%}
img,svg,table{max-width:100%}
.pf-app{
  min-height:100vh; display:grid; grid-template-columns:246px minmax(0,1fr);
  font-family:'Jost',system-ui,sans-serif; color:var(--ink);
  background:
    radial-gradient(1100px 620px at 82% -8%, #FBF3E6 0%, rgba(251,243,230,0) 60%),
    radial-gradient(900px 560px at 0% 108%, #F6EEDE 0%, rgba(246,238,222,0) 55%),
    linear-gradient(160deg,#F3EBDD 0%, #EFE6D6 100%);
}
h1,h2,h3{font-family:'Cormorant Garamond',serif; letter-spacing:.2px; margin:0}
.pf-mono{font-family:'IBM Plex Mono',monospace; font-size:.86em}

/* sidebar */
.pf-side{
  position:sticky; top:0; align-self:start; height:100vh; padding:26px 18px;
  display:flex; flex-direction:column; gap:26px;
  background:linear-gradient(180deg, rgba(251,247,239,.86), rgba(248,242,230,.7));
  backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
  border-right:1px solid var(--line);
}
.pf-logo{display:flex; flex-direction:column; gap:2px; padding:0 8px}
.pf-logo-mark{font-family:'Cormorant Garamond',serif; font-weight:700; font-size:27px; line-height:1}
.pf-logo-sub{font-size:11px; letter-spacing:.24em; text-transform:uppercase; color:var(--muted)}
.pf-nav{display:flex; flex-direction:column; gap:4px}
.pf-nav-btn{
  display:flex; align-items:center; gap:11px; padding:11px 12px; border:none; cursor:pointer;
  background:transparent; color:var(--muted); border-radius:12px; font:inherit; font-size:14.5px; text-align:left;
  transition:.16s;
}
.pf-nav-btn:hover{background:rgba(201,154,60,.10); color:var(--ink)}
.pf-nav-btn.is-active{background:var(--raised); color:var(--ink); box-shadow:inset 0 0 0 1px var(--line)}
.pf-side-foot-wrap{margin-top:auto; display:flex; flex-direction:column; gap:10px}
.pf-side-foot{display:flex; gap:8px; align-items:flex-start; color:var(--muted); font-size:11.5px; padding:0 8px; line-height:1.4}
.pf-logout{display:flex; align-items:center; gap:8px; padding:9px 12px; border:1px solid var(--line); background:transparent; color:var(--muted); border-radius:10px; font:inherit; font-size:13px; cursor:pointer; transition:.15s}
.pf-logout:hover{border-color:var(--danger); color:var(--danger)}

/* topbar (mobil) */
.pf-topbar{display:none}

/* main - flytande container */
.pf-main{min-width:0; padding:clamp(18px,3.4vw,40px) clamp(16px,3.6vw,44px) 64px}
.pf-view{width:100%; max-width:none; margin:0}
.pf-view-head{display:flex; align-items:flex-end; justify-content:space-between; gap:16px; margin-bottom:clamp(18px,2.4vw,24px); flex-wrap:wrap}
.pf-view-head h1{font-size:clamp(26px,3.4vw,34px); font-weight:600}
.pf-lead{margin:4px 0 0; color:var(--muted); font-size:clamp(13px,1.4vw,14px)}
.pf-head-actions{display:flex; gap:8px; flex-wrap:wrap}

/* stat - auto-fit fyller bredden pa alla enheter */
.pf-stats{display:grid; grid-template-columns:repeat(auto-fit,minmax(210px,1fr)); gap:clamp(10px,1.4vw,14px); margin-bottom:clamp(16px,2vw,22px)}
.pf-stat{
  display:flex; gap:12px; align-items:center; padding:16px; min-width:0;
  background:linear-gradient(180deg, rgba(251,247,239,.9), rgba(249,243,232,.72));
  border:1px solid var(--line); border-radius:16px; box-shadow:var(--shadow);
}
.pf-stat-ic{flex:0 0 auto; width:38px; height:38px; border-radius:11px; display:grid; place-items:center; background:rgba(201,154,60,.14); color:var(--gold-deep)}
.pf-stat-accent .pf-stat-ic{background:rgba(28,107,96,.13); color:var(--profit)}
.pf-stat-body{min-width:0}
.pf-stat-label{font-size:11.5px; letter-spacing:.13em; text-transform:uppercase; color:var(--muted)}
.pf-stat-value{font-family:'Cormorant Garamond',serif; font-size:clamp(22px,2.4vw,26px); font-weight:600; line-height:1.1; overflow-wrap:anywhere}
.pf-stat-accent .pf-stat-value{color:var(--profit)}

/* card */
.pf-card{
  background:linear-gradient(180deg, rgba(251,247,239,.92), rgba(250,244,234,.78));
  border:1px solid var(--line); border-radius:18px; padding:clamp(16px,2vw,20px); box-shadow:var(--shadow); min-width:0;
}
.pf-card + .pf-card{margin-top:16px}
.pf-card-head{display:flex; align-items:center; justify-content:space-between; gap:10px; margin-bottom:14px}
.pf-card-head h2{font-size:clamp(19px,2.2vw,21px); font-weight:600}
.pf-badge{white-space:nowrap; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); background:rgba(201,154,60,.12); padding:4px 9px; border-radius:999px}
.pf-grid2{display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:clamp(12px,1.6vw,16px)}

/* tabell */
.pf-table-wrap{overflow-x:auto; -webkit-overflow-scrolling:touch}
.pf-table{width:100%; border-collapse:collapse; font-size:14px}
.pf-table th{font-family:'Jost'; font-weight:500; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap}
.pf-table td{padding:10px 10px; border-bottom:1px solid var(--line-soft)}
.pf-table tr:last-child td{border-bottom:none}
.pf-table .l{text-align:left}
.pf-table .r{text-align:right; white-space:nowrap}
.pf-table .c{text-align:center}
.pf-profit{color:var(--profit); font-weight:500}
.pf-owe{color:var(--owe); font-weight:500}
.pf-stat-owe .pf-stat-ic{background:rgba(176,106,59,.14); color:var(--owe)}
.pf-stat-owe .pf-stat-value{color:var(--owe)}

/* recent */
.pf-recent{list-style:none; margin:0; padding:0; display:flex; flex-direction:column}
.pf-recent li{display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px 2px; border-bottom:1px solid var(--line-soft)}
.pf-recent li:last-child{border-bottom:none}
.pf-recent-main{display:flex; flex-direction:column; gap:2px; min-width:0}
.pf-recent-main .pf-mono{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.pf-recent-date{font-size:12px; color:var(--muted)}
.pf-recent-right{display:flex; align-items:center; gap:12px; flex:0 0 auto}
.pf-recent-total{font-family:'Cormorant Garamond',serif; font-size:19px; font-weight:600}

/* historik-kort */
.pf-hist-list{display:flex; flex-direction:column; gap:12px}
.pf-hist-item{
  display:grid; grid-template-columns:minmax(0,1fr) auto auto; gap:18px; align-items:center;
  padding:16px 18px; border:1px solid var(--line); border-radius:16px; box-shadow:var(--shadow);
  background:linear-gradient(180deg, rgba(251,247,239,.92), rgba(250,244,234,.78));
}
.pf-hist-id{display:flex; flex-direction:column; gap:3px; min-width:0}
.pf-hist-id .pf-mono{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.pf-hist-date{font-size:12px; color:var(--muted)}
.pf-hist-figs{display:flex; gap:clamp(14px,2.4vw,26px)}
.pf-hist-figs > div{display:flex; flex-direction:column; gap:2px; text-align:right; white-space:nowrap}
.pf-hist-k{font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted)}
.pf-hist-v{font-size:15px; font-weight:500}
.pf-hist-act{display:flex; gap:6px}

/* produkter-sida */
.pf-prod-list{display:grid; grid-template-columns:repeat(auto-fit,minmax(340px,1fr)); gap:14px}
.pf-prod{border:1px solid var(--line); border-radius:16px; padding:16px 18px; box-shadow:var(--shadow); background:linear-gradient(180deg, rgba(251,247,239,.92), rgba(250,244,234,.78)); min-width:0}
.pf-prod-name{font-family:'Cormorant Garamond',serif; font-size:19px; font-weight:600; margin-bottom:12px}
.pf-prod-fields{display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; align-items:end}
.pf-prod-f{display:flex; flex-direction:column; gap:5px; min-width:0}
.pf-prod-f > span{font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted)}
.pf-prod-f .pf-input{text-align:right}
.pf-prod-static{padding:10px 12px; border-radius:11px; background:rgba(243,235,222,.6); border:1px solid var(--line-soft); font-size:14px; text-align:right; white-space:nowrap}
.pf-prod-stats{display:flex; gap:20px; margin-top:14px; padding-top:12px; border-top:1px solid var(--line-soft)}
.pf-prod-stats > div{display:flex; flex-direction:column; gap:2px}
.pf-prod-stats .pf-hist-v{font-size:15px}

/* empty */
.pf-empty{display:flex; flex-direction:column; align-items:center; gap:8px; padding:34px 12px; text-align:center; color:var(--muted)}
.pf-empty svg{color:var(--gold-deep); opacity:.7}
.pf-empty p{margin:0; font-size:13.5px; max-width:280px}

/* buttons */
.pf-btn{display:inline-flex; align-items:center; justify-content:center; gap:8px; padding:10px 16px; border-radius:12px; border:1px solid transparent; font:inherit; font-size:14px; cursor:pointer; transition:.16s; white-space:nowrap}
.pf-primary{background:var(--brown); color:#F6EFE2; box-shadow:0 12px 26px -16px rgba(51,42,34,.9)}
.pf-primary:hover{background:var(--brown-hi)}
.pf-ghost{background:rgba(251,247,239,.7); border-color:var(--line); color:var(--ink)}
.pf-ghost:hover{border-color:var(--gold); background:rgba(201,154,60,.08)}
.pf-danger{background:var(--danger); color:#fff}
.pf-danger:hover{filter:brightness(1.05)}
.pf-icon-btn{flex:0 0 auto; width:32px; height:32px; display:grid; place-items:center; border-radius:9px; border:1px solid var(--line); background:rgba(251,247,239,.7); color:var(--ink); cursor:pointer; transition:.15s}
.pf-icon-btn:hover{border-color:var(--gold); color:var(--gold-deep)}
.pf-icon-danger:hover{border-color:var(--danger); color:var(--danger)}
.pf-row-actions{display:inline-flex; gap:6px; justify-content:flex-end}

/* ny forsaljning */
.pf-sale-grid{display:grid; grid-template-columns:minmax(0,1fr) 420px; gap:20px; align-items:start}
.pf-sale-left{min-width:0}
.pf-lbl{display:block; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin-bottom:6px}
.pf-lines{display:flex; flex-direction:column; gap:12px}
.pf-line{display:grid; grid-template-columns:minmax(120px,1.4fr) 1fr 1fr 44px; grid-template-areas:'pick pick pick pick' 'qty price sum del'; gap:12px; align-items:end; padding-bottom:14px; border-bottom:1px solid var(--line-soft)}
.pf-line:last-child{border-bottom:none; padding-bottom:0}
.pf-line > div{min-width:0}
.pf-line-pick{grid-area:pick} .pf-line-qty{grid-area:qty} .pf-line-price{grid-area:price} .pf-line-sum{grid-area:sum} .pf-line-del{grid-area:del}
.pf-line-static{padding:10px 12px; border-radius:11px; background:rgba(243,235,222,.6); border:1px solid var(--line-soft); font-size:14px; text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.pf-strong{font-weight:600; color:var(--ink)}
.pf-line-del{width:100%; height:40px; display:grid; place-items:center; border-radius:10px; border:1px solid var(--line); background:transparent; color:var(--muted); cursor:pointer; transition:.15s}
.pf-line-del:hover{border-color:var(--danger); color:var(--danger)}
.pf-add{display:inline-flex; align-items:center; gap:8px; margin-top:14px; padding:11px 14px; width:100%; justify-content:center; border-radius:12px; border:1px dashed var(--gold); background:rgba(201,154,60,.07); color:var(--gold-deep); font:inherit; font-size:14px; cursor:pointer; transition:.15s}
.pf-add:hover{background:rgba(201,154,60,.13)}

.pf-input{width:100%; padding:10px 12px; border-radius:11px; border:1px solid var(--line); background:rgba(251,247,239,.8); font:inherit; font-size:14px; color:var(--ink)}
.pf-input:focus{outline:none; border-color:var(--gold); box-shadow:0 0 0 3px rgba(201,154,60,.15)}
.pf-info-grid{display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:14px}

/* stepper */
.pf-stepper{display:flex; align-items:center; border:1px solid var(--line); border-radius:11px; overflow:hidden; background:rgba(251,247,239,.8)}
.pf-stepper button{flex:0 0 auto; width:34px; height:40px; border:none; background:transparent; color:var(--muted); cursor:pointer; display:grid; place-items:center}
.pf-stepper button:hover{color:var(--gold-deep); background:rgba(201,154,60,.1)}
.pf-stepper input{width:100%; min-width:0; border:none; background:transparent; text-align:center; font:inherit; font-size:14px; color:var(--ink)}
.pf-stepper input:focus{outline:none}

/* picker */
.pf-picker{position:relative}
.pf-picker-btn{width:100%; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border-radius:11px; border:1px solid var(--line); background:rgba(251,247,239,.8); font:inherit; font-size:14px; color:var(--ink); cursor:pointer; text-align:left}
.pf-picker-btn span{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.pf-picker-btn:hover{border-color:var(--gold)}
.pf-picker-btn.pf-placeholder{color:var(--muted)}
.pf-picker-btn svg{flex:0 0 auto}
.pf-picker-pop{position:absolute; z-index:40; top:calc(100% + 6px); left:0; right:0; background:var(--raised); border:1px solid var(--line); border-radius:13px; box-shadow:0 24px 50px -24px rgba(60,45,25,.5); overflow:hidden}
.pf-picker-search{display:flex; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line-soft); color:var(--muted)}
.pf-picker-search input{flex:1; min-width:0; border:none; background:transparent; font:inherit; font-size:14px; color:var(--ink)}
.pf-picker-search input:focus{outline:none}
.pf-picker-list{max-height:230px; overflow-y:auto; padding:6px}
.pf-picker-item{width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:9px 10px; border:none; background:transparent; border-radius:9px; font:inherit; font-size:14px; color:var(--ink); cursor:pointer}
.pf-picker-item:hover{background:rgba(201,154,60,.1)}
.pf-picker-item.is-sel{background:rgba(201,154,60,.16)}
.pf-pi-name{overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.pf-pi-price{flex:0 0 auto; font-family:'IBM Plex Mono',monospace; font-size:12.5px; color:var(--muted)}
.pf-picker-empty{padding:16px; text-align:center; color:var(--muted); font-size:13px}

/* summary */
.pf-summary{margin-top:16px; padding:clamp(16px,2vw,20px); border-radius:18px; border:1px solid var(--line); background:linear-gradient(180deg, rgba(201,154,60,.10), rgba(251,247,239,.7)); box-shadow:var(--shadow)}
.pf-summary-row{display:flex; align-items:baseline; justify-content:space-between; gap:12px; padding:5px 0}
.pf-summary-row span:first-child{color:var(--muted); font-size:14px}
.pf-summary-total{font-family:'Cormorant Garamond',serif; font-size:clamp(26px,3.4vw,30px); font-weight:600; color:var(--ink); white-space:nowrap}
.pf-summary-profit{border-top:1px dashed var(--line); margin-top:6px; padding-top:10px; font-size:13.5px}
.pf-summary-profit span:last-child{color:var(--profit); font-weight:500; white-space:nowrap}
.pf-summary-owe{font-size:13.5px; padding-top:2px}
.pf-summary-owe span:last-child{color:var(--owe); font-weight:500; white-space:nowrap}
.pf-price-wrap{display:flex; gap:6px}
.pf-price-input{flex:1; min-width:0; text-align:right}
.pf-full-btn{flex:0 0 auto; padding:0 10px; border-radius:10px; border:1px solid var(--line); background:rgba(251,247,239,.8); color:var(--muted); font:inherit; font-size:12px; font-weight:500; cursor:pointer; transition:.15s}
.pf-full-btn:hover:not(:disabled){border-color:var(--profit); color:var(--profit)}
.pf-full-btn.is-on{background:var(--profit); border-color:var(--profit); color:#fff}
.pf-full-btn:disabled{opacity:.5; cursor:not-allowed}
.pf-summary-actions{display:flex; gap:10px; margin-top:14px; flex-wrap:wrap}
.pf-summary-actions .pf-btn{flex:1 1 160px}

/* preview */
.pf-sale-right{position:sticky; top:24px; min-width:0}
.pf-preview-label{font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:var(--muted); margin-bottom:8px}
.pf-preview{border:1px solid var(--line); border-radius:14px; overflow:hidden; background:#fff; box-shadow:var(--shadow)}
.pf-preview-inner{width:794px; transform-origin:top left}

/* PDF-mall */
.pf-pdf{width:794px; min-height:1123px; background:#ffffff; color:#221D17; padding:64px 60px; font-family:'Jost',sans-serif; box-sizing:border-box}
.pf-pdf-top{display:flex; align-items:flex-start; justify-content:space-between}
.pf-pdf-brand{font-family:'Cormorant Garamond',serif; font-size:40px; font-weight:700; line-height:1; color:#221D17}
.pf-pdf-sub{font-size:12px; letter-spacing:.22em; text-transform:uppercase; color:#8a7d6b; margin-top:6px}
.pf-pdf-meta{text-align:right}
.pf-pdf-doctype{font-family:'Cormorant Garamond',serif; font-size:24px; font-weight:600; color:#221D17}
.pf-pdf-metaline{font-family:'IBM Plex Mono',monospace; font-size:12px; color:#6f6353; margin-top:3px}
.pf-pdf-rule{height:2px; background:#C99A3C; margin:26px 0 22px; width:64px}
.pf-pdf-table{width:100%; border-collapse:collapse; font-size:14px}
.pf-pdf-table th{font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#8a7d6b; font-weight:500; padding:0 0 10px; border-bottom:1px solid #E2D8C7}
.pf-pdf-table td{padding:12px 0; border-bottom:1px solid #EFE7D8; color:#3a3128}
.pf-pdf-table .l{text-align:left}
.pf-pdf-table .r{text-align:right}
.pf-pdf-table .c{text-align:center}
.pf-pdf-dim{color:#a99c88; padding:16px 0}
.pf-pdf-total{display:flex; align-items:baseline; justify-content:space-between; margin-top:22px; padding-top:6px}
.pf-pdf-total span:first-child{font-family:'Cormorant Garamond',serif; font-size:20px; color:#221D17}
.pf-pdf-total span:last-child{font-family:'Cormorant Garamond',serif; font-size:30px; font-weight:700; color:#221D17}
.pf-pdf-pay{display:flex; justify-content:space-between; margin-top:10px; font-size:13px; color:#6f6353; border-top:1px solid #EFE7D8; padding-top:12px}
.pf-pdf-foot{margin-top:56px}
.pf-pdf-thanks{font-family:'Cormorant Garamond',serif; font-size:20px; color:#C99A3C}
.pf-pdf-note{font-size:11px; color:#9a8d79; margin-top:10px; line-height:1.55; max-width:440px}

/* toasts + modal */
.pf-toasts{position:fixed; bottom:22px; right:22px; left:22px; z-index:80; display:flex; flex-direction:column; align-items:flex-end; gap:10px; pointer-events:none}
.pf-toast{pointer-events:auto; display:flex; align-items:center; gap:9px; padding:11px 15px; border-radius:12px; background:var(--brown); color:#F6EFE2; font-size:13.5px; box-shadow:0 18px 40px -20px rgba(51,42,34,.9); max-width:340px}
.pf-toast-warn{background:var(--danger)}
.pf-modal-wrap{position:fixed; inset:0; z-index:90; background:rgba(40,32,22,.34); backdrop-filter:blur(3px); display:grid; place-items:center; padding:20px}
.pf-modal{background:var(--raised); border:1px solid var(--line); border-radius:18px; padding:24px; max-width:400px; width:100%; box-shadow:0 30px 60px -24px rgba(40,32,22,.5)}
.pf-modal h3{font-size:22px; font-weight:600; margin-bottom:8px}
.pf-modal p{margin:0 0 18px; color:var(--muted); font-size:14px; line-height:1.5}
.pf-modal-row{display:flex; gap:10px; justify-content:flex-end}

/* inloggning + splash */
.pf-splash{min-height:100vh; display:grid; place-items:center; background:linear-gradient(160deg,#F3EBDD 0%, #EFE6D6 100%)}
.pf-splash-brand{font-family:'Cormorant Garamond',serif; font-weight:700; font-size:34px; color:var(--ink); opacity:.5}
.pf-login{min-height:100vh; display:grid; place-items:center; padding:24px;
  background:
    radial-gradient(1100px 620px at 82% -8%, #FBF3E6 0%, rgba(251,243,230,0) 60%),
    radial-gradient(900px 560px at 0% 108%, #F6EEDE 0%, rgba(246,238,222,0) 55%),
    linear-gradient(160deg,#F3EBDD 0%, #EFE6D6 100%);
  font-family:'Jost',system-ui,sans-serif; color:var(--ink)}
.pf-login-card{width:100%; max-width:380px; background:linear-gradient(180deg, rgba(251,247,239,.95), rgba(250,244,234,.85)); border:1px solid var(--line); border-radius:20px; padding:clamp(24px,5vw,34px); box-shadow:var(--shadow)}
.pf-login-brand{font-family:'Cormorant Garamond',serif; font-weight:700; font-size:34px; line-height:1}
.pf-login-sub{font-size:11px; letter-spacing:.24em; text-transform:uppercase; color:var(--muted); margin-top:2px}
.pf-login-lead{color:var(--muted); font-size:14px; margin:16px 0 20px}
.pf-login-msg{margin-top:12px; font-size:13px; color:var(--danger); line-height:1.4}
.pf-login-btn{width:100%; margin-top:18px; padding:12px}
.pf-login-switch{width:100%; margin-top:12px; padding:8px; border:none; background:transparent; color:var(--gold-deep); font:inherit; font-size:13px; cursor:pointer}
.pf-login-switch:hover{text-decoration:underline}

/* ==== responsivt: fa, tydliga brytpunkter (grids ar redan flytande via auto-fit) ==== */

/* preview forsvinner nar det blir trangt */
@media (max-width:1080px){
  .pf-sale-grid{grid-template-columns:minmax(0,1fr)}
  .pf-sale-right{display:none}
}

/* sidomeny -> topbar med hamburgermeny */
@media (max-width:860px){
  .pf-app{grid-template-columns:minmax(0,1fr)}
  .pf-side{display:none}
  .pf-topbar{
    display:flex; align-items:center; justify-content:flex-end; gap:8px;
    position:sticky; top:0; z-index:40; padding:8px clamp(12px,3vw,16px);
    background:rgba(239,230,214,.9); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px);
    border-bottom:none;
  }
  .pf-topbar .pf-logo-mark{display:none}
  .pf-menu-btn{
    display:grid; place-items:center; width:42px; height:42px; border-radius:12px;
    border:1px solid var(--line); background:var(--raised); color:var(--ink); cursor:pointer;
  }
  .pf-menu-btn:hover{border-color:var(--gold); color:var(--gold-deep)}
  .pf-menu-overlay{position:fixed; inset:0; z-index:38; background:rgba(40,32,22,.28)}
  .pf-menu-panel{
    position:absolute; z-index:39; top:calc(100% + 8px); right:clamp(12px,3vw,16px);
    min-width:210px; background:var(--raised); border:1px solid var(--line); border-radius:16px;
    box-shadow:0 26px 54px -24px rgba(60,45,25,.5); padding:8px; display:flex; flex-direction:column; gap:2px;
  }
  .pf-menu-item{
    display:flex; align-items:center; gap:12px; padding:13px 14px; border:none; cursor:pointer;
    background:transparent; color:var(--muted); border-radius:11px; font:inherit; font-size:15px; text-align:left;
  }
  .pf-menu-item:hover{background:rgba(201,154,60,.1); color:var(--ink)}
  .pf-menu-item.is-active{background:var(--cream); color:var(--ink); box-shadow:inset 0 0 0 1px var(--line)}
  .pf-line{grid-template-columns:1fr 1fr; grid-template-areas:'pick pick' 'qty price' 'sum del'}
  .pf-line-pick{grid-area:pick} .pf-line-qty{grid-area:qty} .pf-line-price{grid-area:price}
  .pf-line-sum{grid-area:sum} .pf-line-del{grid-area:del}
  /* 16px hindrar mobilen fran att auto-zooma nar man skriver */
  .pf-input, .pf-picker-btn, .pf-picker-search input, .pf-stepper input, .pf-line-static{font-size:16px}
}

@media (max-width:640px){
  .pf-hist-item{grid-template-columns:1fr auto; grid-template-areas:'id act' 'figs figs'; gap:12px}
  .pf-hist-id{grid-area:id} .pf-hist-act{grid-area:act; align-self:start}
  .pf-hist-figs{grid-area:figs; justify-content:space-between; gap:10px}
  .pf-hist-figs > div{text-align:left}
}

@media (prefers-reduced-motion:reduce){*{transition:none !important}}
`;
