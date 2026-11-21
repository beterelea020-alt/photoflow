import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Aperture, ArrowDownLeft, ArrowLeft, ArrowRight, ArrowUpLeft, Bell, CalendarDays,
  Camera, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleDollarSign, Clock3, Download, ExternalLink, FileDown, FileUp, Filter, FolderKanban,
  HandCoins, Image, Instagram, LayoutDashboard, ListTodo, Menu, MessageCircle, MessageSquare,
  Moon, MoreHorizontal, Pencil, Plus, Search, Send, Settings, ShieldCheck, Sun, Trash2, TrendingDown, LockKeyhole,
  TrendingUp, UserRound, Users, Wallet, X, Zap, FileSpreadsheet, LogOut } from 'lucide-react';
import { db } from './db/database';
import type { Booking, BookingStatus, Channel, Client, LeadStatus, LocalProfile, MessageTemplate, Project, ProjectStatus, Reminder, ServicePackage, Transaction, TransactionType } from './types';
import { addDays, currency, dateLabel, daysBetween, escapePhoneForWhatsApp, fullDateLabel, initials, isoToday, openWhatsApp, timeLabel } from './lib/utils';
import { DEFAULT_TEMPLATES, TEMPLATE_FIELDS, TPL, buildValues, isEgyptianMobile, parseContactText, renderByKey, renderMessage, shareText, type TemplateKey } from './lib/messages';
import { AdoptScreen, BlockedScreen, LoginScreen, NewPasswordScreen, SetupNeededScreen } from './components/AccountScreens';
import { getSyncStatus, pushProfile, subscribeSync, syncNow } from './db/syncRuntime';
import { cloudConfigured, supabase } from './lib/supabase';
import { useAccessControl, type AccessApi } from './hooks/useAccessControl';
import { BookingPageSettings } from './components/BookingPageSettings';
import { setRequestStatus, startRequests, stopRequests, useBookingRequests, type BookingRequestRow } from './lib/bookingRequests';
import { downloadCsv } from './lib/csv';
import { renderStatement, shareImage } from './lib/receipt';
import { clearAllData, deleteBooking, deleteClient, deleteTransaction, saveTransaction } from './db/actions';
import { createBackup, parseBackupFile, restoreBackup } from './lib/backup';
import { ActivationScreen, PinLockScreen, PinSetupScreen, PinSettings } from './components/SecurityScreens';
import './styles.css';

type Screen = 'dashboard' | 'inbox' | 'bookings' | 'clients' | 'projects' | 'reminders' | 'finance' | 'reports' | 'templates' | 'settings';
type ModalState = { type: 'client' | 'lead' | 'booking' | 'transaction' | 'reminder' | 'booking-detail' | 'client-edit' | 'booking-edit' | 'transaction-edit' | 'reminder-edit' | 'project-edit' | null; id?: number; preset?: { type: TransactionType; bookingId: number; amount?: number }; request?: BookingRequestRow };
type Toast = { title: string; body?: string } | null;

const NAV: { id: Screen; label: string; icon: typeof LayoutDashboard; group: string }[] = [
  { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard, group: 'الرئيسية' },
  { id: 'inbox', label: 'صندوق الرسائل', icon: MessageSquare, group: 'إدارة العمل' },
  { id: 'bookings', label: 'الحجوزات', icon: CalendarDays, group: 'إدارة العمل' },
  { id: 'clients', label: 'العملاء', icon: Users, group: 'إدارة العمل' },
  { id: 'projects', label: 'مشاريع التصوير', icon: FolderKanban, group: 'إدارة العمل' },
  { id: 'reminders', label: 'المتابعات', icon: ListTodo, group: 'إدارة العمل' },
  { id: 'finance', label: 'الحسابات', icon: Wallet, group: 'الأعمال' },
  { id: 'reports', label: 'التقارير', icon: TrendingUp, group: 'الأعمال' },
  { id: 'templates', label: 'الرسائل الجاهزة', icon: MessageCircle, group: 'الأدوات' },
  { id: 'settings', label: 'الإعدادات والنسخ', icon: Settings, group: 'الأدوات' }
];

const PAGE_COPY: Record<Screen, { title: string; subtitle: string }> = {
  dashboard: { title: 'الرئيسية', subtitle: 'صورة واضحة عن شغلك وكل اللي محتاج تتابعه.' },
  inbox: { title: 'صندوق الرسائل', subtitle: 'سجّل طلبات واتساب وإنستجرام وتابع كل عميل من مكان واحد.' },
  bookings: { title: 'الحجوزات', subtitle: 'نظّم مواعيد التصوير وتابع التأكيدات والمدفوعات.' },
  clients: { title: 'العملاء', subtitle: 'كل بيانات عملائك وسجل تعاملاتهم في مكان واحد.' },
  projects: { title: 'مشاريع التصوير', subtitle: 'تابع كل جلسة من يوم التصوير لحد تسليم الصور.' },
  reminders: { title: 'المتابعات والتذكيرات', subtitle: 'رتّب الرسائل والمهام اللي محتاجة منك متابعة.' },
  finance: { title: 'الحسابات', subtitle: 'تابع الإيرادات والمصروفات والمبالغ المستحقة.' },
  reports: { title: 'التقارير', subtitle: 'افهم أداء شغلك واتجاه الإيرادات خلال الفترة.' },
  templates: { title: 'الرسائل الجاهزة', subtitle: 'اكتب رسائلك مرة واستخدمها مع العملاء بسرعة.' },
  settings: { title: 'الإعدادات والنسخ الاحتياطي', subtitle: 'خصص التطبيق واحفظ نسخة من بياناتك المحلية.' }
};

const statusLabel: Record<BookingStatus, string> = { pending: 'بانتظار التأكيد', confirmed: 'مؤكد', completed: 'مكتمل', cancelled: 'ملغي' };
const projectLabel: Record<ProjectStatus, string> = { shooting: 'بانتظار التصوير', editing: 'جاري التعديل', review: 'مراجعة العميل', ready: 'جاهز للتسليم', delivered: 'تم التسليم' };
const leadLabel: Record<string, string> = { new: 'جديد', contacted: 'تم التواصل', interested: 'مهتم', booked: 'تحول لحجز', lost: 'غير مهتم' };

function App() {
  const access = useAccessControl();
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus);
  const requests = useBookingRequests();
  useEffect(() => {
    if (!cloudConfigured || !supabase || access.stage !== 'ready') return;
    startRequests(supabase);
    return () => stopRequests();
  }, [access.stage]);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('photoflow-theme') as 'light' | 'dark') || 'light');
  const [modal, setModal] = useState<ModalState>({ type: null });
  const [toast, setToast] = useState<Toast>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMore, setMobileMore] = useState(false);
  const [selectedDay, setSelectedDay] = useState(isoToday());
  const [inboxFilter, setInboxFilter] = useState<'all' | Channel>('all');
  const [clientFilter, setClientFilter] = useState('all');
  const [calendarMonth, setCalendarMonth] = useState(new Date());
  const [profile, setProfile] = useState<LocalProfile>(() => {
    const emptyProfile: LocalProfile = { name: '', studioName: '', phone: '', currency: 'EGP' };
    try {
      const saved = JSON.parse(localStorage.getItem('photoflow-profile') || 'null');
      if (!saved || (saved.name === 'أحمد المصور' && saved.studioName === 'استوديو أحمد')) return emptyProfile;
      return { ...emptyProfile, ...saved };
    } catch { return emptyProfile; }
  });
  const [installPrompt, setInstallPrompt] = useState<(() => Promise<void>) | null>(null);
  const [isInstalled, setIsInstalled] = useState(() => (window.matchMedia?.('(display-mode: standalone)').matches ?? false) || Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  const data = useLiveQuery(async () => ({
    clients: await db.clients.toArray(),
    bookings: await db.bookings.toArray(),
    projects: await db.projects.toArray(),
    transactions: await db.transactions.toArray(),
    reminders: await db.reminders.toArray(),
    templates: await db.templates.toArray()
  }), [], undefined);

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('photoflow-theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('photoflow-profile', JSON.stringify(profile)); }, [profile]);
  useEffect(() => {
    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      const promptEvent = event as Event & { prompt: () => Promise<void>; userChoice?: Promise<{ outcome: string }> };
      setInstallPrompt(() => promptEvent.prompt.bind(promptEvent));
    };
    const onInstalled = () => { setIsInstalled(true); setInstallPrompt(null); setToast({ title: 'تم تثبيت PhotoFlow', body: 'تقدر تفتح التطبيق من شاشة الموبايل الرئيسية.' }); };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    return () => { window.removeEventListener('beforeinstallprompt', onBeforeInstall); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const due = (await db.reminders.toArray()).filter((item) => !item.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
      const now = Date.now();
      const next = due.find((item) => new Date(item.dueAt).getTime() <= now && !item.notifiedAt);
      if (next?.id) {
        await db.reminders.update(next.id, { notifiedAt: new Date().toISOString() });
        setToast({ title: next.title, body: next.body || 'عندك متابعة مستحقة دلوقتي.' });
      }
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    const offlineHandler = () => setToast({ title: 'PhotoFlow جاهز دون اتصال', body: 'تم تخزين ملفات التطبيق ويمكنك فتحه دون إنترنت.' });
    window.addEventListener('photoflow-offline-ready', offlineHandler);
    return () => window.removeEventListener('photoflow-offline-ready', offlineHandler);
  }, []);

  useEffect(() => {
    if (access.stage !== 'ready') return;
    const idleLimit = 5 * 60 * 1000;
    let lastActivity = Date.now();
    let hiddenAt = 0;
    const touch = () => { lastActivity = Date.now(); };
    const visibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else {
        if (hiddenAt && Date.now() - hiddenAt >= idleLimit) access.lock();
        hiddenAt = 0;
        touch();
      }
    };
    const checkIdle = () => { if (Date.now() - lastActivity >= idleLimit) access.lock(); };
    const timer = window.setInterval(checkIdle, 15000);
    ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((event) => window.addEventListener(event, touch, { passive: true }));
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.clearInterval(timer);
      ['pointerdown', 'keydown', 'touchstart', 'scroll'].forEach((event) => window.removeEventListener(event, touch));
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [access.stage]);

  const clients = data?.clients ?? [];
  const bookings = data?.bookings ?? [];
  const projects = data?.projects ?? [];
  const transactions = data?.transactions ?? [];
  const reminders = data?.reminders ?? [];
  const templates = data?.templates ?? [];
  useEffect(() => {
    if (!data || templates.length) return;
    if (cloudConfigured) {
      // With an account: only after the first sync, so templates that already exist on the server are not duplicated.
      const uid = access.account?.id;
      if (!uid || access.stage !== 'ready' || !sync.lastSyncAt) return;
      if (localStorage.getItem(`pf-seeded:${uid}`)) return;
      localStorage.setItem(`pf-seeded:${uid}`, '1');
    } else {
      if (localStorage.getItem('photoflow-templates-seeded')) return;
      localStorage.setItem('photoflow-templates-seeded', '1');
    }
    void db.templates.bulkAdd(DEFAULT_TEMPLATES as MessageTemplate[]);
  }, [data, templates.length, access.stage, access.account?.id, sync.lastSyncAt]);
  const hydratedFor = useRef('');
  useEffect(() => {
    const acc = access.account;
    if (!cloudConfigured || !acc || hydratedFor.current === acc.id) return;
    hydratedFor.current = acc.id;
    const fromServer: LocalProfile = { name: acc.displayName, studioName: acc.studioName, phone: acc.phone, currency: 'EGP', packages: acc.packages as ServicePackage[] };
    const owner = localStorage.getItem('pf-profile-owner');
    if (owner && owner !== acc.id) setProfile(fromServer);   // another person used this phone before: never mix profiles
    else setProfile((p) => ({ ...p, name: acc.displayName || p.name, studioName: acc.studioName || p.studioName, phone: acc.phone || p.phone, packages: acc.packages.length ? (acc.packages as ServicePackage[]) : p.packages }));
    localStorage.setItem('pf-profile-owner', acc.id);
  }, [access.account]);
  useEffect(() => {
    const acc = access.account;
    if (!cloudConfigured || !supabase || access.stage !== 'ready' || !acc || hydratedFor.current !== acc.id) return;
    const client = supabase;
    const timer = window.setTimeout(() => { void pushProfile(client, acc.id, profile); }, 1500);
    return () => window.clearTimeout(timer);
  }, [profile, access.stage, access.account?.id]);
  const clientMap = useMemo(() => new Map<number, Client>(clients.map((c) => [c.id!, c] as [number, Client])), [clients]);
  const bookingMap = useMemo(() => new Map<number, Booking>(bookings.map((b) => [b.id!, b] as [number, Booking])), [bookings]);
  const dueReminders = reminders.filter((r) => !r.done).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  const totalIncome = transactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const outstanding = bookings.filter((b) => b.status !== 'cancelled').reduce((sum, b) => sum + Math.max(0, b.price - b.deposit), 0);
  const newLeads = clients.filter((c) => (c.leadStatus || 'new') === 'new').length;
  const lastBackupStamp = localStorage.getItem('photoflow-last-backup-at');
  const hasBusinessRecords = clients.length + bookings.length + projects.length + transactions.length > 0;
  const backupReminderDue = !cloudConfigured && hasBusinessRecords && (!lastBackupStamp || Date.now() - new Date(lastBackupStamp).getTime() > 7 * 24 * 60 * 60 * 1000);

  const showToast = (title: string, body?: string) => setToast({ title, body });
  const handleInstall = async () => {
    if (installPrompt) {
      try { await installPrompt(); setInstallPrompt(null); }
      catch { showToast('تعذر بدء التثبيت', 'جرّب اختيار تثبيت التطبيق من قائمة المتصفح.'); }
      return;
    }
    const isAppleMobile = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showToast('تثبيت PhotoFlow على الموبايل', isAppleMobile ? 'افتح قائمة المشاركة في Safari ثم اختر «إضافة إلى الشاشة الرئيسية».' : 'افتح قائمة المتصفح ⋮ ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».');
  };
  const navigate = (next: Screen) => { setScreen(next); setSearch(''); setMobileMore(false); };

  if (access.stage === 'checking') return <div className="app-loading"><div className="loading-mark"><Aperture size={34}/></div><strong>PhotoFlow</strong><span>جارٍ تجهيز التطبيق...</span></div>;
  if (access.stage === 'activation') return <ActivationScreen installId={access.installId} onActivate={access.activate} initialError={access.licenseMessage}/>;
  if (access.stage === 'setup-needed') return <SetupNeededScreen/>;
  if (access.stage === 'login') return <LoginScreen onSignIn={access.signIn} onSignUp={access.signUp} onReset={access.resetPassword}/>;
  if (access.stage === 'recovery') return <NewPasswordScreen onSave={access.setNewPassword}/>;
  if (access.stage === 'adopt') return <AdoptScreen onChoose={access.adoptLocal}/>;
  if (access.stage === 'blocked' && access.blockReason) return <BlockedScreen reason={access.blockReason} email={access.account?.email ?? ''} onRetry={access.retry} onSignOut={async () => { const r = await access.signOut(); if (!r.ok && window.confirm(`فيه ${r.pending} تغيير لسه ماتحفظش على السيرفر. لو سجلت خروج هيضيعوا. تكمل؟`)) await access.signOut(true); }}/>;
  if (access.stage === 'pin-setup') return <PinSetupScreen onSave={access.setupPin}/>;
  if (access.stage === 'locked') return <PinLockScreen onUnlock={access.unlock} onRecover={access.recover}/>;
  if (!data) return <div className="app-loading"><div className="loading-mark"><Aperture size={34}/></div><strong>PhotoFlow</strong><span>بنرتّب لك شغلك...</span></div>;

  const todayItems = buildTodayItems({ requests, bookings, clientMap, projects, reminders: dueReminders, templates, profile, backupDue: backupReminderDue, onNavigate: navigate, open: setModal, onToast: showToast });

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Aperture size={22}/></div>
          <div><strong>PhotoFlow</strong><span>مساعد المصور</span></div>
        </div>
        <div className="profile-mini">
          <div className="avatar avatar-coffee"><Camera size={19}/></div>
          <div className="profile-mini-copy"><strong>{profile.name || 'اسم المصور'}</strong><span>{profile.studioName || 'استوديو التصوير'}</span></div>
          <span className="local-dot" title="بيانات محلية"/>
        </div>
        <nav className="side-nav">
          {['الرئيسية', 'إدارة العمل', 'الأعمال', 'الأدوات'].map((group) => (
            <div className="nav-group" key={group}>
              <span className="nav-caption">{group}</span>
              {NAV.filter((item) => item.group === group).map((item) => {
                const Icon = item.icon;
                return <button key={item.id} className={`nav-link ${screen === item.id ? 'active' : ''}`} onClick={() => navigate(item.id)}>
                  <Icon size={18}/><span>{item.label}</span>
                  {item.id === 'inbox' && <em className="nav-count">{newLeads}</em>}
                </button>;
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-notice"><ShieldCheck size={17}/><span>بياناتك محفوظة على جهازك</span></div>
          <button className="sidebar-help" onClick={() => showToast('نسخة تجريبية محلية', 'لا يوجد ربط تلقائي بمنصات التواصل في هذه النسخة.')}> <Zap size={16}/> <span>عن النسخة الحالية</span><ArrowLeft size={14}/></button>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-title"><span className="eyebrow">مساحة عملك</span><h1>{PAGE_COPY[screen].title}</h1></div>
          <div className="topbar-actions">
            <label className={`global-search ${searchOpen ? 'mobile-open' : ''}`}><Search size={17}/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث في شغلك..."/><kbd>⌘ K</kbd></label>
            <button className="mobile-search-toggle icon-button" onClick={() => setSearchOpen(!searchOpen)} aria-label="بحث"><Search size={18}/></button>
            {!isInstalled && <button className="install-app-button" onClick={() => void handleInstall()}><Download size={15}/><span>تثبيت التطبيق</span></button>}
            <button className="icon-button theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="تغيير المظهر">{theme === 'light' ? <Moon size={18}/> : <Sun size={18}/>}</button>
            <button className="icon-button lock-app-button" onClick={access.lock} aria-label="قفل التطبيق" title="قفل التطبيق"><LockKeyhole size={17}/></button>
            <button className="icon-button notification-button" onClick={() => navigate('reminders')} aria-label="التذكيرات"><Bell size={18}/>{dueReminders.length > 0 && <i/>}</button>
            <button className="top-add" onClick={() => setModal({ type: clients.length ? 'booking' : 'client' })}><Plus size={17}/> {clients.length ? 'حجز جديد' : 'عميل جديد'}</button>
            <button className="mobile-menu-button icon-button" onClick={() => setMobileMore(!mobileMore)} aria-label="المزيد"><MoreHorizontal size={20}/></button>
          </div>
        </header>

        {mobileMore && <div className="mobile-more-panel">{NAV.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => navigate(item.id)}><Icon size={17}/>{item.label}</button>; })}<button onClick={access.lock}><LockKeyhole size={17}/>قفل التطبيق</button></div>}
        <div className="page-content">
          <div className="page-intro"><p>{PAGE_COPY[screen].subtitle}</p><div className="today-chip"><CalendarDays size={15}/>{fullDateLabel(isoToday())}</div></div>

          {screen === 'dashboard' && backupReminderDue && <div className="dashboard-backup-reminder"><div><strong>وقت تحفظ نسخة من شغلك</strong><span>نزّل نسخة احتياطية الآن حتى تقدر تستعيد بياناتك لو غيّرت الموبايل.</span></div><button className="button button-outline button-small" onClick={() => navigate('settings')}>النسخ الاحتياطي</button></div>}

          {screen === 'dashboard' && <Dashboard clients={clients} bookings={bookings} projects={projects} reminders={dueReminders} transactions={transactions} clientMap={clientMap} todayItems={todayItems} profile={profile} onNavigate={navigate} hasClients={clients.length > 0} onAdd={() => setModal({ type: clients.length ? 'booking' : 'client' })} onDetail={(id) => setModal({ type: 'booking-detail', id })}/>} 
          {screen === 'inbox' && <><BookingRequestsCard requests={requests} clients={clients} templates={templates} profile={profile} open={setModal}/><Inbox clients={clients} bookings={bookings} search={search} filter={inboxFilter} setFilter={setInboxFilter} onAdd={() => setModal({ type: 'lead' })} onConvert={(client) => setModal({ type: 'booking', id: client.id })} onEdit={(id) => setModal({ type: 'client-edit', id })} onToast={showToast}/></>}
          {screen === 'bookings' && <Bookings bookings={bookings} clients={clientMap} search={search} selectedDay={selectedDay} setSelectedDay={setSelectedDay} month={calendarMonth} setMonth={setCalendarMonth} hasClients={clients.length > 0} onAdd={() => setModal({ type: clients.length ? 'booking' : 'client' })} onDetail={(id) => setModal({ type: 'booking-detail', id })}/>}
          {screen === 'clients' && <Clients clients={clients} bookings={bookings} search={search} filter={clientFilter} setFilter={setClientFilter} onAdd={() => setModal({ type: 'client' })} onBook={(id) => setModal({ type: 'booking', id })} onEdit={(id) => setModal({ type: 'client-edit', id })} onToast={showToast}/>}
          {screen === 'projects' && <Projects projects={projects} bookings={bookingMap} clients={clientMap} search={search} onEdit={(id) => setModal({ type: 'project-edit', id })} onToast={showToast}/>}
          {screen === 'reminders' && <Reminders reminders={reminders} clients={clientMap} bookings={bookingMap} onAdd={() => setModal({ type: 'reminder' })} onEdit={(id) => setModal({ type: 'reminder-edit', id })} onToast={showToast}/>}
          {screen === 'finance' && <Finance transactions={transactions} bookings={bookings} clients={clientMap} projects={projects} templates={templates} profile={profile} outstanding={outstanding} open={setModal} onToast={showToast}/>}
          {screen === 'reports' && <Reports transactions={transactions} bookings={bookings} projects={projects} totalIncome={totalIncome} totalExpense={totalExpense}/>}
          {screen === 'templates' && <Templates templates={templates} profile={profile} clients={clients} bookings={bookings} projects={projects} onToast={showToast}/>}
          {screen === 'settings' && <SettingsPage profile={profile} setProfile={setProfile} theme={theme} setTheme={setTheme} onToast={showToast} onInstall={handleInstall} isInstalled={isInstalled} onLock={access.lock} access={access}/>}
        </div>
        <footer className="app-footer"><div className="footer-product-line"><span>PhotoFlow <b>·</b> تنظيم شغلك، من أول رسالة لحد التسليم</span>{cloudConfigured ? <SyncBadge/> : <span><ShieldCheck size={13}/> يعمل محليًا على هذا الجهاز</span>}</div><div className="footer-copyright">جميع الحقوق محفوظة © 2026 — <a href="https://peter-elia-cv.vercel.app/" target="_blank" rel="noopener noreferrer">Peter Elia</a></div></footer>
      </main>

      <nav className="mobile-bottom-nav">
        {(['dashboard', 'inbox', 'bookings', 'projects', 'finance'] as Screen[]).map((item) => {
          const Icon = NAV.find((n) => n.id === item)!.icon;
          return <button key={item} className={screen === item ? 'active' : ''} onClick={() => navigate(item)}><Icon size={19}/><span>{item === 'dashboard' ? 'الرئيسية' : item === 'inbox' ? 'الرسائل' : item === 'bookings' ? 'الحجوزات' : item === 'projects' ? 'الشغل' : 'الحسابات'}</span></button>;
        })}
        <button onClick={() => setMobileMore(!mobileMore)}><MoreHorizontal size={19}/><span>المزيد</span></button>
      </nav>

      <EntryAlert items={todayItems} onToday={() => navigate('dashboard')}/>
      {modal.type && <ModalHost modal={modal} close={() => setModal({ type: null })} open={setModal} clients={clients} bookings={bookings} projects={projects} transactions={transactions} reminders={reminders} templates={templates} profile={profile} clientMap={clientMap} onToast={showToast}/>}
      {toast && <div className="toast"><div className="toast-icon"><Bell size={17}/></div><div><strong>{toast.title}</strong>{toast.body && <span>{toast.body}</span>}</div><button onClick={() => setToast(null)}><X size={16}/></button></div>}
    </div>
  );
}

function SectionHeader({ title, hint, action, actionLabel }: { title: string; hint?: string; action?: () => void; actionLabel?: string }) {
  return <div className="section-header"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div>{action && <button className="button button-primary button-small" onClick={action}>{/^(كل|إدارة)/.test(actionLabel || '') ? <ArrowLeft size={16}/> : <Plus size={16}/>}{actionLabel || 'إضافة'}</button>}</div>;
}

function StatCard({ label, value, caption, icon: Icon, tone = 'coffee', trend }: { label: string; value: string; caption: string; icon: typeof CalendarDays; tone?: string; trend?: 'up' | 'down' }) {
  return <div className="stat-card"><div className={`stat-icon ${tone}`}><Icon size={19}/></div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><div className="stat-caption">{trend && <span className={trend}><TrendingUp size={13}/></span>}{caption}</div></div>;
}

type TodayItem = { key: string; tone: string; icon: typeof Clock3; title: string; body: string; action: string; run: () => void };
type TodayContext = { requests?: BookingRequestRow[]; bookings: Booking[]; clientMap: Map<number, Client>; projects: Project[]; reminders: Reminder[]; templates: MessageTemplate[]; profile: LocalProfile; backupDue?: boolean; onNavigate: (s: Screen) => void; open: OpenModal; onToast: ToastFn };

/** Everything that needs the photographer's attention right now. Used by the Today card and by the alert shown on every app open. */
function buildTodayItems({ requests = [], bookings, clientMap, projects, reminders, templates, profile, backupDue, onNavigate, open, onToast }: TodayContext): TodayItem[] {
  const today = isoToday();
  const tomorrow = (() => { const d = new Date(`${today}T12:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
  const projectByBooking = new Map(projects.map((p) => [p.bookingId, p] as [number, Project]));
  const send = (key: TemplateKey, booking: Booking) => {
    const client = clientMap.get(booking.clientId);
    if (!client?.phone) { onToast('مفيش رقم هاتف للعميل', 'ضيف الرقم من بيانات العميل الأول.'); return; }
    const { text, missing } = renderByKey(key, templates, { client, booking, project: projectByBooking.get(booking.id!), profile });
    if (missing.length) { onToast('الرسالة ناقصة بيانات', missing.join('، ')); return; }
    openWhatsApp(client.phone, text);
  };
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const items: TodayItem[] = [];
  const used = new Set<number>();
  const nameOf = (b: Booking) => clientMap.get(b.clientId)?.name || 'عميل';

  if (requests.length) items.push({ key: 'requests', tone: 'gold', icon: MessageCircle, title: `${requests.length} طلب حجز جديد من صفحة الحجز`, body: `${requests[0].name} · ${fullDateLabel(requests[0].requested_date)}`, action: 'افتح الطلبات', run: () => onNavigate('inbox') });
  const endOfToday = new Date(); endOfToday.setHours(23, 59, 59, 999);
  const dueReminders = reminders.filter((r) => !r.done && new Date(r.dueAt) <= endOfToday).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
  dueReminders.slice(0, 3).forEach((r) => items.push({ key: `rem-${r.id}`, tone: 'coffee', icon: Bell, title: r.title, body: r.body || 'متابعة مستحقة', action: 'تمت المتابعة', run: () => { void db.reminders.update(r.id!, { done: true }).then(() => onToast('تمت المتابعة', 'اتسجلت كمنتهية.')); } }));
  if (dueReminders.length > 3) items.push({ key: 'rem-more', tone: 'coffee', icon: Bell, title: `و${dueReminders.length - 3} متابعة كمان`, body: 'افتح صفحة المتابعات', action: 'افتح المتابعات', run: () => onNavigate('reminders') });

  active.filter((b) => (b.date === today || b.date === tomorrow) && b.status !== 'completed').sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).forEach((b) => {
    used.add(b.id!);
    items.push({ key: `soon-${b.id}`, tone: 'coffee', icon: CalendarDays, title: `${b.date === today ? 'النهارده' : 'بكرة'} ${timeLabel(b.time)} — ${nameOf(b)}`, body: b.title, action: 'ذكّره بالموعد', run: () => send('reminder', b) });
  });
  active.filter((b) => b.status === 'pending' && b.date >= today && !used.has(b.id!)).sort((a, b) => a.date.localeCompare(b.date)).forEach((b) => {
    const needsDeposit = b.price > 0 && b.deposit === 0;
    items.push({ key: `pending-${b.id}`, tone: 'gold', icon: Clock3, title: `${nameOf(b)} — لسه مش مؤكد`, body: needsDeposit ? `${b.title} · لسه مدفعش عربون` : b.title, action: needsDeposit ? 'اطلب العربون' : 'أكّد الحجز', run: () => send(needsDeposit ? 'deposit' : 'confirm', b) });
  });
  active.filter((b) => b.price > b.deposit && (b.status === 'completed' || b.date < today)).sort((a, b) => a.date.localeCompare(b.date)).forEach((b) => {
    items.push({ key: `balance-${b.id}`, tone: 'rose', icon: HandCoins, title: `${nameOf(b)} — متبقي ${currency(b.price - b.deposit)}`, body: b.title, action: 'اطلب المتبقي', run: () => send('balance', b) });
  });
  projects.filter((p) => p.status === 'ready').forEach((p) => {
    const b = bookings.find((x) => x.id === p.bookingId);
    if (!b || b.status === 'cancelled') return;
    items.push(p.deliveryLink
      ? { key: `ready-${p.id}`, tone: 'green', icon: Camera, title: `${nameOf(b)} — الصور جاهزة`, body: b.title, action: 'ابعت الصور', run: () => send('ready', b) }
      : { key: `link-${p.id}`, tone: 'green', icon: Camera, title: `${nameOf(b)} — الصور جاهزة للتسليم`, body: 'ضيف رابط الصور الأول', action: 'ضيف الرابط', run: () => open({ type: 'project-edit', id: p.id }) });
  });
  if (backupDue) items.push({ key: 'backup', tone: 'gold', icon: ShieldCheck, title: 'خدّ نسخة احتياطية', body: 'عدّى أسبوع من آخر نسخة. بياناتك على الموبايل بس.', action: 'افتح النسخ الاحتياطي', run: () => onNavigate('settings') });
  return items;
}

function TodayActions({ items }: { items: TodayItem[] }) {
  const shown = items.slice(0, 6);
  return <section className="surface-card today-card">
    <SectionHeader title="النهارده" hint={items.length ? `${items.length} حاجة محتاجة منك خطوة` : 'مفيش حاجة معلقة'}/>
    {shown.length ? <div className="today-list">{shown.map((item) => { const Icon = item.icon; return <div className="today-item" key={item.key}><span className={`today-icon ${item.tone}`}><Icon size={19}/></span><div className="today-copy"><strong>{item.title}</strong><small>{item.body}</small></div><button className="button button-primary button-small" onClick={item.run}>{item.action}</button></div>; })}</div> : <EmptyState icon={CheckCheck} title="كله تمام النهارده" body="مفيش مواعيد قريبة أو مبالغ متأخرة محتاجة رسالة."/>}
    {items.length > shown.length && <p className="today-more">وفي {items.length - shown.length} حاجة كمان، خلّص دول الأول.</p>}
  </section>;
}

/** Pops up inside the app every time it is opened (and when you come back after a while) if something needs attention. */
function EntryAlert({ items, onToday }: { items: TodayItem[]; onToday: () => void }) {
  const [visible, setVisible] = useState(false);
  const shownOnce = useRef(false);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const latest = useRef({ count: 0 });
  const pending = items.filter((item) => !handled.has(item.key));
  latest.current.count = items.length;
  useEffect(() => { if (!shownOnce.current && items.length > 0) { shownOnce.current = true; setVisible(true); } }, [items.length]);
  useEffect(() => {
    let hiddenAt = 0;
    const onChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        void (navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void> }).setAppBadge?.(latest.current.count || undefined)?.catch(() => undefined);
      } else {
        void (navigator as Navigator & { clearAppBadge?: () => Promise<void> }).clearAppBadge?.()?.catch(() => undefined);
        if (hiddenAt && Date.now() - hiddenAt > 15 * 60 * 1000 && latest.current.count > 0) { setHandled(new Set()); setVisible(true); }
        hiddenAt = 0;
      }
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);
  if (!visible || !pending.length) return null;
  const close = () => setVisible(false);
  return <ModalFrame title="محتاج منك خطوة" subtitle={`${pending.length} حاجة محتاجة انتباهك دلوقتي`} close={close}>
    <div className="today-list">{pending.slice(0, 5).map((item) => { const Icon = item.icon; return <div className="today-item" key={item.key}><span className={`today-icon ${item.tone}`}><Icon size={19}/></span><div className="today-copy"><strong>{item.title}</strong><small>{item.body}</small></div><button className="button button-primary button-small" onClick={() => { item.run(); setHandled((prev) => new Set(prev).add(item.key)); }}>{item.action}</button></div>; })}</div>
    {pending.length > 5 && <p className="today-more">وفي {pending.length - 5} حاجة كمان في «النهارده».</p>}
    <div className="modal-actions"><button className="button button-quiet" onClick={close}>بعدين</button><button className="button button-outline" onClick={() => { close(); onToday(); }}>افتح النهارده</button></div>
  </ModalFrame>;
}

function Dashboard({ clients, bookings, projects, reminders, transactions, clientMap, todayItems, profile, onNavigate, hasClients, onAdd, onDetail }: { todayItems: TodayItem[]; profile: LocalProfile; clients: Client[]; bookings: Booking[]; projects: Project[]; reminders: Reminder[]; transactions: Transaction[]; clientMap: Map<number, Client>; onNavigate: (s: Screen) => void; hasClients: boolean; onAdd: () => void; onDetail: (id: number) => void }) {
  const today = isoToday();
  const nextBookings = bookings.filter((b) => b.date >= today && b.status !== 'cancelled').sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)).slice(0, 4);
  const income = transactions.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = transactions.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const due = bookings.filter((b) => b.status !== 'cancelled').reduce((s, b) => s + Math.max(0, b.price - b.deposit), 0);
  const monthBookings = bookings.filter((b) => b.date.slice(0, 7) === today.slice(0, 7) && b.status !== 'cancelled').length;
  const maxDay = Math.max(1, ...Array.from({ length: 7 }, (_, i) => bookings.filter((b) => new Date(b.date + 'T12:00:00').getDay() === i).length));
  return <>
    {!profile.name.trim() && !profile.studioName.trim() && <section className="surface-card setup-card"><div><strong>كمّل بياناتك الأول</strong><p>اسمك واسم الاستوديو بيظهروا في رسايل العملاء وكشوف الحساب.</p></div><button className="button button-primary button-small" onClick={() => onNavigate('settings')}><ArrowLeft size={16}/> افتح الإعدادات</button></section>}
    {bookings.length > 0 && <TodayActions items={todayItems}/>}
    {bookings.length === 0 && <div className="welcome-banner"><div className="welcome-copy"><span className="welcome-kicker">مساحة تصويرك، بشكل أهدى</span><h2>كل تفاصيل شغلك<br/><em>في مكان واحد.</em></h2><p>تابع عملاءك، رتّب جلساتك، واعرف فلوسك رايحة فين.</p><div className="welcome-actions"><button className="button button-light" onClick={onAdd}><Plus size={16}/> {hasClients ? 'أضف حجزًا جديدًا' : 'أضف أول عميل'}</button><button className="button button-ghost-light" onClick={() => onNavigate('inbox')}>افتح صندوق الرسائل <ArrowLeft size={15}/></button></div></div><div className="welcome-art"><div className="art-circle circle-one"/><div className="art-circle circle-two"/><div className="camera-illustration"><Camera size={58}/><span className="camera-lens"/></div><div className="floating-tag tag-top"><CheckCircle2 size={15}/> يومك منظم</div><div className="floating-tag tag-bottom"><Aperture size={15}/> PhotoFlow</div></div></div>}
    <div className="stats-grid">
      <StatCard label="حجوزات الشهر" value={String(monthBookings).padStart(2, '0')} caption="حجز خلال الشهر الحالي" icon={CalendarDays} tone="coffee"/>
      <StatCard label="عملاء مسجلون" value={String(clients.length).padStart(2, '0')} caption="من كل قنوات التواصل" icon={Users} tone="latte"/>
      <StatCard label="مبالغ مستحقة" value={currency(due)} caption="المتبقي من كل الحجوزات" icon={HandCoins} tone="gold"/>
      <StatCard label="صافي الحركة" value={currency(income - expenses)} caption="الإيرادات بعد المصروفات المسجلة" icon={CircleDollarSign} tone="green" trend="up"/>
    </div>
    <div className="dashboard-grid">
      <section className="surface-card upcoming-card">
        <SectionHeader title="الحجوزات القادمة" hint="خليك جاهز لمواعيدك الجاية" action={() => onNavigate('bookings')} actionLabel="كل الحجوزات"/>
        {nextBookings.length ? <div className="booking-list">{nextBookings.map((booking) => <BookingRow key={booking.id} booking={booking} client={clientMap.get(booking.clientId)} onClick={() => onDetail(booking.id!)}/>)}</div> : <EmptyState icon={CalendarDays} title="مفيش حجوزات جاية" body="ابدأ بإضافة أول جلسة تصوير."/>}
      </section>
      <section className="surface-card activity-card">
        <SectionHeader title="لمحة سريعة" hint="حركة شغلك في أرقام"/>
        <div className="mini-chart-head"><strong>توزيع الحجوزات حسب الأيام</strong><span>حسب بياناتك المسجلة</span></div>
        <div className="mini-bars">{['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map((day, i) => { const count = bookings.filter((b) => new Date(b.date + 'T12:00:00').getDay() === i).length; return <div className="mini-bar-column" key={day}><span className="mini-bar-value">{count}</span><div className="mini-bar-track"><i style={{ height: `${Math.max(8, count / maxDay * 100)}%` }}/></div><small>{day.slice(0, 3)}</small></div>; })}</div>
        <div className="quick-finance"><div><span>إيرادات مسجلة</span><strong>{currency(income)}</strong></div><div><span>مصروفات مسجلة</span><strong>{currency(expenses)}</strong></div></div>
      </section>
      <section className="surface-card reminders-card">
        <SectionHeader title="محتاج متابعة" hint="حاجات متسيبهاش لآخر اليوم" action={() => onNavigate('reminders')} actionLabel="كل المتابعات"/>
        {reminders.length ? <div className="reminder-preview-list">{reminders.slice(0, 3).map((reminder) => <div className="reminder-preview" key={reminder.id}><span className="reminder-clock"><Clock3 size={16}/></span><div><strong>{reminder.title}</strong><small>{new Date(reminder.dueAt).toLocaleString('ar-EG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></div><span className="reminder-dot"/></div>)}</div> : <EmptyState icon={CheckCheck} title="كله تمام" body="مفيش متابعات معلقة دلوقتي."/>}
      </section>
      <section className="surface-card project-summary-card">
        <SectionHeader title="حالة مشاريعك" hint="من جلسة التصوير لحد التسليم" action={() => onNavigate('projects')} actionLabel="إدارة المشاريع"/>
        <div className="project-progress-list">{(['shooting','editing','review','ready','delivered'] as ProjectStatus[]).map((status) => { const count = projects.filter((p) => p.status === status).length; return <div className="project-progress-row" key={status}><span>{projectLabel[status]}</span><div className="progress-track"><i style={{ width: `${projects.length ? count / projects.length * 100 : 0}%` }}/></div><b>{count}</b></div>; })}</div>
      </section>
    </div>
  </>;
}

function BookingRow({ booking, client, onClick }: { booking: Booking; client?: Client; onClick: () => void }) {
  return <button className="booking-row" onClick={onClick}><div className="booking-date-box"><strong>{new Date(booking.date + 'T12:00:00').getDate()}</strong><small>{dateLabel(booking.date, { month: 'short' })}</small></div><div className="booking-row-main"><strong>{booking.title}</strong><span>{client?.name || 'عميل غير معروف'} <b>·</b> {timeLabel(booking.time)} <b>·</b> {booking.location || 'المكان غير محدد'}</span></div><span className={`status-pill ${booking.status}`}>{statusLabel[booking.status]}</span><ChevronLeft size={17} className="row-chevron"/></button>;
}

function Inbox({ clients, bookings, search, filter, setFilter, onAdd, onConvert, onEdit, onToast }: { onEdit: (id: number) => void; clients: Client[]; bookings: Booking[]; search: string; filter: 'all' | Channel; setFilter: (v: 'all' | Channel) => void; onAdd: () => void; onConvert: (client: Client) => void; onToast: (title: string, body?: string) => void }) {
  const [selected, setSelected] = useState<number | null>(clients[0]?.id ?? null);
  const filtered = clients.filter((client) => (filter === 'all' || client.source === filter) && `${client.name} ${client.phone} ${client.notes || ''}`.toLowerCase().includes(search.toLowerCase()));
  const active = filtered.find((c) => c.id === selected) || filtered[0];
  useEffect(() => { if (!filtered.some((c) => c.id === selected)) setSelected(filtered[0]?.id ?? null); }, [filtered, selected]);
  const sourceText = (source: Channel) => source === 'whatsapp' ? 'واتساب' : source === 'instagram' ? 'إنستجرام' : 'إضافة يدوية';
  return <div className="inbox-layout">
    <section className="surface-card inbox-list-card">
      <div className="inbox-list-head"><div><h2>الطلبات والعملاء</h2><p>سجّل أي استفسار جديد هنا يدويًا</p></div><button className="button button-primary button-small" onClick={onAdd}><Plus size={15}/> طلب جديد</button></div>
      <div className="inbox-filters"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>الكل <span>{clients.length}</span></button><button className={filter === 'whatsapp' ? 'active' : ''} onClick={() => setFilter('whatsapp')}><MessageCircle size={14}/> واتساب</button><button className={filter === 'instagram' ? 'active' : ''} onClick={() => setFilter('instagram')}><Instagram size={14}/> إنستجرام</button><button className={filter === 'manual' ? 'active' : ''} onClick={() => setFilter('manual')}>يدوي</button></div>
      <div className="inbox-client-list">{filtered.map((client) => <button key={client.id} className={`inbox-client ${active?.id === client.id ? 'selected' : ''}`} onClick={() => setSelected(client.id!)}><div className="avatar">{initials(client.name)}</div><div className="inbox-client-copy"><strong>{client.name}</strong><span>{client.notes || 'طلب تصوير جديد — راجع بيانات العميل'}</span><small>{sourceText(client.source)}</small></div><span className={`source-mini ${client.source}`}>{client.source === 'whatsapp' ? <MessageCircle size={14}/> : client.source === 'instagram' ? <Instagram size={14}/> : <UserRound size={14}/>}</span></button>)}</div>
      {!filtered.length && <EmptyState icon={MessageSquare} title="مفيش طلبات هنا" body="أضف طلبًا يدويًا أو جرّب تغيير الفلتر."/>}
    </section>
    <section className="surface-card inbox-detail-card">
      {active ? <>
        <div className="conversation-head"><div className="avatar avatar-large">{initials(active.name)}</div><div><strong>{active.name}</strong><span>{active.phone || 'رقم غير مسجل'} · {sourceText(active.source)}</span></div><span className="manual-tag"><span/> مسجل محليًا</span></div>
        <div className="conversation-placeholder"><div className="conversation-icon"><MessageSquare size={25}/></div><strong>سجل متابعة العميل</strong><p>دي مش محادثة مباشرة. استخدم بيانات العميل لفتح واتساب أو إنستجرام، وسجّل ملخص التواصل هنا.</p><div className="local-message-card"><span className="message-time">ملاحظة محفوظة على جهازك</span>{active.notes || 'لا توجد ملاحظات بعد. أضف ملاحظة من ملف العميل.'}</div><label className="lead-status-control">حالة الطلب<select value={active.leadStatus || 'new'} onChange={async (e) => { if(active.id) { await db.clients.update(active.id,{leadStatus:e.target.value as LeadStatus}); onToast('تم تحديث حالة العميل',leadLabel[e.target.value]); } }}><option value="new">جديد</option><option value="contacted">تم التواصل</option><option value="interested">مهتم</option><option value="booked">تحول لحجز</option><option value="lost">غير مهتم</option></select></label></div>
        <div className="conversation-actions"><button className="button button-primary" onClick={() => onConvert(active)}><CalendarDays size={16}/> تحويل إلى حجز</button><button className="button button-outline" onClick={() => onEdit(active.id!)}><Pencil size={16}/> تعديل</button><button className="button button-outline" onClick={() => openWhatsApp(active.phone, `أهلًا ${active.name}، شكرًا لتواصلك معايا 🤎`)}><MessageCircle size={16}/> فتح واتساب</button><button className="button button-quiet" onClick={() => active.instagram ? window.open(`https://www.instagram.com/${active.instagram.replace('@','').replace(/^\//,'')}/`, '_blank', 'noopener,noreferrer') : onToast('لا يوجد حساب إنستجرام', 'سجّل اسم المستخدم في بيانات العميل أولًا.')}><Instagram size={16}/></button></div>
        <div className="integration-hint"><ShieldCheck size={16}/><span>الربط التلقائي واستقبال الرسائل من المنصات غير مفعّل في النسخة دي. تقدر تسجّل الطلبات يدويًا وتفتح المحادثة من هنا.</span></div>
      </> : <EmptyState icon={MessageSquare} title="اختار عميل" body="اختار اسم من القائمة عشان تشوف بياناته وتبدأ تتابعه."/>}
    </section>
  </div>;
}

function Bookings({ bookings, clients, search, selectedDay, setSelectedDay, month, setMonth, hasClients, onAdd, onDetail }: { bookings: Booking[]; clients: Map<number, Client>; search: string; selectedDay: string; setSelectedDay: (v: string) => void; month: Date; setMonth: (v: Date) => void; hasClients: boolean; onAdd: () => void; onDetail: (id: number) => void }) {
  const year = month.getFullYear(); const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const cells = Array.from({ length: firstDay + daysInMonth }, (_, i) => i < firstDay ? null : i - firstDay + 1);
  const filtered = bookings.filter((b) => `${b.title} ${clients.get(b.clientId)?.name || ''} ${b.location || ''}`.toLowerCase().includes(search.toLowerCase()));
  const dayBookings = filtered.filter((b) => b.date === selectedDay).sort((a, b) => a.time.localeCompare(b.time));
  const shiftMonth = (step: number) => setMonth(new Date(year, monthIndex + step, 1));
  const [view, setView] = useState<'month' | 'agenda'>('month');
  const upcoming = filtered.filter((b) => b.date >= isoToday() && b.status !== 'cancelled').sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
  const upcomingDates = Array.from(new Set(upcoming.map((b) => b.date)));
  return <>
    <div className="toolbar-row"><div className="view-switch"><span role="button" tabIndex={0} className={view === 'month' ? 'selected' : ''} onClick={() => setView('month')}>الشهر</span><span role="button" tabIndex={0} className={view === 'agenda' ? 'selected' : ''} onClick={() => setView('agenda')}>الأجندة</span></div><button className="button button-primary" onClick={onAdd}><Plus size={16}/> {hasClients ? 'إضافة حجز' : 'إضافة أول عميل'}</button></div>
    {view === 'agenda' ? <section className="surface-card agenda-upcoming"><SectionHeader title="المواعيد الجاية" hint="مرتبة من الأقرب للأبعد"/>{upcoming.length ? upcomingDates.map((date) => <div key={date}><h3 className="agenda-date">{date === isoToday() ? 'النهارده' : fullDateLabel(date)}</h3><div className="agenda-list">{upcoming.filter((b) => b.date === date).map((b) => <button key={b.id} className="agenda-item" onClick={() => onDetail(b.id!)}><span className="agenda-time">{timeLabel(b.time)}</span><span className="agenda-line"/><div className="agenda-item-content"><strong>{b.title}</strong><span>{clients.get(b.clientId)?.name || 'عميل'} · {b.location || 'المكان غير محدد'}</span><div><b className={`status-pill ${b.status}`}>{statusLabel[b.status]}</b><small>{currency(b.price)}</small></div></div><ChevronLeft size={17}/></button>)}</div></div>) : <EmptyState icon={CalendarDays} title="مفيش مواعيد جاية" body="أضف حجز جديد وهيظهر هنا." action={onAdd} actionLabel={hasClients ? 'أضف حجز' : 'إضافة عميل'}/>}</section> : <div className="calendar-layout">
      <section className="surface-card calendar-card">
        <div className="calendar-heading"><div><h2>{new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(month)}</h2><span>اختار يوم عشان تشوف جدولك</span></div><div className="calendar-arrows"><button onClick={() => shiftMonth(-1)}><ChevronRight size={18}/></button><button onClick={() => shiftMonth(1)}><ChevronLeft size={18}/></button></div></div>
        <div className="calendar-grid calendar-weekdays">{['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'].map((d) => <span key={d}>{d}</span>)}</div>
        <div className="calendar-grid calendar-days">{cells.map((day, index) => {
          if (!day) return <span className="calendar-empty" key={`blank-${index}`}/>;
          const key = `${year}-${String(monthIndex + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const count = bookings.filter((b) => b.date === key && b.status !== 'cancelled').length;
          return <button key={key} className={`calendar-day ${selectedDay === key ? 'selected' : ''} ${key === isoToday() ? 'today' : ''}`} onClick={() => setSelectedDay(key)}><span>{day}</span>{count > 0 && <i className="calendar-dots">{Array.from({ length: Math.min(count, 3) }, (_, i) => <b key={i}/>)}</i>}</button>;
        })}</div>
        <div className="calendar-legend"><span><i className="legend-dot coffee-dot"/> فيه حجز</span><span><i className="legend-dot current-dot"/> النهارده</span></div>
      </section>
      <section className="surface-card day-agenda-card"><div className="agenda-heading"><div><span className="eyebrow">جدول اليوم</span><h2>{fullDateLabel(selectedDay)}</h2></div><span className="agenda-count">{dayBookings.length} مواعيد</span></div>
        {dayBookings.length ? <div className="agenda-list">{dayBookings.map((b) => <button key={b.id} className="agenda-item" onClick={() => onDetail(b.id!)}><span className="agenda-time">{timeLabel(b.time)}</span><span className="agenda-line"/><div className="agenda-item-content"><strong>{b.title}</strong><span>{clients.get(b.clientId)?.name || 'عميل'} · {b.location || 'المكان غير محدد'}</span><div><b className={`status-pill ${b.status}`}>{statusLabel[b.status]}</b><small>{currency(b.price)}</small></div></div><ChevronLeft size={17}/></button>)}</div> : <EmptyState icon={CalendarDays} title={hasClients ? 'اليوم ده فاضي' : 'ابدأ بإضافة عميل'} body={hasClients ? 'مفيش حجوزات مسجلة في اليوم المختار.' : 'سجّل بيانات أول عميل قبل إنشاء الحجز.'} action={onAdd} actionLabel={hasClients ? 'أضف حجز' : 'إضافة عميل'}/>}
      </section>
    </div>}
    <section className="surface-card compact-bookings-table"><SectionHeader title="كل الحجوزات" hint="آخر الحجوزات المسجلة عندك"/><div className="simple-table"><div className="table-row table-head"><span>العميل / الجلسة</span><span>التاريخ</span><span>القيمة</span><span>الحالة</span><span/></div>{filtered.sort((a,b)=>`${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0,8).map((b) => <button className="table-row" key={b.id} onClick={() => onDetail(b.id!)}><span><strong>{b.title}</strong><small>{clients.get(b.clientId)?.name}</small></span><span>{dateLabel(b.date)} · {timeLabel(b.time)}</span><b>{currency(b.price)}</b><span className={`status-pill ${b.status}`}>{statusLabel[b.status]}</span><ChevronLeft size={16}/></button>)}</div></section>
  </>;
}

function Clients({ clients, bookings, search, filter, setFilter, onAdd, onBook, onEdit, onToast }: { onEdit: (id: number) => void; clients: Client[]; bookings: Booking[]; search: string; filter: string; setFilter: (v: string) => void; onAdd: () => void; onBook: (id: number) => void; onToast: (title: string, body?: string) => void }) {
  const filtered = clients.filter((c) => (filter === 'all' || c.source === filter) && `${c.name} ${c.phone} ${c.instagram || ''} ${c.notes || ''}`.toLowerCase().includes(search.toLowerCase()));
  return <>
    <div className="toolbar-row"><div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>الكل <span>{clients.length}</span></button><button className={filter === 'whatsapp' ? 'active' : ''} onClick={() => setFilter('whatsapp')}>واتساب</button><button className={filter === 'instagram' ? 'active' : ''} onClick={() => setFilter('instagram')}>إنستجرام</button><button className={filter === 'manual' ? 'active' : ''} onClick={() => setFilter('manual')}>يدوي</button></div><button className="button button-primary" onClick={onAdd}><Plus size={16}/> عميل جديد</button></div>
    <div className="client-grid">{filtered.map((client) => { const count = bookings.filter((b) => b.clientId === client.id).length; const spent = bookings.filter((b) => b.clientId === client.id && b.status !== 'cancelled').reduce((s, b) => s + b.price, 0); const owed = bookings.filter((b) => b.clientId === client.id && b.status !== 'cancelled').reduce((s, b) => s + Math.max(0, b.price - b.deposit), 0); return <article className="surface-card client-card" key={client.id}><div className="client-card-top"><div className="avatar avatar-large">{initials(client.name)}</div><span className={`source-label ${client.source}`}>{client.source === 'whatsapp' ? <MessageCircle size={13}/> : client.source === 'instagram' ? <Instagram size={13}/> : <UserRound size={13}/>} {client.source === 'whatsapp' ? 'واتساب' : client.source === 'instagram' ? 'إنستجرام' : 'يدوي'}</span><button className="more-button" onClick={() => onEdit(client.id!)} aria-label="تعديل العميل"><Pencil size={17}/></button></div><h3>{client.name}</h3><span className="client-phone">{client.phone || 'لا يوجد رقم مسجل'}</span>{client.notes && <p className="client-note">{client.notes}</p>}<div className="client-metrics"><div><strong>{count}</strong><span>حجوزات</span></div><div><strong>{currency(spent)}</strong><span>قيمة الشغل</span></div><div><strong className={owed ? 'amount-negative' : ''}>{currency(owed)}</strong><span>متبقي</span></div></div><div className="client-card-actions"><button className="button button-primary button-small" onClick={() => onBook(client.id!)}><CalendarDays size={14}/> حجز جديد</button><button className="button button-outline button-small" onClick={() => openWhatsApp(client.phone)}><MessageCircle size={14}/> واتساب</button></div></article>; })}</div>
    {!filtered.length && <div className="surface-card"><EmptyState icon={Users} title="لسه مفيش عملاء" body="أضف أول عميل وابدأ تنظيم تعاملاتك." action={onAdd} actionLabel="إضافة عميل"/></div>}
  </>;
}

function Projects({ projects, bookings, clients, search, onEdit, onToast }: { onEdit: (id: number) => void; projects: Project[]; bookings: Map<number, Booking>; clients: Map<number, Client>; search: string; onToast: (title: string, body?: string) => void }) {
  const columns: ProjectStatus[] = ['shooting','editing','review','ready','delivered'];
  const move = async (project: Project, direction: -1 | 1) => { const idx = columns.indexOf(project.status); const next = columns[Math.max(0, Math.min(columns.length - 1, idx + direction))]; if (project.id && next !== project.status) { await db.projects.update(project.id, { status: next, updatedAt: new Date().toISOString() }); onToast('تم تحديث المشروع', `الحالة الجديدة: ${projectLabel[next]}`); } };
  const filtered = projects.filter((p) => { const b = bookings.get(p.bookingId); return `${b?.title || ''} ${clients.get(b?.clientId || 0)?.name || ''}`.toLowerCase().includes(search.toLowerCase()); });
  return <>
    <div className="project-top-note"><FolderKanban size={17}/><span>كل مشروع مرتبط بحجز. غيّر الحالة من البطاقة، وسجّل رابط المعرض عند الجاهزية.</span></div>
    <div className="kanban-board">{columns.map((status) => <section className="kanban-column" key={status}><div className="kanban-column-head"><div><i className={`kanban-dot ${status}`}/><strong>{projectLabel[status]}</strong></div><span>{filtered.filter((p) => p.status === status).length}</span></div><div className="kanban-cards">{filtered.filter((p) => p.status === status).map((project) => { const booking = bookings.get(project.bookingId); const client = booking ? clients.get(booking.clientId) : undefined; return <article className="project-card" key={project.id}><div className="project-card-type"><span>{booking?.type || 'جلسة تصوير'}</span><button className="more-button" onClick={() => onEdit(project.id!)} aria-label="تفاصيل المشروع"><Pencil size={15}/></button></div><h3>{booking?.title || 'مشروع بدون حجز'}</h3><p><UserRound size={13}/>{client?.name || 'عميل'}</p><div className="project-card-meta"><span><CalendarDays size={13}/>{booking ? dateLabel(booking.date) : '—'}</span><span><Image size={13}/>{project.shotCount || 0} صورة</span></div>{project.deliveryLink && <a className="delivery-link" href={project.deliveryLink} target="_blank" rel="noreferrer"><ExternalLink size={13}/> رابط التسليم</a>}<div className="project-card-actions"><button onClick={() => move(project, -1)} disabled={columns.indexOf(status) === 0}><ArrowRight size={14}/> السابق</button><button onClick={() => move(project, 1)} disabled={columns.indexOf(status) === columns.length - 1}>التالي <ArrowLeft size={14}/></button></div></article>; })}{filtered.filter((p) => p.status === status).length === 0 && <div className="kanban-empty">لا توجد مشاريع</div>}</div></section>)}</div>
    {!projects.length && <div className="surface-card"><EmptyState icon={FolderKanban} title="مفيش مشاريع لسه" body="المشروع بيتعمل تلقائيًا لما تضيف حجز جديد."/></div>}
  </>;
}

function Reminders({ reminders, clients, bookings, onAdd, onEdit, onToast }: { onEdit: (id: number) => void; reminders: Reminder[]; clients: Map<number, Client>; bookings: Map<number, Booking>; onAdd: () => void; onToast: (title: string, body?: string) => void }) {
  const open = reminders.filter((r) => !r.done).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
  const completed = reminders.filter((r) => r.done).sort((a,b)=>b.dueAt.localeCompare(a.dueAt));
  const finish = async (id: number) => { await db.reminders.update(id, { done: true }); onToast('تم إغلاق المتابعة', 'اتسجلت كمهمة مكتملة على جهازك.'); };
  return <>
    <div className="toolbar-row"><div className="reminder-count-summary"><div><strong>{open.length}</strong><span>متابعة مفتوحة</span></div><div><strong>{completed.length}</strong><span>تمت</span></div></div><button className="button button-primary" onClick={onAdd}><Plus size={16}/> تذكير جديد</button></div>
    <div className="reminder-page-grid"><section className="surface-card"><SectionHeader title="المتابعات القادمة" hint="المهام اللي لسه محتاجة منك إجراء"/>{open.length ? <div className="full-reminders-list">{open.map((r) => { const booking = r.bookingId ? bookings.get(r.bookingId) : undefined; const client = r.clientId ? clients.get(r.clientId) : undefined; const late = new Date(r.dueAt).getTime() < Date.now(); return <div className="full-reminder" key={r.id}><button className="task-check" onClick={() => finish(r.id!)}><Check size={15}/></button><div className="full-reminder-copy" role="button" tabIndex={0} onClick={() => onEdit(r.id!)}><strong>{r.title}</strong><p>{r.body || 'لا توجد تفاصيل إضافية'}</p><span>{client?.name || booking?.title || 'متابعة عامة'} · {new Date(r.dueAt).toLocaleString('ar-EG', { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span></div><span className={`due-tag ${late ? 'late' : ''}`}>{late ? 'متأخر' : 'مجدول'}</span></div>; })}</div> : <EmptyState icon={CheckCheck} title="مفيش متابعات معلقة" body="أضف تذكير جديد لما يكون عندك حاجة محتاجة متابعة." action={onAdd} actionLabel="إضافة تذكير"/>}</section>
      <aside className="surface-card reminder-info"><div className="reminder-info-icon"><Bell size={24}/></div><h3>خلي بالك من مواعيدك</h3><p>تابع المهام القريبة ومواعيد التواصل من نفس الشاشة.</p><div className="reminder-rule"><Clock3 size={16}/><span>التطبيق بيراجع التذكيرات كل 30 ثانية أثناء تشغيله.</span></div><div className="reminder-rule"><ShieldCheck size={16}/><span>النسخة الحالية تعرض التنبيهات داخل التطبيق فقط أثناء تشغيله، ولا ترسل إشعارات نظام أو تنبيهات بعد الإغلاق.</span></div></aside></div>
    {completed.length > 0 && <section className="surface-card completed-reminders"><SectionHeader title="متابعات مكتملة" hint="آخر المهام اللي خلصتها"/>{completed.slice(0,5).map((r) => <div className="completed-row" key={r.id}><CheckCircle2 size={16}/><span>{r.title}</span><small>{dateLabel(r.dueAt.slice(0,10))}</small></div>)}</section>}
  </>;
}

function Finance({ transactions, bookings, clients, projects, templates, profile, outstanding, open, onToast }: { transactions: Transaction[]; bookings: Booking[]; clients: Map<number, Client>; projects: Project[]; templates: MessageTemplate[]; profile: LocalProfile; outstanding: number; open: OpenModal; onToast: ToastFn }) {
  const [month, setMonth] = useState(isoToday().slice(0, 7));
  const [year, monthNumber] = month.split('-').map(Number);
  const shift = (step: number) => { const d = new Date(year, monthNumber - 1 + step, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const monthLabel = new Intl.DateTimeFormat('ar-EG', { month: 'long', year: 'numeric' }).format(new Date(year, monthNumber - 1, 1));
  const inMonth = transactions.filter((t) => t.date.startsWith(month)).sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0));
  const income = inMonth.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expenses = inMonth.filter((t) => t.type === 'expense');
  const expenseTotal = expenses.reduce((s, t) => s + t.amount, 0);
  const monthBookings = bookings.filter((b) => b.date.startsWith(month) && b.status !== 'cancelled');
  const dueBookings = bookings.filter((b) => b.status !== 'cancelled' && b.price > b.deposit).sort((a, b) => a.date.localeCompare(b.date));
  const projectByBooking = new Map(projects.map((p) => [p.bookingId, p] as [number, Project]));
  const bookingProfit = (b: Booking) => b.deposit - transactions.filter((t) => t.type === 'expense' && t.bookingId === b.id).reduce((s, t) => s + t.amount, 0);

  const remind = (b: Booking) => {
    const client = clients.get(b.clientId);
    if (!client?.phone) { onToast('مفيش رقم هاتف للعميل', 'ضيف الرقم من بيانات العميل الأول.'); return; }
    const { text, missing } = renderByKey('balance', templates, { client, booking: b, project: projectByBooking.get(b.id!), profile });
    if (missing.length) { onToast('الرسالة ناقصة بيانات', missing.join('، ')); return; }
    openWhatsApp(client.phone, text);
  };
  const shareSummary = () => {
    const studio = (profile.studioName || profile.name).trim();
    void shareText([`📊 ملخص ${monthLabel}${studio ? ` — ${studio}` : ''}`, `الإيرادات: ${currency(income)}`, `المصروفات: ${currency(expenseTotal)}`, `الصافي: ${currency(income - expenseTotal)}`, `عدد الحجوزات: ${new Intl.NumberFormat('ar-EG').format(monthBookings.length)}`, `مستحق عند العملاء: ${currency(outstanding)}`].join('\n'));
  };
  const shareSummaryImage = async () => {
    try {
      const blob = await renderStatement({ studio: (profile.studioName || profile.name).trim(), title: `ملخص ${monthLabel}`, rows: [{ label: 'الإيرادات', value: currency(income), tone: 'plus' }, { label: 'المصروفات', value: currency(expenseTotal), tone: 'minus' }, { label: 'عدد الحجوزات', value: new Intl.NumberFormat('ar-EG').format(monthBookings.length) }, { label: 'مستحق عند العملاء', value: currency(outstanding) }], totals: [{ label: 'صافي الشهر', value: currency(income - expenseTotal), tone: income - expenseTotal >= 0 ? 'plus' : 'minus' }], footer: 'تم إنشاؤه بواسطة PhotoFlow' });
      const result = await shareImage(blob, `ملخص-${month}.png`, `ملخص ${monthLabel}`);
      if (result === 'downloaded') onToast('تم تحميل صورة الملخص', 'الصورة اتحفظت على الموبايل.');
    } catch { onToast('تعذر إنشاء الصورة', 'جرّب تاني.'); }
  };
  const profitRows = [...bookings].filter((b) => b.status !== 'cancelled').sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`)).slice(0, 8);
  return <>
    <div className="finance-head-actions"><div><div className="month-switch"><button onClick={() => shift(-1)} aria-label="الشهر اللي قبله"><ChevronRight size={18}/></button><strong>{monthLabel}</strong><button onClick={() => shift(1)} aria-label="الشهر اللي بعده"><ChevronLeft size={18}/></button></div><span>صافي الشهر</span><strong>{currency(income - expenseTotal)}</strong><small>الإيرادات ناقص المصروفات</small></div><div className="finance-head-buttons"><button className="button button-light" onClick={() => open({ type: 'transaction' })}><Plus size={16}/> إضافة حركة</button><button className="button button-ghost-light" onClick={shareSummary}><Send size={16}/> شارك ملخص الشهر</button><button className="button button-ghost-light" onClick={() => void shareSummaryImage()}><Camera size={16}/> صورة الملخص</button></div></div>
    <div className="stats-grid finance-stats"><StatCard label="إيرادات الشهر" value={currency(income)} caption="المقبوضات المسجلة" icon={TrendingUp} tone="green"/><StatCard label="مصروفات الشهر" value={currency(expenseTotal)} caption="المصروفات المسجلة" icon={TrendingDown} tone="rose"/><StatCard label="مبالغ مستحقة" value={currency(outstanding)} caption="المتبقي من كل الحجوزات" icon={HandCoins} tone="gold"/><StatCard label="حجوزات الشهر" value={new Intl.NumberFormat('ar-EG').format(monthBookings.length)} caption="بدون الملغي" icon={CalendarDays} tone="coffee"/></div>
    <div className="finance-grid"><section className="surface-card finance-transactions"><SectionHeader title="حركات الشهر" hint="اضغط على أي حركة لتعديلها أو مسحها" action={() => open({ type: 'transaction' })} actionLabel="إضافة حركة"/>{inMonth.length ? <div className="simple-table"><div className="table-row table-head"><span>البيان</span><span>التاريخ</span><span>التصنيف</span><span>المبلغ</span></div>{inMonth.map((t) => <button className="table-row" key={t.id} onClick={() => open({ type: 'transaction-edit', id: t.id })}><span><strong>{t.title}</strong><small>{t.clientId ? clients.get(t.clientId)?.name : '—'}</small></span><span>{dateLabel(t.date)}</span><span>{t.category}</span><b className={t.type === 'income' ? 'amount-positive' : 'amount-negative'}>{t.type === 'income' ? '+' : '−'}{currency(t.amount)}</b></button>)}</div> : <EmptyState icon={Wallet} title="مفيش حركات في الشهر ده" body="سجل أول إيراد أو مصروف، أو اتنقل لشهر تاني." action={() => open({ type: 'transaction' })} actionLabel="إضافة حركة"/>}</section>
      <aside className="surface-card expense-breakdown"><SectionHeader title="مصروفات الشهر" hint="توزيعها حسب التصنيف"/>{expenses.length ? Array.from(new Set(expenses.map((e) => e.category))).map((cat) => { const amount = expenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0); return <div className="expense-category" key={cat}><div><span>{cat}</span><strong>{currency(amount)}</strong></div><div className="progress-track"><i style={{ width: `${expenseTotal ? amount / expenseTotal * 100 : 0}%` }}/></div></div>; }) : <EmptyState icon={CircleDollarSign} title="لا توجد مصروفات" body="أي مصروف تسجله هيظهر هنا."/>}</aside></div>
    <section className="surface-card due-bookings"><SectionHeader title="المبالغ المتبقية عند العملاء" hint="اضغط «اطلب» وهتفتح رسالة واتساب جاهزة"/>{dueBookings.length ? dueBookings.map((b) => <div className="due-booking-row" key={b.id}><button className="due-booking-main" onClick={() => open({ type: 'booking-detail', id: b.id })}><strong>{b.title}</strong><span>{clients.get(b.clientId)?.name}</span></button><div><small>المتبقي</small><b>{currency(b.price - b.deposit)}</b></div><button className="button button-outline button-small" onClick={() => remind(b)}><MessageCircle size={15}/> اطلب</button></div>) : <EmptyState icon={CheckCircle2} title="مفيش مبالغ متبقية" body="كل الحجوزات مدفوعة بالكامل."/>}</section>
    <section className="surface-card due-bookings"><SectionHeader title="ربح كل حجز" hint="المدفوع ناقص المصروفات المرتبطة بالحجز"/>{profitRows.length ? profitRows.map((b) => { const net = bookingProfit(b); return <button className="due-booking-row profit-row" key={b.id} onClick={() => open({ type: 'booking-detail', id: b.id })}><div><strong>{b.title}</strong><span>{clients.get(b.clientId)?.name} · {dateLabel(b.date)}</span></div><div><small>الصافي</small><b className={net >= 0 ? 'amount-positive' : 'amount-negative'}>{currency(net)}</b></div></button>; }) : <EmptyState icon={Wallet} title="مفيش حجوزات لسه" body="الربح بيظهر بعد تسجيل أول حجز."/>}</section>
  </>;
}

function Reports({ transactions, bookings, projects, totalIncome, totalExpense }: { transactions: Transaction[]; bookings: Booking[]; projects: Project[]; totalIncome: number; totalExpense: number }) {
  const months = Array.from({length:6},(_,i)=>{ const d=new Date(); d.setMonth(d.getMonth()-(5-i)); return { key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`, label:new Intl.DateTimeFormat('ar-EG',{month:'short'}).format(d) }; });
  const max = Math.max(1,...months.map((m)=>transactions.filter((t)=>t.type==='income'&&t.date.startsWith(m.key)).reduce((s,t)=>s+t.amount,0)));
  const bestTypes = Array.from(new Set(bookings.map((b)=>b.type))).map((type)=>({type,count:bookings.filter((b)=>b.type===type).length})).sort((a,b)=>b.count-a.count).slice(0,4);
  return <>
    <div className="report-highlight"><div><span>ملخص البيانات المسجلة</span><h2>أرقام تساعدك تاخد قرار أحسن.</h2><p>التقارير هنا مبنية فقط على الحجوزات والحركات اللي سجلتها بنفسك.</p></div><div className="report-highlight-stat"><span>صافي الحركة</span><strong>{currency(totalIncome-totalExpense)}</strong></div></div>
    <div className="report-grid"><section className="surface-card report-chart-card"><SectionHeader title="الإيرادات خلال آخر 6 شهور" hint="مقارنة حسب تاريخ الحركات المالية"/><div className="report-bars">{months.map((m)=>{const amount=transactions.filter((t)=>t.type==='income'&&t.date.startsWith(m.key)).reduce((s,t)=>s+t.amount,0);return <div className="report-bar-col" key={m.key}><span>{amount?new Intl.NumberFormat('ar-EG',{notation:'compact'}).format(amount):'—'}</span><div className="report-bar-track"><i style={{height:`${Math.max(amount?5:0,amount/max*100)}%`}}/></div><small>{m.label}</small></div>;})}</div></section>
      <section className="surface-card"><SectionHeader title="أنواع التصوير" hint="الأكثر تكرارًا في حجوزاتك"/>{bestTypes.length ? bestTypes.map((item,index)=><div className="type-stat" key={item.type}><span className={`type-index type-${index}`}>0{index+1}</span><div><strong>{item.type}</strong><small>{item.count} حجوزات</small></div><b>{Math.round(item.count/Math.max(1,bookings.length)*100)}%</b></div>) : <EmptyState icon={Camera} title="مفيش بيانات كفاية" body="أنواع التصوير هتظهر بعد تسجيل حجوزات."/>}</section>
    </div>
    <div className="stats-grid report-stats"><StatCard label="إجمالي الحجوزات" value={String(bookings.length)} caption="كل الحالات المسجلة" icon={CalendarDays}/><StatCard label="مشاريع التسليم" value={String(projects.filter((p)=>p.status==='delivered').length)} caption="مشاريع تم تسليمها" icon={CheckCircle2} tone="green"/><StatCard label="متوسط قيمة الحجز" value={currency(bookings.length?bookings.reduce((s,b)=>s+b.price,0)/bookings.length:0)} caption="متوسط قيمة كل الحجوزات" icon={CircleDollarSign} tone="gold"/><StatCard label="عدد الحركات" value={String(transactions.length)} caption="إيرادات ومصروفات" icon={Wallet} tone="latte"/></div>
  </>;
}

function Templates({ templates, profile, clients, bookings, projects, onToast }: { templates: MessageTemplate[]; profile: LocalProfile; clients: Client[]; bookings: Booking[]; projects: Project[]; onToast: ToastFn }) {
  const [selected, setSelected] = useState<number | null>(templates[0]?.id ?? null);
  const [previewClient, setPreviewClient] = useState(String(clients[0]?.id ?? ''));
  const [previewBooking, setPreviewBooking] = useState('');
  const [draft, setDraft] = useState<MessageTemplate | null>(templates[0] || null);
  useEffect(() => { if (!templates.find((t) => t.id === selected)) { setSelected(templates[0]?.id ?? null); setDraft(templates[0] || null); } else if (selected) { setDraft(templates.find((t) => t.id === selected) || null); } }, [templates, selected]);

  const client = clients.find((c) => String(c.id) === previewClient);
  const clientBookings = useMemo(() => bookings.filter((b) => String(b.clientId) === previewClient && b.status !== 'cancelled').sort((a, b) => b.date.localeCompare(a.date)), [bookings, previewClient]);
  useEffect(() => {
    const today = isoToday();
    const upcoming = [...clientBookings].reverse().find((b) => b.date >= today);
    setPreviewBooking(String((upcoming ?? clientBookings[0])?.id ?? ''));
  }, [previewClient, clientBookings.length]);
  const booking = clientBookings.find((b) => String(b.id) === previewBooking);
  const project = booking ? projects.find((p) => p.bookingId === booking.id) : undefined;

  const values = buildValues({ client, booking, project, profile });
  const { text: rendered, missing } = draft ? renderMessage(draft.body, values) : { text: '', missing: [] as string[] };
  const canSend = Boolean(client?.phone && rendered.trim() && !missing.length);

  const save = async () => { if (!draft) return; if (draft.id) await db.templates.update(draft.id, { title: draft.title, channel: draft.channel, body: draft.body }); else { const id = await db.templates.add(draft); setSelected(id); } onToast('تم حفظ الرسالة', 'القالب محفوظ محليًا وجاهز للاستخدام.'); };
  const restoreDefaults = async () => { const have = new Set(templates.map((t) => t.title)); const absent = DEFAULT_TEMPLATES.filter((t) => !have.has(t.title)); if (!absent.length) { onToast('القوالب الجاهزة كلها موجودة'); return; } await db.templates.bulkAdd(absent as MessageTemplate[]); onToast('تمت إضافة القوالب الجاهزة', `${absent.length} قالب جديد.`); };
  const add = () => { setDraft({ title: 'رسالة جديدة', channel: 'both', body: 'أهلًا {name} 🤎' }); setSelected(null); };
  const remove = async () => { if (draft?.id && window.confirm('متأكد إنك عايز تمسح القالب ده؟')) { await db.templates.delete(draft.id); setDraft(null); setSelected(null); onToast('تم حذف القالب'); } };
  return <div className="templates-layout">
    <section className="surface-card template-list-card"><SectionHeader title="قوالب الرسائل" hint="اختار رسالة عشان تعدلها" action={add} actionLabel="قالب جديد"/>{templates.map((t) => <button key={t.id} className={`template-list-item ${selected === t.id ? 'active' : ''}`} onClick={() => { setSelected(t.id!); setDraft(t); }}><div className="template-list-icon"><MessageCircle size={17}/></div><div><strong>{t.title}</strong><span>{t.channel === 'whatsapp' ? 'واتساب' : t.channel === 'instagram' ? 'إنستجرام' : 'كل القنوات'}</span></div><ChevronLeft size={16}/></button>)}<button className="button button-outline button-block" onClick={() => void restoreDefaults()}><MessageCircle size={16}/> إضافة القوالب الجاهزة الناقصة</button></section>
    <section className="surface-card template-editor">{draft ? <><div className="template-editor-head"><div><span className="eyebrow">محرر القوالب</span><h2>{draft.id ? 'تعديل رسالة' : 'إنشاء رسالة جديدة'}</h2></div>{draft.id && <button className="icon-button danger-icon" onClick={() => void remove()} aria-label="مسح القالب"><Trash2 size={17}/></button>}</div>
      <label className="field-label">اسم القالب<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}/></label>
      <label className="field-label">القناة<select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value as MessageTemplate['channel'] })}><option value="both">كل القنوات</option><option value="whatsapp">واتساب</option><option value="instagram">إنستجرام</option></select></label>
      <label className="field-label">نص الرسالة<textarea rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })}/></label>
      <div className="template-tokens"><span>اضغط لإضافة متغير:</span>{Object.keys(TEMPLATE_FIELDS).map((key) => <button type="button" key={key} onClick={() => setDraft({ ...draft, body: `${draft.body}${draft.body && !/\s$/.test(draft.body) ? ' ' : ''}{${key}}` })}><code>{`{${key}}`}</code></button>)}</div>
      <button className="button button-primary" onClick={() => void save()}><Check size={16}/> حفظ القالب</button></> : <EmptyState icon={MessageSquare} title="اختار قالب أو أضف واحد جديد" body="الرسائل الجاهزة بتوفر عليك وقت الكتابة المتكررة." action={add} actionLabel="قالب جديد"/>}</section>
    <aside className="surface-card template-preview"><div className="preview-heading"><span className="eyebrow">معاينة مباشرة</span><h3>الرسالة هتظهر إزاي؟</h3></div>
      <label className="field-label">العميل<select value={previewClient} onChange={(e) => setPreviewClient(e.target.value)}>{clients.length ? clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>) : <option value="">لا يوجد عملاء للمعاينة</option>}</select></label>
      {clientBookings.length > 0 && <label className="field-label">الحجز<select value={previewBooking} onChange={(e) => setPreviewBooking(e.target.value)}>{clientBookings.map((b) => <option key={b.id} value={b.id}>{b.title} — {dateLabel(b.date)}</option>)}</select></label>}
      <div className="whatsapp-preview"><div className="preview-bubble">{rendered || 'اكتب نص الرسالة عشان تشوف المعاينة.'}</div><small>معاينة فقط — لم يتم الإرسال</small></div>
      {missing.length > 0 && <div className="form-warning">الرسالة فيها بيانات ناقصة: {missing.join('، ')}. كمّلها (مثلًا من الحجز أو الإعدادات) قبل الإرسال.</div>}
      {client && !client.phone && <div className="form-warning">العميل ده ملوش رقم هاتف مسجل.</div>}
      {client && <button className="button button-primary button-block" disabled={!canSend} onClick={() => openWhatsApp(client.phone, rendered)}><MessageCircle size={15}/> فتح واتساب بالرسالة</button>}</aside></div>;
}

function SyncBadge() {
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus);
  const text = sync.state === 'syncing' ? 'جارٍ المزامنة...' : sync.state === 'offline' ? 'غير متصل — التغييرات محفوظة على جهازك' : sync.state === 'error' ? 'مشكلة في المزامنة' : sync.pending > 0 ? `في انتظار الرفع (${sync.pending})` : 'محفوظ على حسابك';
  const tone = sync.state === 'syncing' || (sync.state === 'idle' && sync.pending > 0) ? 'busy' : sync.state === 'offline' ? 'off' : sync.state === 'error' ? 'err' : '';
  return <span className={`sync-badge ${tone}`}><i/> {text}</span>;
}

function AccountSettings({ access, onToast }: { access: AccessApi; onToast: ToastFn }) {
  const sync = useSyncExternalStore(subscribeSync, getSyncStatus);
  const account = access.account;
  if (!account) return null;
  const statusText = account.status === 'trial' ? `تجربة مجانية حتى ${account.trialEndsAt ? dateLabel(account.trialEndsAt.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}` : account.status === 'active' ? (account.paidUntil ? `اشتراك نشط حتى ${dateLabel(account.paidUntil.slice(0, 10), { day: 'numeric', month: 'long', year: 'numeric' })}` : 'اشتراك نشط') : account.status === 'suspended' ? 'موقوف' : 'بانتظار الموافقة';
  const signOut = async () => {
    if (!window.confirm('تسجيل الخروج هيمسح بيانات الجهاز ده بعد ما نتأكد إنها اترفعت على حسابك. تكمل؟')) return;
    const result = await access.signOut();
    if (!result.ok && window.confirm(`فيه ${result.pending} تغيير لسه ماتحفظش على السيرفر. لو سجلت خروج هيضيعوا. تكمل؟`)) await access.signOut(true);
  };
  const deleteAccount = async () => {
    if (!supabase) return;
    const typed = window.prompt('ده هيمسح حسابك وكل بياناتك نهائيًا ومفيش رجوع.\nلو متأكد اكتب كلمة: احذف');
    if (typed?.trim() !== 'احذف') { if (typed !== null) onToast('ماتمسحش حاجة', 'الكلمة مش مطابقة.'); return; }
    const { error } = await supabase.rpc('delete_my_account');
    if (error) { onToast('تعذر حذف الحساب', /admin_account/.test(error.message) ? 'حساب الأدمن مايتمسحش من هنا.' : 'اتأكد من الاتصال وجرّب تاني.'); return; }
    await access.signOut(true);
  };
  return <div className="settings-section">
    <div className="settings-section-title"><div className="settings-icon"><ShieldCheck size={18}/></div><div><h2>حسابي والمزامنة</h2><p>شغلك محفوظ على حسابك وبيتحدّث على كل أجهزتك.</p></div></div>
    <div className="account-box">
      <div className="account-row"><span>الإيميل</span><b dir="ltr">{account.email}</b></div>
      <div className="account-row"><span>الحالة</span><b>{statusText}</b></div>
      <div className="account-row"><span>آخر مزامنة</span><b>{sync.lastSyncAt ? new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }).format(new Date(sync.lastSyncAt)) : 'لسه'}</b></div>
      <div className="account-row"><span>في انتظار الرفع</span><b>{new Intl.NumberFormat('ar-EG').format(sync.pending)}</b></div>
      {sync.error && <p className="form-warning">{sync.error}</p>}
    </div>
    <button className="button button-outline" onClick={async () => { await syncNow(); onToast('تمت المزامنة', 'شغلك محدّث.'); }}><Send size={16}/> زامن دلوقتي</button>
    <button className="button button-outline" onClick={() => void signOut()}><LogOut size={16}/> تسجيل خروج</button>
    <p className="muted"><a href="/terms" target="_blank" rel="noopener noreferrer">شروط الاستخدام</a> · <a href="/privacy" target="_blank" rel="noopener noreferrer">سياسة الخصوصية</a></p>
    <div className="danger-zone">
      <strong>حذف الحساب</strong>
      <p className="muted">بيمسح حسابك وكل بياناتك (عملاء، حجوزات، حسابات، صفحة الحجز) من السيرفر ومن الجهاز نهائيًا، ومفيش رجوع. لو عايز نسخة منها، نزّلها من «النسخ الاحتياطي» الأول.</p>
      <button className="button button-danger" onClick={() => void deleteAccount()}><Trash2 size={16}/> حذف حسابي نهائيًا</button>
    </div>
  </div>;
}

function BookingRequestsCard({ requests, clients, templates, profile, open }: { requests: BookingRequestRow[]; clients: Client[]; templates: MessageTemplate[]; profile: LocalProfile; open: OpenModal }) {
  if (!requests.length) return null;
  const accept = async (r: BookingRequestRow) => {
    const normalized = escapePhoneForWhatsApp(r.phone);
    let clientId = clients.find((c) => escapePhoneForWhatsApp(c.phone) === normalized)?.id;
    if (!clientId) clientId = await db.clients.add({ name: r.name, phone: r.phone, source: 'manual', notes: `من صفحة الحجز${r.notes ? ` — ${r.notes}` : ''}`, createdAt: new Date().toISOString(), leadStatus: 'new' });
    open({ type: 'booking', id: clientId, request: r });
  };
  const reply = (r: BookingRequestRow) => { const { text } = renderByKey('reply', templates, { client: { name: r.name, phone: r.phone } as Client, profile }); openWhatsApp(r.phone, text); };
  const reject = async (r: BookingRequestRow) => { if (window.confirm(`رفض طلب ${r.name}؟`)) await setRequestStatus(r.id, 'rejected'); };
  return <section className="surface-card requests-card">
    <SectionHeader title={`طلبات حجز جديدة (${requests.length})`} hint="جاية من صفحة الحجز بتاعتك"/>
    {requests.map((r) => <div className="request-item" key={r.id}>
      <div className="request-head"><strong>{r.name}</strong><small dir="ltr">{r.phone}</small></div>
      <p>{fullDateLabel(r.requested_date)}{r.requested_time ? ` · ${timeLabel(r.requested_time.slice(0, 5))}` : ''} · {r.package_name || r.type || 'بدون باقة'}</p>
      {r.notes && <p className="request-notes">{r.notes}</p>}
      <div className="admin-row"><button className="button button-primary button-small" onClick={() => void accept(r)}><CalendarDays size={15}/> قبول وإنشاء حجز</button><button className="button button-outline button-small" onClick={() => reply(r)}><MessageCircle size={15}/> رد</button><button className="button button-quiet button-small" onClick={() => void reject(r)}>رفض</button></div>
    </div>)}
  </section>;
}

function PackagesSettings({ profile, setProfile, onToast }: { profile: LocalProfile; setProfile: (v: LocalProfile) => void; onToast: ToastFn }) {
  const packages = profile.packages ?? [];
  const [name, setName] = useState('');
  const [type, setType] = useState('زفاف');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('120');
  const types = ['زفاف', 'بورتريه', 'منتجات', 'فعاليات', 'تخرج', 'عائلي', 'أخرى'];
  const add = () => {
    if (!name.trim() || Number(price) <= 0) { onToast('كمّل اسم الباقة والسعر'); return; }
    setProfile({ ...profile, packages: [...packages, { id: crypto.randomUUID(), name: name.trim(), type, price: Number(price), durationMinutes: Number(duration) || 60 }] });
    setName(''); setPrice('');
    onToast('تمت إضافة الباقة', 'هتظهر في نموذج الحجز الجديد.');
  };
  const remove = (id: string) => setProfile({ ...profile, packages: packages.filter((p) => p.id !== id) });
  return <div className="settings-section">
    <div className="settings-section-title"><div className="settings-icon"><Camera size={18}/></div><div><h2>باقاتي وأسعاري</h2><p>سجّل باقاتك مرة واحدة، وفي الحجز اختار الباقة والسعر والمدة يتملوا لوحدهم.</p></div></div>
    {packages.length > 0 && <div className="package-list">{packages.map((p) => <div className="package-row" key={p.id}><div><strong>{p.name}</strong><small>{p.type} · {p.durationMinutes} دقيقة</small></div><b>{currency(p.price)}</b><button className="icon-button danger-icon" onClick={() => remove(p.id)} aria-label={`مسح ${p.name}`}><Trash2 size={17}/></button></div>)}</div>}
    <div className="settings-form-grid">
      <label className="field-label">اسم الباقة<input value={name} onChange={(e) => setName(e.target.value)} placeholder="مثال: باقة الخطوبة الذهبية"/></label>
      <label className="field-label">نوع التصوير<select value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
      <label className="field-label">السعر<input type="number" inputMode="numeric" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0"/></label>
      <label className="field-label">المدة بالدقايق<input type="number" inputMode="numeric" min="15" step="15" value={duration} onChange={(e) => setDuration(e.target.value)}/></label>
    </div>
    <button className="button button-outline" onClick={add}><Plus size={16}/> إضافة الباقة</button>
  </div>;
}

function SettingsPage({ profile, setProfile, theme, setTheme, onToast, onInstall, isInstalled, onLock, access }: { access: AccessApi; profile: LocalProfile; setProfile: (v: LocalProfile)=>void; theme: 'light'|'dark'; setTheme:(v:'light'|'dark')=>void; onToast:(title:string,body?:string)=>void; onInstall:()=>Promise<void>; isInstalled:boolean; onLock:()=>void }) {
  const [lastBackupAt, setLastBackupAt] = useState(() => localStorage.getItem('photoflow-last-backup-at') || '');
  const [busy, setBusy] = useState(false);

  const exportBackup = async () => {
    setBusy(true);
    try {
      const backup = await createBackup(profile, theme);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `PhotoFlow-Backup-${isoToday()}.photoflow.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      const stamp = new Date().toISOString();
      localStorage.setItem('photoflow-last-backup-at', stamp);
      setLastBackupAt(stamp);
      onToast('تم تنزيل النسخة الاحتياطية', 'احتفظ بالملف في مكان آمن، ويمكنك استعادته على هاتف آخر.');
    } catch {
      onToast('تعذر إنشاء النسخة', 'حاول مرة أخرى وتأكد من وجود مساحة كافية على الجهاز.');
    } finally { setBusy(false); }
  };

  const canShareFiles = typeof navigator.canShare === 'function' && navigator.canShare({ files: [new File(['{}'], 'x.json', { type: 'application/json' })] });
  const shareBackup = async () => {
    setBusy(true);
    try {
      const backup = await createBackup(profile, theme);
      const file = new File([JSON.stringify(backup, null, 2)], `PhotoFlow-Backup-${isoToday()}.photoflow.json`, { type: 'application/json' });
      await navigator.share({ files: [file], title: 'نسخة PhotoFlow الاحتياطية' });
      const stamp = new Date().toISOString();
      localStorage.setItem('photoflow-last-backup-at', stamp);
      setLastBackupAt(stamp);
      onToast('تمت مشاركة النسخة', 'اتأكد إنك حفظتها في مكان آمن زي واتساب أو درايف.');
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) onToast('تعذرت المشاركة', 'جرّب تنزيل الملف بدل كده.');
    } finally { setBusy(false); }
  };

  const exportCsv = async (kind: 'transactions' | 'bookings') => {
    const [clients, bookings, transactions] = await Promise.all([db.clients.toArray(), db.bookings.toArray(), db.transactions.toArray()]);
    const clientName = (id?: number) => clients.find((c) => c.id === id)?.name ?? '';
    const bookingTitle = (id?: number) => bookings.find((b) => b.id === id)?.title ?? '';
    if (kind === 'transactions') downloadCsv(`PhotoFlow-حركات-${isoToday()}.csv`, [['التاريخ', 'النوع', 'البيان', 'التصنيف', 'المبلغ', 'العميل', 'الحجز', 'ملاحظات'], ...transactions.sort((a, b) => a.date.localeCompare(b.date)).map((t) => [t.date, t.type === 'income' ? 'إيراد' : 'مصروف', t.title, t.category, t.amount, clientName(t.clientId), bookingTitle(t.bookingId), t.notes ?? ''])]);
    else downloadCsv(`PhotoFlow-حجوزات-${isoToday()}.csv`, [['التاريخ', 'الساعة', 'الجلسة', 'النوع', 'العميل', 'المكان', 'السعر', 'المدفوع', 'المتبقي', 'الحالة'], ...bookings.sort((a, b) => a.date.localeCompare(b.date)).map((b) => [b.date, b.time, b.title, b.type, clientName(b.clientId), b.location ?? '', b.price, b.deposit, Math.max(0, b.price - b.deposit), statusLabel[b.status]])]);
    onToast('تم تجهيز الملف', 'افتحه في Excel أو Google Sheets.');
  };

  const importBackup = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const parsed = await parseBackupFile(file);
      const ok = window.confirm('سيتم استبدال البيانات الموجودة حاليًا بالبيانات الموجودة في الملف. يُفضّل تنزيل نسخة من بياناتك الحالية أولًا. هل تريد المتابعة؟');
      if (!ok) return;
      await restoreBackup(parsed.backup);
      if (parsed.backup.profile) setProfile(parsed.backup.profile);
      if (parsed.theme) setTheme(parsed.theme);
      const counts = [parsed.backup.clients.length, parsed.backup.bookings.length, parsed.backup.projects.length, parsed.backup.transactions.length, parsed.backup.reminders.length, parsed.backup.templates.length];
      const count = counts.reduce((sum, value) => sum + value, 0);
      const stamp = new Date().toISOString();
      localStorage.setItem('photoflow-last-backup-at', stamp);
      setLastBackupAt(stamp);
      onToast('تمت استعادة بياناتك بنجاح', `تم استرجاع ${count} سجلًا${parsed.legacy ? ' من نسخة سابقة' : ''}.`);
    } catch (error) {
      onToast('تعذرت استعادة الملف', error instanceof Error ? error.message : 'تأكد أن الملف نسخة PhotoFlow سليمة.');
    } finally { setBusy(false); }
  };

  const clearAll = async () => {
    if (!window.confirm('متأكد إنك عايز تمسح كل بيانات PhotoFlow من الجهاز؟ الأفضل تنزّل نسخة احتياطية الأول.')) return;
    await clearAllData();
    onToast('تم مسح البيانات', 'التطبيق جاهز لإدخال بياناتك من البداية.');
  };

  const lastBackupLabel = lastBackupAt ? new Intl.DateTimeFormat('ar-EG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(lastBackupAt)) : 'لم يتم تنزيل نسخة بعد';
  const backupIsDue = !lastBackupAt || Date.now() - new Date(lastBackupAt).getTime() > 7 * 24 * 60 * 60 * 1000;
  return <div className="settings-layout">
    <section className="surface-card settings-main">
      <div className="settings-section">
        <div className="settings-section-title"><div className="settings-icon"><UserRound size={18}/></div><div><h2>بيانات المصور</h2><p>البيانات اللي هتظهر في الرسائل والتقارير.</p></div></div>
        <div className="settings-form-grid">
          <label className="field-label">اسم المصور<input value={profile.name} onChange={(e)=>setProfile({...profile,name:e.target.value})} placeholder="اكتب اسمك"/></label>
          <label className="field-label">اسم الاستوديو<input value={profile.studioName} onChange={(e)=>setProfile({...profile,studioName:e.target.value})} placeholder="اسم الاستوديو (اختياري)"/></label>
          <label className="field-label">رقم واتساب<input dir="ltr" value={profile.phone} onChange={(e)=>setProfile({...profile,phone:e.target.value})} placeholder="2010xxxxxxxx"/></label>
        </div>
      </div>
      {cloudConfigured && <><AccountSettings access={access} onToast={onToast}/><div className="settings-divider"/><BookingPageSettings account={access.account} onToast={onToast}/><div className="settings-divider"/></>}
      <PackagesSettings profile={profile} setProfile={setProfile} onToast={onToast}/>
      <div className="settings-divider"/>
      <div className="settings-section">
        <div className="settings-section-title"><div className="settings-icon"><Sun size={18}/></div><div><h2>المظهر</h2><p>اختار الشكل اللي يريح عينك.</p></div></div>
        <div className="theme-choices"><button className={theme==='light'?'selected':''} onClick={()=>setTheme('light')}><Sun size={18}/><span>فاتح</span><small>ألوان هادئة</small></button><button className={theme==='dark'?'selected':''} onClick={()=>setTheme('dark')}><Moon size={18}/><span>داكن</span><small>مناسب للإضاءة الخافتة</small></button></div>
      </div>
      <div className="settings-divider"/>
      <div className="settings-section">
        <div className="settings-section-title"><div className="settings-icon"><LockKeyhole size={18}/></div><div><h2>رمز القفل</h2><p>غيّر الرمز المكوّن من أربعة أرقام لحماية فتح التطبيق.</p></div></div>
        <PinSettings onToast={onToast}/>
        <div className="pin-autolock-note"><ShieldCheck size={15}/> يتم قفل التطبيق تلقائيًا بعد خمس دقائق من عدم الاستخدام، ويمكنك قفله فورًا من أعلى الشاشة.</div>
        <button className="button button-outline button-small" onClick={onLock}><LockKeyhole size={14}/> قفل التطبيق الآن</button>
      </div>
      <div className="settings-divider"/>
      <div className="settings-section">
        <div className="settings-section-title"><div className="settings-icon"><Download size={18}/></div><div><h2>تثبيت التطبيق على الموبايل</h2><p>أضفه إلى الشاشة الرئيسية وافتحه في نافذة مستقلة.</p></div></div>
        {isInstalled ? <div className="install-status"><CheckCircle2 size={17}/> التطبيق مثبت بالفعل على هذا الجهاز.</div> : <><button className="button button-primary" onClick={()=>void onInstall()}><Download size={15}/> تثبيت التطبيق</button><p className="install-help">Android: افتح قائمة Chrome ثم «تثبيت التطبيق». iPhone: افتح الموقع في Safari، اضغط مشاركة، ثم «إضافة إلى الشاشة الرئيسية».</p></>}
      </div>
    </section>
    <aside className="surface-card backup-card">
      <div className="backup-illustration"><FileDown size={34}/></div>
      <h2>نسخة احتياطية من شغلك</h2>
      <p>نزّل ملفًا واحدًا يحتوي على العملاء والحجوزات ومشاريع التصوير والحسابات والرسائل الجاهزة. احتفظ به على جهاز آخر أو مساحة تخزين آمنة، واستخدمه لاستعادة بياناتك عند تغيير الموبايل.</p>
      {canShareFiles && <button className="button button-primary button-block" onClick={()=>void shareBackup()} disabled={busy}><Send size={16}/> شارك النسخة (واتساب / درايف)</button>}
      <button className={`button ${canShareFiles ? 'button-outline' : 'button-primary'} button-block`} onClick={()=>void exportBackup()} disabled={busy}><Download size={16}/>{busy ? 'جارٍ تجهيز الملف...' : 'تنزيل ملف النسخة الاحتياطية'}</button>
      <button className="button button-outline button-block" onClick={() => void exportCsv('transactions')}><FileSpreadsheet size={16}/> تصدير الحركات المالية (Excel)</button>
      <button className="button button-outline button-block" onClick={() => void exportCsv('bookings')}><FileSpreadsheet size={16}/> تصدير الحجوزات (Excel)</button>
      <label className={`button button-outline button-block import-button ${busy?'disabled':''}`}><FileUp size={16}/> استعادة بيانات من ملف<input type="file" accept="application/json,.json,.photoflow.json" disabled={busy} onChange={(e)=>{void importBackup(e.target.files?.[0]); e.currentTarget.value='';}}/></label>
      <div className="backup-last"><span>آخر نسخة محفوظة</span><strong>{lastBackupLabel}</strong></div>
      <div className={`backup-reminder ${backupIsDue ? 'is-due' : 'is-fresh'}`}>{backupIsDue ? 'يُفضّل تنزيل نسخة احتياطية الآن، ثم تكرار ذلك مرة كل أسبوع.' : 'ممتاز! بياناتك لها نسخة حديثة. تذكّر تحديثها أسبوعيًا.'}</div>
      <div className="backup-warning"><ShieldCheck size={16}/><span>ملف النسخة يحتوي على بيانات العملاء والحسابات، وقد يكون مقروءًا لمن يحصل عليه. احتفظ به في مكان خاص وآمن.</span></div>
      <button className="danger-text-button" onClick={()=>void clearAll()}><Trash2 size={15}/> مسح كل البيانات من هذا الجهاز</button>
    </aside>
    <div className="settings-footnote"><ShieldCheck size={16}/><span>عند الانتقال إلى هاتف جديد: فعّل التطبيق على الهاتف الجديد، أنشئ رمز قفل جديدًا، ثم اختر «استعادة بيانات من ملف». ملف النسخة لا ينقل رمز التفعيل أو رمز القفل.</span></div>
  </div>;
}

function EmptyState({ icon: Icon, title, body, action, actionLabel }: { icon: typeof CalendarDays; title: string; body: string; action?:()=>void; actionLabel?:string }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={23}/></div><strong>{title}</strong><p>{body}</p>{action&&<button className="button button-outline button-small" onClick={action}><Plus size={14}/>{actionLabel||'إضافة'}</button>}</div>;
}

type OpenModal = (modal: ModalState) => void;
type ToastFn = (title: string, body?: string) => void;

function ModalHost({ modal, close, open, clients, bookings, projects, transactions, reminders, templates, profile, clientMap, onToast }: { modal: ModalState; close: () => void; open: OpenModal; clients: Client[]; bookings: Booking[]; projects: Project[]; transactions: Transaction[]; reminders: Reminder[]; templates: MessageTemplate[]; profile: LocalProfile; clientMap: Map<number, Client>; onToast: ToastFn }) {
  if (modal.type === 'client' || modal.type === 'lead') return <ClientModal clients={clients} isLead={modal.type === 'lead'} close={close} open={open} onToast={onToast}/>;
  if (modal.type === 'client-edit') return <ClientModal clients={clients} open={open} client={clients.find((c) => c.id === modal.id)} bookingCount={bookings.filter((b) => b.clientId === modal.id).length} isLead={false} close={close} onToast={onToast}/>;
  if (modal.type === 'booking') return <BookingModal clients={clients} bookings={bookings} packages={profile.packages ?? []} request={modal.request} initialClientId={modal.id} close={close} onToast={onToast}/>;
  if (modal.type === 'booking-edit') return <BookingModal clients={clients} bookings={bookings} editing={bookings.find((b) => b.id === modal.id)} close={close} onToast={onToast}/>;
  if (modal.type === 'transaction') return <TransactionModal clients={clients} bookings={bookings} preset={modal.preset} close={close} onToast={onToast}/>;
  if (modal.type === 'transaction-edit') return <TransactionModal clients={clients} bookings={bookings} editing={transactions.find((t) => t.id === modal.id)} close={close} onToast={onToast}/>;
  if (modal.type === 'reminder') return <ReminderModal clients={clients} bookings={bookings} close={close} onToast={onToast}/>;
  if (modal.type === 'reminder-edit') return <ReminderModal clients={clients} bookings={bookings} editing={reminders.find((r) => r.id === modal.id)} close={close} onToast={onToast}/>;
  if (modal.type === 'project-edit') return <ProjectModal project={projects.find((p) => p.id === modal.id)} close={close} onToast={onToast}/>;
  if (modal.type === 'booking-detail' && modal.id) return <BookingDetailModal booking={bookings.find((b) => b.id === modal.id)} clientMap={clientMap} transactions={transactions} projects={projects} templates={templates} profile={profile} close={close} open={open} onToast={onToast}/>;
  return null;
}

function ModalFrame({ title, subtitle, close, children, size = 'normal' }: { title: string; subtitle?: string; close: () => void; children: ReactNode; size?: 'normal' | 'wide' }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><div className={`modal-card ${size === 'wide' ? 'modal-wide' : ''}`} role="dialog" aria-modal="true"><div className="modal-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" onClick={close} aria-label="إغلاق"><X size={19}/></button></div>{children}</div></div>;
}

function ClientModal({ client, clients, bookingCount = 0, isLead, close, open, onToast }: { client?: Client; clients: Client[]; bookingCount?: number; isLead: boolean; close: () => void; open: OpenModal; onToast: ToastFn }) {
  const [name, setName] = useState(client?.name ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [source, setSource] = useState<Channel>(client?.source ?? (isLead ? 'whatsapp' : 'manual'));
  const [instagram, setInstagram] = useState(client?.instagram ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [paste, setPaste] = useState('');
  const editing = Boolean(client?.id);
  const normalized = escapePhoneForWhatsApp(phone);
  const duplicate = normalized ? clients.find((c) => c.id !== client?.id && escapePhoneForWhatsApp(c.phone) === normalized) : undefined;
  const contactsApi = (navigator as Navigator & { contacts?: { select: (props: string[], options?: { multiple?: boolean }) => Promise<{ name?: string[]; tel?: string[] }[]> } }).contacts;
  const canPick = !editing && Boolean(contactsApi) && 'ContactsManager' in window;
  const applyPaste = (value: string) => { setPaste(value); const parsed = parseContactText(value); if (parsed.name) setName(parsed.name); if (parsed.phone) setPhone(parsed.phone); };
  const pickContact = async () => { try { const picked = await contactsApi?.select(['name', 'tel'], { multiple: false }); if (picked?.[0]) { setName(picked[0].name?.[0] ?? ''); setPhone(picked[0].tel?.[0] ?? ''); } } catch { /* cancelled */ } };

  const submit = async (e?: FormEvent, thenBook = false) => {
    e?.preventDefault();
    if (!name.trim()) return;
    if (duplicate && !window.confirm(`في عميل بنفس الرقم: «${duplicate.name}». تحفظ برضه؟`)) return;
    const values = { name: name.trim(), phone: phone.replace(/\s/g, ''), source, instagram: instagram.replace('@', ''), notes };
    if (editing && client?.id) { await db.clients.update(client.id, values); onToast('تم حفظ التعديلات', 'بيانات العميل اتحدّثت.'); close(); return; }
    const id = await db.clients.add({ ...values, createdAt: new Date().toISOString() });
    onToast(isLead ? 'تم تسجيل الطلب' : 'تمت إضافة العميل', thenBook ? 'كمّل بيانات الحجز.' : 'بيانات العميل اتسجلت على الجهاز.');
    if (thenBook) open({ type: 'booking', id }); else close();
  };
  const remove = async () => {
    if (!client?.id) return;
    const warning = bookingCount ? `هيتمسح العميل و${bookingCount} حجز ومشاريعهم وتذكيراتهم. الحركات المالية هتفضل محفوظة. متأكد؟` : 'متأكد إنك عايز تمسح العميل ده؟';
    if (!window.confirm(warning)) return;
    await deleteClient(client.id);
    onToast('تم مسح العميل');
    close();
  };
  return <ModalFrame title={editing ? 'تعديل بيانات العميل' : isLead ? 'تسجيل طلب جديد' : 'إضافة عميل جديد'} subtitle={editing ? undefined : 'الصق الاسم والرقم مرة واحدة وهيتوزعوا لوحدهم.'} close={close}>
    <form className="modal-form" onSubmit={(e) => void submit(e)}>
      {!editing && <>
        <label className="field-label">لصق سريع (اسم ورقم)<textarea rows={2} value={paste} onChange={(e) => applyPaste(e.target.value)} placeholder="مثال: منى أحمد 01012345678"/></label>
        {canPick && <button type="button" className="button button-outline" onClick={() => void pickContact()}><Users size={16}/> اختار من جهات الاتصال</button>}
      </>}
      <label className="field-label">اسم العميل *<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم العميل" autoComplete="off"/></label>
      <div className="form-two-col">
        <label className="field-label">رقم الهاتف<input dir="ltr" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01xxxxxxxxx"/></label>
        <label className="field-label">مصدر العميل<select value={source} onChange={(e) => setSource(e.target.value as Channel)}><option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="manual">إضافة يدوية</option></select></label>
      </div>
      {duplicate && <div className="form-warning">في عميل بنفس الرقم: {duplicate.name}.</div>}
      {phone && !duplicate && !isEgyptianMobile(normalized) && <div className="form-warning">الرقم مش شكله موبايل مصري. اتأكد منه عشان رسايل واتساب توصل.</div>}
      {source === 'instagram' && <label className="field-label">اسم المستخدم على إنستجرام<input dir="ltr" autoCapitalize="none" value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="username"/></label>}
      <label className="field-label">ملاحظات أو ملخص الرسالة<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="العميل بيسأل عن نوع التصوير، الميزانية، أو تفاصيل الطلب..."/></label>
      <div className="modal-actions">
        {editing && <button type="button" className="button button-danger" onClick={() => void remove()}><Trash2 size={16}/> مسح</button>}
        <button type="button" className="button button-quiet" onClick={close}>إلغاء</button>
        <button type="submit" className="button button-outline"><Check size={16}/> حفظ</button>
        {!editing && <button type="button" className="button button-primary" onClick={() => void submit(undefined, true)}><CalendarDays size={16}/> حفظ وحجز</button>}
      </div>
    </form>
  </ModalFrame>;
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

function BookingModal({ clients, bookings, packages = [], request, initialClientId, editing, close, onToast }: { request?: BookingRequestRow; clients: Client[]; bookings: Booking[]; packages?: ServicePackage[]; initialClientId?: number; editing?: Booking; close: () => void; onToast: ToastFn }) {
  const reqPack = request ? packages.find((p) => p.name === request.package_name) : undefined;
  const [clientId, setClientId] = useState(String(editing?.clientId ?? initialClientId ?? clients[0]?.id ?? ''));
  const [title, setTitle] = useState(editing?.title ?? reqPack?.name ?? 'جلسة تصوير');
  const [type, setType] = useState(editing?.type ?? (request?.type || reqPack?.type) ?? 'زفاف');
  const [date, setDate] = useState(editing?.date ?? request?.requested_date ?? isoToday());
  const [time, setTime] = useState(editing?.time ?? request?.requested_time?.slice(0, 5) ?? '17:00');
  const [duration, setDuration] = useState(String(editing?.durationMinutes ?? reqPack?.durationMinutes ?? 120));
  const [location, setLocation] = useState(editing?.location ?? '');
  const [price, setPrice] = useState(editing ? String(editing.price || '') : reqPack ? String(reqPack.price) : '');
  const [deposit, setDeposit] = useState('');
  const [status, setStatus] = useState<BookingStatus>(editing?.status ?? 'pending');
  const [notes, setNotes] = useState(editing?.notes ?? request?.notes ?? '');
  const [conflict, setConflict] = useState('');
  const applyPackage = (id: string) => { const pack = packages.find((p) => p.id === id); if (!pack) return; setType(pack.type); setPrice(String(pack.price || '')); setDuration(String(pack.durationMinutes)); setTitle(pack.name); };
  const types = ['زفاف', 'بورتريه', 'منتجات', 'فعاليات', 'تخرج', 'عائلي', 'أخرى'];
  const durations = [60, 90, 120, 180, 240, 300, 480];
  const durationLabel = (m: number) => m === 60 ? 'ساعة' : m === 90 ? 'ساعة ونصف' : m === 120 ? 'ساعتين' : `${m / 60} ساعات`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clientId) return;
    const start = minutesOf(time);
    const end = start + (Number(duration) || 60);
    const clash = bookings.find((b) => b.id !== editing?.id && b.date === date && b.status !== 'cancelled' && start < minutesOf(b.time) + b.durationMinutes && end > minutesOf(b.time));
    if (clash) { setConflict(`الموعد متعارض مع حجز «${clash.title}» الساعة ${timeLabel(clash.time)}. اختار وقت تاني أو راجع المدة.`); return; }
    setConflict('');
    const common = { clientId: Number(clientId), title: title.trim() || 'جلسة تصوير', type, date, time, durationMinutes: Number(duration) || 60, location, price: Number(price) || 0, status, notes };

    if (editing?.id) {
      await db.bookings.update(editing.id, common);
      if (date !== editing.date || time !== editing.time || common.title !== editing.title) {
        const dueAt = new Date(`${date}T${time}:00`); dueAt.setHours(dueAt.getHours() - 24);
        const auto = await db.reminders.where('bookingId').equals(editing.id).filter((r) => !r.done && r.title.startsWith('تأكيد موعد')).toArray();
        for (const reminder of auto) if (reminder.id) await db.reminders.update(reminder.id, { title: `تأكيد موعد ${common.title}`, dueAt: dueAt.toISOString(), notifiedAt: undefined });
      }
      onToast('تم حفظ التعديلات', 'الحجز اتحدّث.');
      close();
      return;
    }

    const depositValue = Number(deposit) || 0;
    const id = await db.bookings.add({ ...common, deposit: depositValue, createdAt: new Date().toISOString() });
    await db.projects.add({ bookingId: id, status: 'shooting', updatedAt: new Date().toISOString() });
    await db.clients.update(Number(clientId), { leadStatus: 'booked' });
    if (depositValue > 0) await db.transactions.add({ type: 'income', title: `عربون ${common.title}`, amount: depositValue, date: isoToday(), clientId: Number(clientId), bookingId: id, category: 'عربون' });
    const dueAt = new Date(`${date}T${time}:00`); dueAt.setHours(dueAt.getHours() - 24);
    await db.reminders.add({ title: `تأكيد موعد ${common.title}`, body: 'راجع تفاصيل الحجز وتواصل مع العميل قبل الموعد.', dueAt: dueAt.toISOString(), bookingId: id, clientId: Number(clientId), done: false });
    if (request) void setRequestStatus(request.id, 'accepted');
    onToast('تم إنشاء الحجز', 'اتسجل المشروع والعربون والتذكير تلقائيًا.');
    close();
  };

  return <ModalFrame title={editing ? 'تعديل الحجز' : 'حجز جديد'} subtitle={editing ? undefined : 'أدخل تفاصيل جلسة التصوير والاتفاق مع العميل.'} close={close} size="wide">
    <form className="modal-form" onSubmit={submit}>
      {!clients.length ? <EmptyState icon={Users} title="أضف عميل الأول" body="لازم تسجل عميل قبل ما تعمل حجز."/> : <>
        <label className="field-label">العميل *<select required value={clientId} onChange={(e) => setClientId(e.target.value)}>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}</select></label>
        {!editing && packages.length > 0 && <label className="field-label">الباقة (بتملّي السعر والمدة)<select defaultValue="" onChange={(e) => applyPackage(e.target.value)}><option value="">من غير باقة</option>{packages.map((p) => <option key={p.id} value={p.id}>{p.name} — {currency(p.price)}</option>)}</select></label>}
        <div className="form-two-col">
          <label className="field-label">اسم الجلسة<input required value={title} onChange={(e) => setTitle(e.target.value)}/></label>
          <label className="field-label">نوع التصوير<select value={type} onChange={(e) => setType(e.target.value)}>{(types.includes(type) ? types : [...types, type]).map((t) => <option key={t}>{t}</option>)}</select></label>
        </div>
        <div className="form-three-col keep-2">
          <label className="field-label">التاريخ<input required type="date" value={date} onChange={(e) => setDate(e.target.value)}/></label>
          <label className="field-label">الساعة<input required type="time" value={time} onChange={(e) => setTime(e.target.value)}/></label>
          <label className="field-label">المدة<select value={duration} onChange={(e) => setDuration(e.target.value)}>{(durations.includes(Number(duration)) ? durations : [...durations, Number(duration)]).map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}</select></label>
        </div>
        <label className="field-label">مكان التصوير<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="الاستوديو، قاعة، أو موقع خارجي"/></label>
        <div className="form-three-col keep-2">
          <label className="field-label">السعر المتفق عليه<input type="number" inputMode="numeric" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0"/></label>
          {!editing && <label className="field-label">العربون المدفوع<input type="number" inputMode="numeric" min="0" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="0"/></label>}
          <label className="field-label">حالة الحجز<select value={status} onChange={(e) => setStatus(e.target.value as BookingStatus)}><option value="pending">بانتظار التأكيد</option><option value="confirmed">مؤكد</option><option value="completed">مكتمل</option>{editing && <option value="cancelled">ملغي</option>}</select></label>
        </div>
        {editing && <p className="modal-footnote"><ShieldCheck size={14}/> المدفوع حتى الآن {currency(editing.deposit)}. الدفعات الجديدة بتتسجل من «الحسابات» وبتتحسب تلقائيًا.</p>}
        <label className="field-label">ملاحظات<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="تفاصيل الاتفاق أو متطلبات العميل..."/></label>
        {conflict && <div className="form-warning">{conflict}</div>}
        <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close}>إلغاء</button><button type="submit" className="button button-primary"><CalendarDays size={16}/> حفظ الحجز</button></div>
      </>}
    </form>
  </ModalFrame>;
}

function TransactionModal({ clients, bookings, editing, preset, close, onToast }: { clients: Client[]; bookings: Booking[]; editing?: Transaction; preset?: { type: TransactionType; bookingId: number; amount?: number }; close: () => void; onToast: ToastFn }) {
  const presetBooking = preset ? bookings.find((b) => b.id === preset.bookingId) : undefined;
  const [type, setType] = useState<TransactionType>(editing?.type ?? preset?.type ?? 'income');
  const [title, setTitle] = useState(editing?.title ?? (presetBooking ? `${preset?.type === 'expense' ? 'مصروف' : 'دفعة'} ${presetBooking.title}` : ''));
  const [amount, setAmount] = useState(editing ? String(editing.amount) : preset?.amount ? String(preset.amount) : '');
  const [date, setDate] = useState(editing?.date ?? isoToday());
  const [category, setCategory] = useState(editing?.category ?? (preset?.type === 'expense' ? 'مواصلات' : preset ? 'دفعة' : 'جلسة تصوير'));
  const [clientId, setClientId] = useState(editing?.clientId ? String(editing.clientId) : presetBooking ? String(presetBooking.clientId) : '');
  const [bookingId, setBookingId] = useState(editing?.bookingId ? String(editing.bookingId) : preset ? String(preset.bookingId) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const base = type === 'income' ? ['جلسة تصوير', 'عربون', 'دفعة', 'دفعة نهائية', 'بيع إضافي', 'أخرى'] : ['مواصلات', 'معدات', 'مساعد تصوير', 'مونتاج', 'إيجار', 'صيانة', 'أخرى'];
  const categories = base.includes(category) ? base : [...base, category];
  const switchType = (next: TransactionType) => { setType(next); setCategory(next === 'income' ? 'جلسة تصوير' : 'مواصلات'); };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || Number(amount) <= 0) return;
    await saveTransaction({ type, title: title.trim(), amount: Number(amount), date, category, clientId: clientId ? Number(clientId) : undefined, bookingId: bookingId ? Number(bookingId) : undefined, notes }, editing?.id);
    onToast(editing ? 'تم حفظ التعديلات' : 'تم تسجيل الحركة المالية', `${type === 'income' ? 'إيراد' : 'مصروف'} بقيمة ${currency(Number(amount))}`);
    close();
  };
  const remove = async () => {
    if (!editing?.id || !window.confirm('متأكد إنك عايز تمسح الحركة دي؟')) return;
    await deleteTransaction(editing.id);
    onToast('تم مسح الحركة');
    close();
  };
  return <ModalFrame title={editing ? 'تعديل حركة مالية' : 'إضافة حركة مالية'} subtitle={editing ? undefined : 'سجّل الإيرادات والمصاريف عشان حساباتك تفضل واضحة.'} close={close}>
    <form className="modal-form" onSubmit={submit}>
      <div className="transaction-type-switch"><button type="button" className={type === 'income' ? 'active income' : ''} onClick={() => switchType('income')}><TrendingUp size={16}/> إيراد</button><button type="button" className={type === 'expense' ? 'active expense' : ''} onClick={() => switchType('expense')}><TrendingDown size={16}/> مصروف</button></div>
      <label className="field-label">البيان *<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder={type === 'income' ? 'مثال: دفعة جلسة تصوير' : 'مثال: مواصلات جلسة تصوير'}/></label>
      <div className="form-two-col">
        <label className="field-label">المبلغ *<input required type="number" inputMode="decimal" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0"/></label>
        <label className="field-label">التاريخ<input required type="date" value={date} onChange={(e) => setDate(e.target.value)}/></label>
      </div>
      <label className="field-label">التصنيف<select value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
      <div className="form-two-col">
        <label className="field-label">العميل (اختياري)<select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">بدون عميل</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field-label">الحجز المرتبط<select value={bookingId} onChange={(e) => setBookingId(e.target.value)}><option value="">بدون حجز</option>{bookings.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
      </div>
      <label className="field-label">ملاحظات<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}/></label>
      <div className="modal-actions">
        {editing && <button type="button" className="button button-danger" onClick={() => void remove()}><Trash2 size={16}/> مسح</button>}
        <button type="button" className="button button-quiet" onClick={close}>إلغاء</button>
        <button type="submit" className="button button-primary"><Check size={16}/> حفظ</button>
      </div>
    </form>
  </ModalFrame>;
}

function ReminderModal({ clients, bookings, editing, close, onToast }: { clients: Client[]; bookings: Booking[]; editing?: Reminder; close: () => void; onToast: ToastFn }) {
  const due = editing ? new Date(editing.dueAt) : undefined;
  const pad = (n: number) => String(n).padStart(2, '0');
  const [title, setTitle] = useState(editing?.title ?? 'متابعة عميل');
  const [body, setBody] = useState(editing?.body ?? '');
  const [date, setDate] = useState(due ? `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}` : isoToday());
  const [time, setTime] = useState(due ? `${pad(due.getHours())}:${pad(due.getMinutes())}` : '18:00');
  const [clientId, setClientId] = useState(editing?.clientId ? String(editing.clientId) : '');
  const [bookingId, setBookingId] = useState(editing?.bookingId ? String(editing.bookingId) : '');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const values = { title: title.trim() || 'متابعة', body, dueAt: new Date(`${date}T${time}:00`).toISOString(), clientId: clientId ? Number(clientId) : undefined, bookingId: bookingId ? Number(bookingId) : undefined };
    if (editing?.id) { await db.reminders.update(editing.id, { ...values, notifiedAt: undefined }); onToast('تم حفظ التعديلات'); }
    else { await db.reminders.add({ ...values, done: false }); onToast('تم إضافة التذكير', 'هيظهر داخل التطبيق عند موعده أثناء تشغيله.'); }
    close();
  };
  const remove = async () => {
    if (!editing?.id || !window.confirm('متأكد إنك عايز تمسح التذكير ده؟')) return;
    await db.reminders.delete(editing.id);
    onToast('تم مسح التذكير');
    close();
  };
  return <ModalFrame title={editing ? 'تعديل التذكير' : 'تذكير جديد'} subtitle={editing ? undefined : 'سجّل حاجة محتاج تفتكر تعملها في وقت محدد.'} close={close}>
    <form className="modal-form" onSubmit={submit}>
      <label className="field-label">عنوان التذكير *<input required value={title} onChange={(e) => setTitle(e.target.value)}/></label>
      <label className="field-label">التفاصيل<textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="مثال: ابعت تأكيد الموعد للعميل..."/></label>
      <div className="form-two-col"><label className="field-label">التاريخ<input type="date" value={date} onChange={(e) => setDate(e.target.value)}/></label><label className="field-label">الساعة<input type="time" value={time} onChange={(e) => setTime(e.target.value)}/></label></div>
      <div className="form-two-col">
        <label className="field-label">العميل<select value={clientId} onChange={(e) => setClientId(e.target.value)}><option value="">بدون عميل</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="field-label">الحجز<select value={bookingId} onChange={(e) => setBookingId(e.target.value)}><option value="">بدون حجز</option>{bookings.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
      </div>
      <div className="modal-actions">
        {editing && <button type="button" className="button button-danger" onClick={() => void remove()}><Trash2 size={16}/> مسح</button>}
        <button type="button" className="button button-quiet" onClick={close}>إلغاء</button>
        <button type="submit" className="button button-primary"><Bell size={16}/> حفظ</button>
      </div>
    </form>
  </ModalFrame>;
}

function ProjectModal({ project, close, onToast }: { project?: Project; close: () => void; onToast: ToastFn }) {
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? 'shooting');
  const [shotCount, setShotCount] = useState(project?.shotCount ? String(project.shotCount) : '');
  const [link, setLink] = useState(project?.deliveryLink ?? '');
  const [notes, setNotes] = useState(project?.notes ?? '');
  if (!project?.id) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = link.trim();
    const deliveryLink = trimmed && !/^https?:\/\//i.test(trimmed) ? `https://${trimmed}` : trimmed;
    await db.projects.update(project.id!, { status, shotCount: Number(shotCount) || undefined, deliveryLink: deliveryLink || undefined, notes, updatedAt: new Date().toISOString() });
    onToast('تم حفظ المشروع');
    close();
  };
  return <ModalFrame title="تفاصيل المشروع" subtitle="سجّل عدد الصور ورابط التسليم عشان يتحط تلقائيًا في الرسائل." close={close}>
    <form className="modal-form" onSubmit={submit}>
      <label className="field-label">مرحلة المشروع<select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>{(Object.keys(projectLabel) as ProjectStatus[]).map((s) => <option key={s} value={s}>{projectLabel[s]}</option>)}</select></label>
      <label className="field-label">عدد الصور<input type="number" inputMode="numeric" min="0" value={shotCount} onChange={(e) => setShotCount(e.target.value)} placeholder="0"/></label>
      <label className="field-label">رابط تسليم الصور<input dir="ltr" type="url" inputMode="url" autoCapitalize="none" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..."/></label>
      <label className="field-label">ملاحظات<textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}/></label>
      <div className="modal-actions"><button type="button" className="button button-quiet" onClick={close}>إلغاء</button><button type="submit" className="button button-primary"><Check size={16}/> حفظ</button></div>
    </form>
  </ModalFrame>;
}

function BookingDetailModal({ booking, clientMap, transactions, projects, templates, profile, close, open, onToast }: { booking?: Booking; clientMap: Map<number, Client>; transactions: Transaction[]; projects: Project[]; templates: MessageTemplate[]; profile: LocalProfile; close: () => void; open: OpenModal; onToast: ToastFn }) {
  if (!booking) return null;
  const client = clientMap.get(booking.clientId);
  const project = projects.find((p) => p.bookingId === booking.id);
  const linked = transactions.filter((t) => t.bookingId === booking.id).sort((a, b) => b.date.localeCompare(a.date));
  const spent = linked.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const remaining = Math.max(0, booking.price - booking.deposit);
  const updateStatus = async (status: BookingStatus) => { if (booking.id) await db.bookings.update(booking.id, { status }); onToast('تم تحديث حالة الحجز', statusLabel[status]); };
  const remove = async () => {
    if (!booking.id || !window.confirm('هيتمسح الحجز ومشروعه وتذكيراته. الحركات المالية المسجلة هتفضل محفوظة. متأكد؟')) return;
    await deleteBooking(booking.id);
    onToast('تم مسح الحجز');
    close();
  };
  const shareStatement = async () => {
    try {
      const payments = linked.filter((t) => t.type === 'income').sort((a, b) => a.date.localeCompare(b.date));
      const blob = await renderStatement({ studio: (profile.studioName || profile.name).trim(), title: 'كشف حساب', subtitle: `${client?.name || ''} — ${booking.title} — ${fullDateLabel(booking.date)}`, rows: payments.length ? payments.map((t) => ({ label: `${t.title} · ${dateLabel(t.date)}`, value: currency(t.amount), tone: 'plus' as const })) : [{ label: 'لا توجد دفعات مسجلة', value: currency(0) }], totals: [{ label: 'السعر المتفق عليه', value: currency(booking.price) }, { label: 'إجمالي المدفوع', value: currency(booking.deposit), tone: 'plus' }, { label: 'المتبقي', value: currency(remaining), tone: remaining ? 'minus' : 'plus' }], footer: 'شكرًا لثقتك 🤎' });
      const result = await shareImage(blob, `كشف-حساب-${booking.title}.png`, `كشف حساب ${booking.title}`);
      if (result === 'downloaded') onToast('تم تحميل كشف الحساب', 'الصورة اتحفظت على الموبايل وتقدر تبعتها للعميل.');
    } catch { onToast('تعذر إنشاء الصورة', 'جرّب تاني.'); }
  };
  const shareLink = async () => {
    const url = `${window.location.origin}/s/${booking.publicToken}`;
    const text = `أهلًا ${client?.name ?? ''} 🤎\nتقدر تتابع حجزك والمتبقي وحالة الصور من هنا:\n${url}`;
    if (client?.phone) openWhatsApp(client.phone, text); else await shareText(text);
  };
  const send = (key: TemplateKey) => {
    if (!client?.phone) { onToast('مفيش رقم هاتف للعميل', 'ضيف الرقم من بيانات العميل الأول.'); return; }
    const { text, missing } = renderByKey(key, templates, { client, booking, project, profile });
    if (missing.length) { onToast('الرسالة ناقصة بيانات', missing.join('، ')); return; }
    openWhatsApp(client.phone, text);
  };
  return <ModalFrame title="تفاصيل الحجز" subtitle="راجع بيانات الاتفاق والدفعات وحالة الجلسة." close={close} size="wide">
    <div className="booking-detail-body">
      <div className="booking-detail-highlight"><div className="booking-detail-date"><strong>{new Date(booking.date + 'T12:00:00').getDate()}</strong><span>{dateLabel(booking.date, { month: 'long' })}</span></div><div><span className="eyebrow">{booking.type}</span><h2>{booking.title}</h2><p>{client?.name || 'عميل'} · {client?.phone || 'بدون رقم'}</p></div><span className={`status-pill ${booking.status}`}>{statusLabel[booking.status]}</span></div>
      <div className="booking-detail-grid">
        <div><span>موعد التصوير</span><strong>{fullDateLabel(booking.date)}</strong><small>{timeLabel(booking.time)} · {booking.durationMinutes} دقيقة</small></div>
        <div><span>المكان</span><strong>{booking.location || 'غير محدد'}</strong></div>
        <div><span>السعر المتفق عليه</span><strong>{currency(booking.price)}</strong></div>
        <div><span>المدفوع</span><strong>{currency(booking.deposit)}</strong></div>
        <div><span>المبلغ المتبقي</span><strong className={remaining ? 'amount-negative' : 'amount-positive'}>{currency(remaining)}</strong></div>
        <div><span>صافي الحجز</span><strong className={booking.deposit - spent >= 0 ? 'amount-positive' : 'amount-negative'}>{currency(booking.deposit - spent)}</strong><small>المدفوع ناقص مصروفات {currency(spent)}</small></div>
      </div>
      {booking.notes && <p className="modal-footnote">{booking.notes}</p>}
      <div className="payments-box">
        <div className="payments-head"><strong>الدفعات والمصروفات</strong><div><button className="button button-small button-primary" onClick={() => open({ type: 'transaction', preset: { type: 'income', bookingId: booking.id!, amount: remaining || undefined } })}><Plus size={15}/> دفعة</button><button className="button button-small button-outline" onClick={() => open({ type: 'transaction', preset: { type: 'expense', bookingId: booking.id! } })}><Plus size={15}/> مصروف</button></div></div>
        {linked.length ? linked.map((t) => <button className="payment-row" key={t.id} onClick={() => open({ type: 'transaction-edit', id: t.id })}><span><strong>{t.title}</strong><small>{dateLabel(t.date)} · {t.category}</small></span><b className={t.type === 'income' ? 'amount-positive' : 'amount-negative'}>{t.type === 'income' ? '+' : '−'}{currency(t.amount)}</b></button>) : <p className="payments-empty">لسه مفيش دفعات أو مصروفات على الحجز ده.</p>}
      </div>
      <div className="booking-detail-actions">
        <label className="field-label">تغيير حالة الحجز<select value={booking.status} onChange={(e) => void updateStatus(e.target.value as BookingStatus)}><option value="pending">بانتظار التأكيد</option><option value="confirmed">مؤكد</option><option value="completed">مكتمل</option><option value="cancelled">ملغي</option></select></label>
        <button className="button button-primary" onClick={() => send('confirm')}><MessageCircle size={16}/> تأكيد الحجز على واتساب</button>
        {remaining > 0 && <button className="button button-outline" onClick={() => send('balance')}><MessageCircle size={16}/> اطلب المتبقي ({currency(remaining)})</button>}
        {project?.deliveryLink && <button className="button button-outline" onClick={() => send('ready')}><Camera size={16}/> ابعت الصور</button>}
        {cloudConfigured && (booking.publicToken ? <button className="button button-outline" onClick={() => void shareLink()}><Send size={16}/> ابعت لينك متابعة الحجز للعميل</button> : <p className="modal-footnote">لينك المتابعة للعميل بيجهز بعد أول مزامنة.</p>)}
        <button className="button button-outline" onClick={() => void shareStatement()}><Send size={16}/> شارك كشف الحساب (صورة)</button>
        <button className="button button-outline" onClick={() => open({ type: 'booking-edit', id: booking.id })}><Pencil size={16}/> تعديل الحجز</button>
        <button className="button button-danger" onClick={() => void remove()}><Trash2 size={16}/> مسح الحجز</button>
      </div>
      <p className="modal-footnote"><ShieldCheck size={14}/> الرسالة بتتفتح جاهزة في واتساب، لكن لازم تراجعها وتبعتها بنفسك.</p>
    </div>
  </ModalFrame>;
}

export default App;
