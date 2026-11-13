import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import {
  ArrowDownLeft, ArrowLeft, ArrowUpLeft, BarChart3, BookOpenText, Check,
  ChevronLeft, ChevronRight, CircleHelp, Clock3, CloudOff,
  Download, FileText, Filter, LayoutDashboard, Menu,
  Pencil, Plus, Printer, ReceiptText, Search, Settings2, ShieldCheck,
  Trash2, TrendingDown, TrendingUp, Wallet, X,
} from 'lucide-react';
import { listTransactions, saveTransaction, deleteTransaction, getStorageMode } from '@/db/adapter';
import {
  type Transaction, type TransactionDraft, type PaymentMethod,
  summarizeTransactions, formatCurrency,
  exportTransactionsCsv, createReceiptHtml, createInvoiceHtml, createLedgerReportHtml,
} from '@/core/accounting';
import './index.css';

type Page = 'dashboard' | 'transactions' | 'reports' | 'settings';
type TxKind = 'income' | 'expense';
type DraftForm = {
  date: string; description: string; party: string; type: TxKind; amount: string;
  taxRate: string; paymentMethod: PaymentMethod; reference: string; notes: string;
};
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const today = () => localDate(new Date());
const blankDraft = (): DraftForm => ({
  date: today(), description: '', party: '', type: 'income', amount: '',
  taxRate: localStorage.getItem('hisab-tax') || '0', paymentMethod: 'bank',
  reference: '', notes: '',
});
const paymentLabel: Record<PaymentMethod, string> = { cash: 'نقداً', bank: 'تحويل بنكي', card: 'بطاقة', other: 'أخرى' };
const NAV: { href: string; page: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { href: '/', page: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
  { href: '/transactions', page: 'transactions', label: 'الحركات المالية', icon: BookOpenText },
  { href: '/reports', page: 'reports', label: 'التقارير', icon: BarChart3 },
  { href: '/settings', page: 'settings', label: 'الإعدادات', icon: Settings2 },
];
const money = (value: number, currency: string) => formatCurrency(Number(value) || 0, currency);
const dateLabel = (date: string) => new Intl.DateTimeFormat('ar', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(`${date}T12:00:00`));
const monthLabel = (date: Date) => new Intl.DateTimeFormat('ar', { month: 'long', year: 'numeric' }).format(date);

function App() {
  const [location, setLocation] = useLocation();
  const [records, setRecords] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currency, setCurrency] = useState(localStorage.getItem('hisab-currency') || 'LYD');
  const [taxDefault, setTaxDefault] = useState(localStorage.getItem('hisab-tax') || '0');
  const [businessName, setBusinessName] = useState(localStorage.getItem('hisab-business') || '');
  const [taxNumber, setTaxNumber] = useState(localStorage.getItem('hisab-tax-number') || '');
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [draft, setDraft] = useState<DraftForm>(blankDraft);
  const [saving, setSaving] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<Transaction | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [reportMonth, setReportMonth] = useState(new Date());
  const [notice, setNotice] = useState('');
  const page: Page = location === '/transactions' ? 'transactions' : location === '/reports' ? 'reports' : location === '/settings' ? 'settings' : 'dashboard';
  const storageMode = getStorageMode();

  const load = async () => {
    setLoading(true);
    try { setRecords(await listTransactions()); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذّر تحميل السجلات.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { document.documentElement.dir = 'rtl'; document.documentElement.lang = 'ar'; }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const sortedRecords = useMemo(() => [...records].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)), [records]);
  const filteredRecords = useMemo(() => sortedRecords.filter(item => {
    const text = `${item.description} ${item.party} ${item.reference}`.toLocaleLowerCase('ar');
    return (!query || text.includes(query.toLocaleLowerCase('ar')))
      && (kindFilter === 'all' || item.type === kindFilter)
      && (!dateFilter || item.date.startsWith(dateFilter));
  }), [sortedRecords, query, kindFilter, dateFilter]);
  const currentMonthRecords = useMemo(() => records.filter(item => item.date.slice(0, 7) === today().slice(0, 7)), [records]);
  const currentMonthSummary = useMemo(() => summarizeTransactions(currentMonthRecords), [currentMonthRecords]);
  const totalIncome = currentMonthSummary.revenue;
  const totalExpense = currentMonthSummary.expenses;
  const net = currentMonthSummary.net;
  const monthlyData = useMemo(() => {
    const start = new Date(reportMonth.getFullYear(), reportMonth.getMonth(), 1);
    return Array.from({ length: new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate() }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), i + 1);
      const key = localDate(d);
      const dayRecords = records.filter(r => r.date === key);
      return {
        day: new Intl.DateTimeFormat('ar', { day: 'numeric' }).format(d),
        income: dayRecords.filter(r => r.type === 'income').reduce((s, r) => s + Number(r.total), 0),
        expense: dayRecords.filter(r => r.type === 'expense').reduce((s, r) => s + Number(r.total), 0),
      };
    });
  }, [records, reportMonth]);
  function startCreate(type: TxKind = 'income') {
    setEditing(null); setDraft({ ...blankDraft(), type, taxRate: taxDefault }); setShowForm(true);
  }
  function startEdit(transaction: Transaction) {
    setEditing(transaction);
    setDraft({
      date: transaction.date, description: transaction.description, party: transaction.party || '',
      type: transaction.type, amount: String(transaction.amount), taxRate: String(transaction.taxRate),
      paymentMethod: transaction.paymentMethod || 'bank', reference: transaction.reference || '', notes: transaction.notes || '',
    });
    setShowForm(true);
  }
  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(draft.amount);
    if (!draft.description.trim() || !Number.isFinite(amount) || amount <= 0) return;
    setSaving(true);
    try {
      const input = {
        ...(editing ? { id: editing.id } : {}),
        date: draft.date, description: draft.description.trim(), party: draft.party.trim(),
        type: draft.type, amount, taxRate: Number(draft.taxRate) || 0,
        paymentMethod: draft.paymentMethod, reference: draft.reference.trim(), notes: draft.notes.trim(),
      };
      const saved = await saveTransaction(input as TransactionDraft);
      setRecords(previous => editing
        ? previous.map(item => item.id === saved.id ? saved : item)
        : [saved, ...previous]);
      setError('');
      setShowForm(false); setNotice(editing ? 'تم تحديث الحركة المالية.' : 'تم حفظ الحركة المالية.');
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذّر حفظ الحركة.'); }
    finally { setSaving(false); }
  }
  async function removeTransaction(item: Transaction) {
    if (!window.confirm(`هل تريد حذف حركة «${item.description}»؟ لا يمكن التراجع عن هذا الإجراء.`)) return;
    try { await deleteTransaction(item.id); setRecords(prev => prev.filter(row => row.id !== item.id)); setNotice('تم حذف الحركة.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذّر حذف الحركة.'); }
  }
  function openReceipt(item: Transaction) {
    setSelectedReceipt(item);
    setLocation(`/transactions?receipt=${encodeURIComponent(item.id)}`);
  }
  function printReceipt(item: Transaction) {
    const html = createReceiptHtml(item, currency);
    printDocument(html);
  }
  function printInvoice(item: Transaction) {
    try {
      printDocument(createInvoiceHtml(item, currency, businessName, taxNumber));
    } catch (e) {
      setSelectedReceipt(null);
      setError(e instanceof Error ? e.message : 'تعذّر إنشاء الفاتورة.');
      setLocation('/settings');
    }
  }
  function printLedger() {
    printDocument(createLedgerReportHtml(filteredRecords, currency));
    setNotice('استخدم خيار حفظ بصيغة PDF في نافذة الطباعة.');
  }
  function printDocument(html: string) {
    const popup = window.open('', '_blank', 'width=900,height=900');
    if (!popup) { setNotice('يرجى السماح بفتح النوافذ للطباعة أو حفظ الملف بصيغة PDF.'); return; }
    popup.document.open(); popup.document.write(html); popup.document.close();
    window.setTimeout(() => { popup.focus(); popup.print(); }, 250);
  }
  function exportCsv() {
    const csv = exportTransactionsCsv(filteredRecords);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href = href; anchor.download = `hisab-${today()}.csv`; anchor.click();
    URL.revokeObjectURL(href); setNotice('تم تجهيز ملف الحركات للتنزيل.');
  }
  function saveSettings() {
    localStorage.setItem('hisab-currency', currency); localStorage.setItem('hisab-tax', taxDefault);
    localStorage.setItem('hisab-business', businessName.trim()); localStorage.setItem('hisab-tax-number', taxNumber.trim());
    setError('');
    setNotice('تم حفظ تفضيلاتك على هذا الجهاز.');
  }
  function changePage(path: string) { setLocation(path); setMobileMenu(false); setSelectedReceipt(null); }

  return (
    <div className="app-shell flex bg-background text-foreground">
      <aside className={`fixed inset-y-0 right-0 z-40 flex w-[258px] flex-col bg-sidebar px-5 py-6 text-sidebar-foreground transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0 ${mobileMenu ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center gap-3 px-2">
          <div className="grid size-11 place-items-center rounded-2xl bg-sidebar-primary text-sidebar-primary-foreground"><span className="text-xl font-bold">ح</span></div>
          <div><div className="text-[21px] font-bold leading-tight">حساب</div><div className="mt-1 text-[10px] tracking-[.2em] text-sidebar-foreground/55">HISAB · دفتر أعمالك</div></div>
        </div>
        <div className="mt-11 px-3 text-[10px] font-semibold tracking-[.17em] text-sidebar-foreground/40">مساحة العمل</div>
        <nav className="mt-3 flex flex-col gap-1" aria-label="القائمة الرئيسية">
          {NAV.map(({ href, page: navPage, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => changePage(href)} data-testid={`link-nav-${navPage}`} className={`sidebar-link flex items-center gap-3 rounded-xl px-3.5 py-3 text-[13px] font-medium ${page === navPage ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{page === navPage && <span className="mr-auto size-1.5 rounded-full bg-sidebar-primary" />}
            </Link>
          ))}
        </nav>
        <div className="mt-auto rounded-2xl border border-sidebar-border bg-sidebar-accent/55 p-4">
          <div className="flex items-center gap-2 text-[12px] font-semibold"><ShieldCheck size={15} className="text-sidebar-primary" /> بياناتك محفوظة محلياً</div>
          <p className="mb-0 mt-2 text-[11px] leading-6 text-sidebar-foreground/60">حساب يعمل دون اتصال. سجلاتك تبقى على هذا الجهاز.</p>
          <div className="mt-3 flex items-center gap-2 text-[10px] text-sidebar-foreground/45"><CloudOff size={13} /> {storageMode === 'desktop-sqlite' ? 'قاعدة بيانات سطح المكتب' : 'تخزين المتصفح'}</div>
        </div>
        <div className="mt-4 flex items-center gap-3 px-2 py-2">
          <div className="grid size-9 place-items-center rounded-full border border-sidebar-border bg-sidebar-accent text-xs font-semibold text-sidebar-primary">ح</div>
          <div><div className="text-xs font-semibold">دفترك المحلي</div><div className="mt-0.5 text-[10px] text-sidebar-foreground/50">وضع غير متصل</div></div>
          <CircleHelp size={16} className="mr-auto text-sidebar-foreground/45" />
        </div>
      </aside>
      {mobileMenu && <button className="fixed inset-0 z-30 bg-[#0c211d]/35 lg:hidden" aria-label="إغلاق القائمة" onClick={() => setMobileMenu(false)} />}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 flex h-[70px] items-center justify-between border-b border-border/80 bg-background/95 px-4 backdrop-blur md:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileMenu(true)} aria-label="فتح القائمة" className="grid size-9 place-items-center rounded-lg border border-border lg:hidden"><Menu size={18} /></button>
            <div className="hidden text-xs text-muted-foreground sm:block">دفتر أعمالك <span className="mx-2 text-border">/</span></div>
            <div className="text-[13px] font-semibold">{NAV.find(n => n.page === page)?.label}</div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden items-center gap-2 rounded-full border border-[#d9e5da] bg-[#edf4ed] px-3 py-1.5 text-[10px] font-medium text-[#41694e] sm:flex"><span className="size-1.5 rounded-full bg-[#6a9b70]" /> يعمل دون اتصال</div>
            <button onClick={() => startCreate('income')} className="flex h-9 items-center gap-2 rounded-xl bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-90" data-testid="button-new-transaction"><Plus size={16} /> <span className="hidden sm:inline">حركة جديدة</span><span className="sm:hidden">إضافة</span></button>
          </div>
        </header>
        <main className="mx-auto max-w-[1450px] px-4 pb-24 pt-7 md:px-8 md:pb-10 md:pt-9">
          {error && <div role="alert" className="mb-5 flex items-center justify-between rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"><span>{error}</span><button onClick={() => { setError(''); void load(); }} className="font-semibold underline">إعادة المحاولة</button></div>}
          {page === 'dashboard' && <Dashboard records={sortedRecords} currentMonthRecords={currentMonthRecords} currency={currency} loading={loading} totalIncome={totalIncome} totalExpense={totalExpense} net={net} onCreate={startCreate} onReceipt={openReceipt} onGo={changePage} />}
          {page === 'transactions' && <Ledger records={filteredRecords} allCount={records.length} currency={currency} loading={loading} query={query} kindFilter={kindFilter} dateFilter={dateFilter} setQuery={setQuery} setKindFilter={setKindFilter} setDateFilter={setDateFilter} onCreate={startCreate} onEdit={startEdit} onDelete={removeTransaction} onReceipt={openReceipt} onExport={exportCsv} onPrint={printLedger} />}
          {page === 'reports' && <Reports records={records} currency={currency} loading={loading} reportMonth={reportMonth} setReportMonth={setReportMonth} monthlyData={monthlyData} onExport={exportCsv} onPrint={printLedger} />}
          {page === 'settings' && <Settings currency={currency} setCurrency={setCurrency} taxDefault={taxDefault} setTaxDefault={setTaxDefault} businessName={businessName} setBusinessName={setBusinessName} taxNumber={taxNumber} setTaxNumber={setTaxNumber} onSave={saveSettings} storageMode={storageMode} count={records.length} />}
        </main>
        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-card/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur lg:hidden" aria-label="تنقل الهاتف">
          {NAV.map(({ href, page: navPage, label, icon: Icon }) => <Link href={href} key={href} onClick={() => changePage(href)} data-testid={`mobile-nav-${navPage}`} className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 text-[9px] ${page === navPage ? 'text-primary' : 'text-muted-foreground'}`}><Icon size={18} /><span>{label}</span></Link>)}
        </nav>
      </div>
      {showForm && <TransactionDialog draft={draft} setDraft={setDraft} editing={editing} saving={saving} currency={currency} onClose={() => setShowForm(false)} onSubmit={submitDraft} />}
      {selectedReceipt && <ReceiptDialog transaction={selectedReceipt} currency={currency} onClose={() => { setSelectedReceipt(null); if (location.includes('receipt=')) setLocation('/transactions'); }} onPrint={() => printReceipt(selectedReceipt)} onPrintInvoice={() => printInvoice(selectedReceipt)} />}
      {notice && <div role="status" className="fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-xl bg-[#173d34] px-4 py-3 text-xs text-white shadow-xl md:bottom-6"><Check size={15} className="text-[#b6d0a6]" />{notice}</div>}
    </div>
  );
}

function SectionHeading({ eyebrow, title, subtitle, action }: { eyebrow?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div>{eyebrow && <div className="mb-2 text-[10px] font-semibold tracking-[.18em] text-[#8b7859]">{eyebrow}</div>}<h1 className="m-0 text-[25px] font-semibold tracking-[-.04em] md:text-[30px]">{title}</h1>{subtitle && <p className="mb-0 mt-2 text-xs leading-6 text-muted-foreground">{subtitle}</p>}</div>{action}</div>;
}
function Dashboard({ records, currentMonthRecords, currency, loading, totalIncome, totalExpense, net, onCreate, onReceipt, onGo }: any) {
  const recent = records.slice(0, 5);
  return <div className="page-enter">
    <SectionHeading eyebrow="ملخص مالي · نظرة سريعة" title="أهلاً بك في حساب" subtitle="كل حركة واضحة، وكل رقم في مكانه." action={<div className="text-left"><div className="text-[10px] text-muted-foreground">الفترة الحالية</div><div className="mt-1 text-xs font-semibold">{monthLabel(new Date())}</div></div>} />
    <section className="relative overflow-hidden rounded-[22px] bg-[#183e34] px-5 py-6 text-[#f4f1e8] md:px-8 md:py-7">
      <div className="pointer-events-none absolute -left-10 -top-24 size-72 rounded-full border border-white/10" /><div className="pointer-events-none absolute -left-2 -top-16 size-56 rounded-full border border-white/10" />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div><div className="flex items-center gap-2 text-[11px] text-[#c5d2c7]"><Wallet size={15} /> صافي الحركة هذا الشهر</div>
          <div className="mt-3 flex items-baseline gap-2"><span className="font-mono text-[34px] font-medium tracking-[-.06em] md:text-[43px]" dir="ltr">{money(net, currency)}</span><span className="text-xs text-[#bdcfc1]">{currency}</span></div>
          <div className="mt-2 flex items-center gap-2 text-[10px] text-[#c5d2c7]"><span className={`flex items-center gap-1 ${net < 0 ? 'text-[#edb2a7]' : 'text-[#bdd4a7]'}`}>{net < 0 ? <TrendingDown size={13} /> : <TrendingUp size={13} />}{net < 0 ? 'صافي سالب' : 'صافي موجب'}</span><span>من {currentMonthRecords.length} حركة مسجلة</span></div>
        </div>
        <button onClick={() => onCreate('income')} className="flex items-center gap-2 rounded-xl bg-[#e6d3a5] px-4 py-2.5 text-xs font-semibold text-[#193a32] hover:bg-[#eedeb8]" data-testid="button-add-income"><Plus size={15} /> سجّل حركة</button>
      </div>
      <div className="relative mt-7 grid grid-cols-2 gap-3 border-t border-white/15 pt-5 md:max-w-[550px]">
        <div><div className="text-[10px] text-[#c5d2c7]">إجمالي الإيرادات</div><div className="mt-1.5 font-mono text-lg" dir="ltr">{money(totalIncome, currency)}</div></div>
        <div className="border-r border-white/15 pr-4"><div className="text-[10px] text-[#c5d2c7]">إجمالي المصروفات</div><div className="mt-1.5 font-mono text-lg" dir="ltr">{money(totalExpense, currency)}</div></div>
      </div>
    </section>
    <div className="mb-4 mt-8 flex items-center justify-between"><h2 className="m-0 text-[15px] font-semibold">آخر الحركات</h2><button onClick={() => onGo('/transactions')} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline" data-testid="button-view-ledger">عرض السجل <ArrowLeft size={13} /></button></div>
    {loading ? <SkeletonRows /> : recent.length ? <div className="overflow-hidden rounded-2xl border border-border bg-card">
      {recent.map((item: Transaction, index: number) => <TransactionRow key={item.id} item={item} currency={currency} onReceipt={onReceipt} compact last={index === recent.length - 1} />)}
    </div> : <EmptyState onCreate={() => onCreate('income')} />}
    <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-[#efece2] px-5 py-4">
      <div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-card text-[#567363]"><ShieldCheck size={17} /></div><div><div className="text-xs font-semibold">خصوصيتك جزء من الحساب</div><div className="mt-1 text-[10px] text-muted-foreground">سجلاتك محفوظة على جهازك، وتبقى متاحة دون اتصال.</div></div></div>
       <span className="rounded-full border border-[#d8d9ca] px-2.5 py-1 text-[9px] text-[#637568]">على جهازك فقط</span>
    </div>
  </div>;
}
function SkeletonRows() {
  return <div className="overflow-hidden rounded-2xl border border-border bg-card p-4">{[0, 1, 2, 3].map(i => <div key={i} className="flex animate-pulse items-center gap-3 border-b border-border/70 py-4 last:border-0"><div className="size-9 rounded-xl bg-muted" /><div className="flex-1"><div className="h-3 w-28 rounded bg-muted" /><div className="mt-2 h-2 w-16 rounded bg-muted" /></div><div className="h-3 w-20 rounded bg-muted" /></div>)}</div>;
}
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return <div className="soft-grid flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#d6d2c5] bg-card px-6 py-10 text-center">
    <div className="grid size-14 place-items-center rounded-[18px] bg-[#e9eee5] text-[#496b58]"><ReceiptText size={23} strokeWidth={1.6} /></div>
    <h3 className="mb-0 mt-4 text-sm font-semibold">دفترك جاهز لأول حركة</h3>
    <p className="mb-4 mt-2 max-w-[280px] text-[11px] leading-6 text-muted-foreground">أضف إيراداً أو مصروفاً لتبدأ متابعة أعمالك. بياناتك تبقى على هذا الجهاز.</p>
    <button onClick={onCreate} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground" data-testid="button-first-transaction"><Plus size={15} /> أضف أول حركة</button>
  </div>;
}
function TransactionRow({ item, currency, onReceipt, compact = false, last = false, onEdit, onDelete }: any) {
  const income = item.type === 'income';
  return <div className={`group flex items-center gap-3 px-4 py-3.5 transition hover:bg-muted/40 md:px-5 ${!last ? 'border-b border-border/70' : ''}`} data-testid={`row-transaction-${item.id}`}>
    <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${income ? 'bg-[#e8f0e7] text-[#4f795a]' : 'bg-[#f3e9df] text-[#a76947]'}`}>{income ? <ArrowDownLeft size={17} /> : <ArrowUpLeft size={17} />}</div>
    <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{item.description}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{item.party || 'بدون جهة'} <span className="mx-1.5">·</span>{dateLabel(item.date)}</div></div>
    <div className="hidden min-w-20 text-center sm:block"><span className={`rounded-full px-2 py-1 text-[9px] ${income ? 'bg-[#e8f0e7] text-[#4f795a]' : 'bg-[#f3e9df] text-[#a76947]'}`}>{income ? 'إيراد' : 'مصروف'}</span></div>
    <div className="min-w-[90px] text-left"><div className={`font-mono text-[12px] font-semibold ${income ? 'text-[#476f51]' : 'text-[#a46145]'}`} dir="ltr">{income ? '+' : '−'}{money(item.total, currency)}</div>{!compact && <div className="mt-1 text-[9px] text-muted-foreground">{paymentLabel[item.paymentMethod as PaymentMethod] || '—'}</div>}</div>
    <div className="relative flex items-center gap-1">
      <button title="عرض الإيصال" aria-label="عرض الإيصال" onClick={() => onReceipt(item)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><ReceiptText size={15} /></button>
      {onEdit && <button title="تعديل" aria-label="تعديل الحركة" onClick={() => onEdit(item)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil size={14} /></button>}
      {onDelete && <button title="حذف" aria-label="حذف الحركة" onClick={() => onDelete(item)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 size={14} /></button>}
    </div>
  </div>;
}
function Ledger({ records, allCount, currency, loading, query, kindFilter, dateFilter, setQuery, setKindFilter, setDateFilter, onCreate, onEdit, onDelete, onReceipt, onExport, onPrint }: any) {
  return <div className="page-enter">
    <SectionHeading eyebrow="دفتر القيود" title="الحركات المالية" subtitle={`${allCount} حركة في سجلك المحلي`} action={<div className="flex flex-wrap gap-2"><button onClick={onExport} className="flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-semibold hover:bg-muted" data-testid="button-export-ledger"><Download size={14} /> تصدير CSV</button><button onClick={onPrint} className="flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-semibold hover:bg-muted" data-testid="button-export-ledger-pdf"><Printer size={14} /> حفظ PDF</button><button onClick={() => onCreate('income')} className="flex h-9 items-center gap-2 rounded-xl bg-primary px-3 text-[11px] font-semibold text-primary-foreground" data-testid="button-ledger-add"><Plus size={15} /> حركة جديدة</button></div>} />
    <div className="mb-4 flex flex-wrap gap-2.5 rounded-2xl border border-border bg-card p-3">
      <label className="flex h-9 min-w-[190px] flex-1 items-center gap-2 rounded-lg border border-border/80 bg-background px-3"><Search size={15} className="text-muted-foreground" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="ابحث بالوصف أو الجهة..." className="w-full bg-transparent text-[11px] outline-none placeholder:text-muted-foreground/65" data-testid="input-ledger-search" /></label>
      <label className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-background px-3"><Filter size={14} className="text-muted-foreground" /><select value={kindFilter} onChange={e => setKindFilter(e.target.value)} className="bg-transparent text-[11px] outline-none" data-testid="select-kind-filter"><option value="all">كل الأنواع</option><option value="income">الإيرادات</option><option value="expense">المصروفات</option></select></label>
      <label className="flex h-9 items-center gap-2 rounded-lg border border-border/80 bg-background px-3"><Clock3 size={14} className="text-muted-foreground" /><input type="month" value={dateFilter} onChange={e => setDateFilter(e.target.value)} className="max-w-[126px] bg-transparent text-[10px] outline-none" aria-label="تصفية حسب الشهر" data-testid="input-date-filter" /></label>
    </div>
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="hidden grid-cols-[1fr_115px_110px_120px_112px] items-center gap-3 border-b border-border bg-[#f2f0e8] px-5 py-3 text-[9px] font-semibold text-muted-foreground md:grid"><span>البيان</span><span className="text-center">النوع</span><span>التاريخ</span><span className="text-left">المبلغ</span><span /></div>
      {loading ? <SkeletonRows /> : records.length ? records.map((item: Transaction, i: number) => <TransactionRow key={item.id} item={item} currency={currency} onReceipt={onReceipt} onEdit={onEdit} onDelete={onDelete} last={i === records.length - 1} />) :
        <div className="flex min-h-[230px] flex-col items-center justify-center px-5 text-center"><div className="grid size-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Search size={20} /></div><div className="mt-3 text-sm font-semibold">{allCount ? 'لا توجد نتائج مطابقة' : 'لا توجد حركات بعد'}</div><p className="mt-1 text-[11px] text-muted-foreground">{allCount ? 'جرّب تغيير كلمات البحث أو عوامل التصفية.' : 'أضف أول حركة مالية ليبدأ السجل بالظهور هنا.'}</p>{!allCount && <button onClick={() => onCreate('income')} className="mt-3 flex items-center gap-1 text-xs font-semibold text-primary"><Plus size={14} /> إضافة حركة</button>}</div>}
    </div>
    <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground"><span>يعرض {records.length} من {allCount} حركة</span><span className="flex items-center gap-1"><CloudOff size={12} /> محفوظ محلياً</span></div>
  </div>;
}
function Reports({ records, currency, loading, reportMonth, setReportMonth, monthlyData, onExport, onPrint }: any) {
  const monthRecords = records.filter((item: Transaction) => item.date.startsWith(`${reportMonth.getFullYear()}-${String(reportMonth.getMonth() + 1).padStart(2, '0')}`));
  const periodSummary = summarizeTransactions(monthRecords);
  const income = periodSummary.revenue;
  const expense = periodSummary.expenses;
  const taxTotal = periodSummary.taxCollected + periodSummary.taxPaid;
  const net = periodSummary.net;
  return <div className="page-enter">
    <SectionHeading eyebrow="قراءة أوضح لأرقامك" title="التقارير" subtitle="ملخص دوري مبني على الحركات المسجلة على جهازك." action={<div className="flex flex-wrap gap-2"><button onClick={onExport} className="flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-semibold hover:bg-muted" data-testid="button-report-export"><Download size={14} /> تصدير CSV</button><button onClick={onPrint} className="flex h-9 items-center gap-2 rounded-xl border border-border bg-card px-3 text-[11px] font-semibold hover:bg-muted" data-testid="button-report-pdf"><Printer size={14} /> حفظ PDF</button></div>} />
    <div className="mb-5 flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
      <button onClick={() => setReportMonth(new Date(reportMonth.getFullYear(), reportMonth.getMonth() - 1, 1))} className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label="الشهر السابق"><ChevronRight size={17} /></button>
      <div className="text-sm font-semibold">{monthLabel(reportMonth)}</div>
      <button onClick={() => setReportMonth(new Date(reportMonth.getFullYear(), reportMonth.getMonth() + 1, 1))} className="grid size-8 place-items-center rounded-lg hover:bg-muted" aria-label="الشهر التالي"><ChevronLeft size={17} /></button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <ReportMetric label="الإيرادات" value={income} currency={currency} tone="green" icon={<TrendingUp size={16} />} />
      <ReportMetric label="المصروفات" value={expense} currency={currency} tone="rose" icon={<TrendingDown size={16} />} />
      <ReportMetric label="صافي الحركة" value={net} currency={currency} tone="sand" icon={<Wallet size={16} />} />
      <ReportMetric label="الضريبة المسجلة" value={taxTotal} currency={currency} tone="blue" icon={<FileText size={16} />} />
    </div>
    <section className="mt-5 rounded-2xl border border-border bg-card p-4 md:p-6">
      <div className="mb-5 flex items-start justify-between"><div><h2 className="m-0 text-sm font-semibold">الحركة اليومية</h2><p className="mb-0 mt-1.5 text-[10px] text-muted-foreground">مقارنة الإيرادات والمصروفات · {monthLabel(reportMonth)}</p></div><div className="flex gap-4 text-[10px]"><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#4b7c63]" />إيراد</span><span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-[#d4a47b]" />مصروف</span></div></div>
      {loading ? <div className="h-[260px] animate-pulse rounded-xl bg-muted" /> : monthRecords.length ? <div className="overflow-x-auto" dir="ltr"><div className="flex h-[230px] min-w-[650px] items-end gap-[3px] border-b border-border px-2 pb-1">{monthlyData.map((day: any, i: number) => { const max = Math.max(1, ...monthlyData.flatMap((d: any) => [d.income, d.expense])); const h1 = day.income ? Math.max(2, day.income / max * 175) : 0; const h2 = day.expense ? Math.max(2, day.expense / max * 175) : 0; const show = i % 3 === 0 || i === monthlyData.length - 1; return <div key={i} className="flex h-full min-w-0 flex-1 flex-col justify-end"><div className="flex h-[180px] items-end justify-center gap-[2px]">{h1 > 0 && <div title={`إيراد ${day.day}`} className="w-[42%] rounded-t-[3px] bg-[#4b7c63]" style={{ height: `${h1}px` }} />}{h2 > 0 && <div title={`مصروف ${day.day}`} className="w-[42%] rounded-t-[3px] bg-[#d4a47b]" style={{ height: `${h2}px` }} />}</div><span className={`h-5 pt-2 text-center text-[8px] text-muted-foreground ${show ? '' : 'invisible'}`}>{day.day}</span></div>; })}</div></div> : <div className="grid min-h-[230px] place-items-center text-center"><div><div className="mx-auto grid size-11 place-items-center rounded-2xl bg-muted text-muted-foreground"><BarChart3 size={20} /></div><p className="mb-0 mt-3 text-xs font-semibold">لا توجد حركة في هذه الفترة</p><p className="mb-0 mt-1 text-[10px] text-muted-foreground">ستظهر المقارنة هنا بعد تسجيل الحركات.</p></div></div>}
    </section>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-[#eeece3] p-4"><div className="flex items-center gap-2.5"><div className="grid size-8 place-items-center rounded-lg bg-card text-[#667e6b]"><ReceiptText size={15} /></div><div><div className="text-xs font-semibold">تقرير قابل للاستخدام خارج حساب</div><div className="mt-1 text-[10px] text-muted-foreground">نزّل بيانات السجل بصيغة CSV لفتحها في جدول بيانات.</div></div></div><button onClick={onExport} className="rounded-lg border border-border bg-card px-3 py-2 text-[10px] font-semibold hover:bg-muted">تنزيل البيانات</button></div>
  </div>;
}
function ReportMetric({ label, value, currency, tone, icon }: any) {
  const colors: Record<string, string> = { green: 'bg-[#e8f0e7] text-[#4f795a]', rose: 'bg-[#f3e9df] text-[#a76947]', sand: 'bg-[#eee9da] text-[#847044]', blue: 'bg-[#e7edef] text-[#537481]' };
  return <div className="rounded-2xl border border-border bg-card p-4"><div className="flex items-center justify-between"><span className="text-[10px] text-muted-foreground">{label}</span><span className={`grid size-8 place-items-center rounded-xl ${colors[tone]}`}>{icon}</span></div><div className="mt-3 font-mono text-lg font-semibold" dir="ltr">{money(value, currency)}</div><div className="mt-1 text-[9px] text-muted-foreground">{currency}</div></div>;
}
function Settings({ currency, setCurrency, taxDefault, setTaxDefault, businessName, setBusinessName, taxNumber, setTaxNumber, onSave, storageMode, count }: any) {
  return <div className="page-enter">
    <SectionHeading eyebrow="مساحة عملك" title="الإعدادات" subtitle="تفضيلات بسيطة لتناسب طريقة عملك." />
    <div className="grid max-w-[900px] gap-5 lg:grid-cols-[1fr_300px]">
      <section className="rounded-2xl border border-border bg-card p-5 md:p-7">
        <div className="mb-6 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-[#e9eee5] text-[#4c7258]"><Settings2 size={18} /></div><div><h2 className="m-0 text-sm font-semibold">التفضيلات المالية</h2><p className="mb-0 mt-1 text-[10px] text-muted-foreground">تُستخدم هذه القيم في عرض السجلات والحركات الجديدة.</p></div></div>
        <div className="space-y-5">
           <label className="block"><span className="mb-2 block text-xs font-semibold">اسم المنشأة</span><span className="block text-[10px] text-muted-foreground">يظهر في الفواتير التي تنشئها.</span><input value={businessName} onChange={e => setBusinessName(e.target.value)} placeholder="اسم نشاطك التجاري" className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring/30" data-testid="input-business-name" /></label>
           <label className="block"><span className="mb-2 block text-xs font-semibold">الرقم الضريبي</span><span className="block text-[10px] text-muted-foreground">اختياري، ويظهر في الفاتورة عند إدخاله.</span><input value={taxNumber} onChange={e => setTaxNumber(e.target.value)} placeholder="اختياري" className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring/30" data-testid="input-tax-number" /></label>
           <label className="block"><span className="mb-2 block text-xs font-semibold">العملة الافتراضية</span><span className="block text-[10px] text-muted-foreground">تؤثر على طريقة عرض المبالغ في التطبيق.</span><select value={currency} onChange={e => setCurrency(e.target.value)} className="mt-2 h-11 w-full rounded-xl border border-input bg-background px-3 text-xs outline-none focus:ring-2 focus:ring-ring/30" data-testid="select-currency"><option value="LYD">دينار ليبي · LYD</option><option value="SAR">ريال سعودي · SAR</option><option value="AED">درهم إماراتي · AED</option><option value="KWD">دينار كويتي · KWD</option><option value="QAR">ريال قطري · QAR</option><option value="BHD">دينار بحريني · BHD</option><option value="OMR">ريال عُماني · OMR</option><option value="EGP">جنيه مصري · EGP</option><option value="JOD">دينار أردني · JOD</option><option value="USD">دولار أمريكي · USD</option><option value="EUR">يورو · EUR</option></select></label>
          <label className="block"><span className="mb-2 block text-xs font-semibold">نسبة الضريبة الافتراضية</span><span className="block text-[10px] text-muted-foreground">يمكن تعديلها في كل حركة بشكل مستقل.</span><span className="relative mt-2 block"><input type="number" min="0" max="100" step="0.01" value={taxDefault} onChange={e => setTaxDefault(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 pl-10 text-xs outline-none focus:ring-2 focus:ring-ring/30" data-testid="input-default-tax" /><span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span></span></label>
        </div>
        <div className="mt-7 flex justify-end border-t border-border pt-5"><button onClick={onSave} className="rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90" data-testid="button-save-settings">حفظ التفضيلات</button></div>
      </section>
      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck size={16} className="text-[#52745c]" /> تخزينك المحلي</div><p className="mb-0 mt-2 text-[10px] leading-6 text-muted-foreground">حساب لا يرسل بياناتك إلى خادم. تظل معلوماتك محفوظة على هذا الجهاز وتعمل دون اتصال.</p><div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-[10px]"><span className="text-muted-foreground">نوع التخزين</span><span className="font-medium">{storageMode === 'desktop-sqlite' ? 'قاعدة بيانات محلية' : 'تخزين المتصفح'}</span></div><div className="mt-2 flex items-center justify-between text-[10px]"><span className="text-muted-foreground">الحركات المحفوظة</span><span className="font-mono font-medium">{count}</span></div></section>
        <section className="rounded-2xl border border-[#d9d6ca] bg-[#efede5] p-5"><div className="flex items-center gap-2 text-xs font-semibold"><CloudOff size={15} /> يعمل دون اتصال</div><p className="mb-0 mt-2 text-[10px] leading-6 text-muted-foreground">لا تحتاج إلى اتصال بالإنترنت للوصول إلى سجلاتك أو إضافة حركة جديدة.</p></section>
      </div>
    </div>
  </div>;
}
function TransactionDialog({ draft, setDraft, editing, saving, currency, onClose, onSubmit }: any) {
  const amount = Number(draft.amount) || 0; const tax = amount * (Number(draft.taxRate) || 0) / 100;
  const change = (key: keyof DraftForm, value: string) => setDraft((prev: DraftForm) => ({ ...prev, [key]: value }));
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[#14251f]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <form onSubmit={onSubmit} className="max-h-[94dvh] w-full overflow-y-auto rounded-t-[24px] border border-border bg-background px-5 pb-6 pt-5 shadow-2xl sm:max-w-[570px] sm:rounded-[24px] sm:p-7" data-testid="form-transaction">
      <div className="mb-5 flex items-start justify-between"><div><div className="text-[10px] font-semibold tracking-[.14em] text-[#8b7859]">{editing ? 'تعديل في السجل' : 'إضافة إلى السجل'}</div><h2 className="mb-0 mt-1.5 text-xl font-semibold">{editing ? 'تعديل الحركة' : 'حركة مالية جديدة'}</h2></div><button type="button" onClick={onClose} aria-label="إغلاق" className="grid size-9 place-items-center rounded-xl border border-border hover:bg-muted"><X size={17} /></button></div>
      <div className="mb-5 grid grid-cols-2 rounded-xl bg-muted p-1"><button type="button" onClick={() => change('type', 'income')} className={`rounded-lg py-2.5 text-xs font-semibold ${draft.type === 'income' ? 'bg-card text-[#4e7859] shadow-sm' : 'text-muted-foreground'}`} data-testid="button-type-income">إيراد</button><button type="button" onClick={() => change('type', 'expense')} className={`rounded-lg py-2.5 text-xs font-semibold ${draft.type === 'expense' ? 'bg-card text-[#a76947] shadow-sm' : 'text-muted-foreground'}`} data-testid="button-type-expense">مصروف</button></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="وصف الحركة *" className="sm:col-span-2"><input required value={draft.description} onChange={e => change('description', e.target.value)} placeholder={draft.type === 'income' ? 'مثال: دفعة مشروع التصميم' : 'مثال: اشتراك أدوات العمل'} className="field-input" autoFocus data-testid="input-description" /></Field>
        <Field label="المبلغ قبل الضريبة *"><div className="relative"><input required type="number" min="0.01" step="0.01" value={draft.amount} onChange={e => change('amount', e.target.value)} placeholder="0.00" className="field-input pl-14 font-mono" dir="ltr" data-testid="input-amount" /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{currency}</span></div></Field>
        <Field label="التاريخ"><input type="date" required value={draft.date} onChange={e => change('date', e.target.value)} className="field-input" data-testid="input-transaction-date" /></Field>
        <Field label="الجهة / العميل"><input value={draft.party} onChange={e => change('party', e.target.value)} placeholder="اسم العميل أو المورد" className="field-input" data-testid="input-party" /></Field>
         <Field label="طريقة الدفع"><select value={draft.paymentMethod} onChange={e => change('paymentMethod', e.target.value)} className="field-input" data-testid="select-payment-method"><option value="bank">تحويل بنكي</option><option value="cash">نقداً</option><option value="card">بطاقة</option><option value="other">أخرى</option></select></Field>
        <Field label="نسبة الضريبة"><div className="relative"><input type="number" min="0" max="100" step="0.01" value={draft.taxRate} onChange={e => change('taxRate', e.target.value)} className="field-input pl-10 font-mono" dir="ltr" data-testid="input-tax-rate" /><span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">%</span></div></Field>
        <Field label="رقم مرجعي"><input value={draft.reference} onChange={e => change('reference', e.target.value)} placeholder="اختياري" className="field-input" data-testid="input-reference" /></Field>
        <Field label="ملاحظات" className="sm:col-span-2"><textarea value={draft.notes} onChange={e => change('notes', e.target.value)} placeholder="أضف تفاصيل تساعدك لاحقاً..." rows={2} className="field-input min-h-[68px] resize-y py-2.5" data-testid="input-notes" /></Field>
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-[#eceee6] px-4 py-3 text-[11px]"><span className="text-muted-foreground">الإجمالي شامل الضريبة</span><span className="font-mono text-sm font-semibold" dir="ltr">{money(Math.round((amount + tax + Number.EPSILON) * 100) / 100, currency)}</span></div>
      <div className="mt-5 flex gap-2"><button type="submit" disabled={saving} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-submit-transaction">{saving ? 'جارٍ الحفظ...' : editing ? 'حفظ التعديلات' : 'حفظ الحركة'} {!saving && <Check size={15} />}</button><button type="button" onClick={onClose} className="h-11 rounded-xl border border-border px-4 text-xs font-semibold hover:bg-muted">إلغاء</button></div>
    </form>
    <style>{`.field-input{width:100%;height:42px;border:1px solid hsl(var(--input));border-radius:11px;background:hsl(var(--background));padding:0 12px;font-size:11px;outline:none}.field-input:focus{box-shadow:0 0 0 3px hsl(var(--ring)/.14);border-color:hsl(var(--ring)/.7)}.field-input::placeholder{color:hsl(var(--muted-foreground)/.65)}`}</style>
  </div>;
}
function Field({ label, children, className = '' }: any) { return <label className={`block ${className}`}><span className="mb-1.5 block text-[10px] font-semibold text-foreground/80">{label}</span>{children}</label>; }
function ReceiptDialog({ transaction, currency, onClose, onPrint, onPrintInvoice }: any) {
  const isIncome = transaction.type === 'income';
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#14251f]/45 p-3 backdrop-blur-[2px]" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="no-print flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2 text-xs font-semibold"><ReceiptText size={16} /> إيصال الحركة</div><button onClick={onClose} aria-label="إغلاق" className="grid size-8 place-items-center rounded-lg hover:bg-muted"><X size={16} /></button></div>
      <div className="printable relative p-6 md:p-8"><div className="absolute left-0 right-0 top-0 h-1 bg-[#294f41]" /><div className="flex items-start justify-between"><div><div className="text-[10px] tracking-[.16em] text-muted-foreground">حساب · HISAB</div><h2 className="mb-0 mt-2 text-xl font-semibold">{isIncome ? 'إيصال استلام' : 'إيصال مصروف'}</h2></div><div className={`rounded-full px-3 py-1 text-[10px] ${isIncome ? 'bg-[#e8f0e7] text-[#4f795a]' : 'bg-[#f3e9df] text-[#a76947]'}`}>{isIncome ? 'إيراد' : 'مصروف'}</div></div>
        <div className="mt-6 rounded-xl bg-muted/65 p-4"><div className="text-[10px] text-muted-foreground">الإجمالي</div><div className="mt-1 font-mono text-2xl font-semibold" dir="ltr">{money(transaction.total, currency)}</div></div>
        <div className="mt-5 divide-y divide-border/80">{[['البيان', transaction.description], ['الجهة', transaction.party || '—'], ['التاريخ', dateLabel(transaction.date)], ['طريقة الدفع', paymentLabel[transaction.paymentMethod as PaymentMethod] || '—'], ['المرجع', transaction.reference || '—']].map(([label, value]) => <div key={label} className="flex justify-between gap-4 py-3 text-[11px]"><span className="text-muted-foreground">{label}</span><span className="text-left font-medium">{value}</span></div>)}</div>
        <div className="mt-3 rounded-xl border border-border p-3"><div className="flex justify-between text-[10px] text-muted-foreground"><span>المبلغ قبل الضريبة</span><span dir="ltr">{money(transaction.amount, currency)}</span></div><div className="mt-2 flex justify-between text-[10px] text-muted-foreground"><span>الضريبة ({transaction.taxRate}%)</span><span dir="ltr">{money(transaction.taxAmount, currency)}</span></div></div>
        <div className="mt-5 text-center text-[9px] text-muted-foreground">تم إنشاء هذا الإيصال من حساب · محفوظ على جهازك</div>
      </div>
      <div className="no-print flex flex-wrap gap-2 border-t border-border px-5 py-4"><button onClick={onPrint} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-xs font-semibold text-primary-foreground" data-testid="button-print-receipt"><Printer size={15} /> طباعة الإيصال</button>{isIncome && <button onClick={onPrintInvoice} className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold hover:bg-muted" data-testid="button-print-invoice"><FileText size={15} /> إنشاء فاتورة</button>}<button onClick={onClose} className="h-10 rounded-xl border border-border px-4 text-xs font-semibold">إغلاق</button></div>
    </div>
  </div>;
}

function NotFound() {
  return <div className="grid min-h-dvh place-items-center bg-background p-6 text-center"><div><div className="font-mono text-5xl font-semibold text-primary">404</div><h1 className="mt-3 text-lg">هذه الصفحة غير موجودة</h1><p className="text-xs text-muted-foreground">تحقق من العنوان أو عد إلى الرئيسية.</p><Link href="/" className="mt-4 inline-flex rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground">العودة للرئيسية</Link></div></div>;
}
function RoutedApp() {
  return <Switch><Route path="/" component={App} /><Route path="/transactions" component={App} /><Route path="/reports" component={App} /><Route path="/settings" component={App} /><Route component={NotFound} /></Switch>;
}
function Root() {
  return <Router><RoutedApp /></Router>;
}
export default Root;
