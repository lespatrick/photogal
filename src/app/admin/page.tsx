'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, LogOut, ExternalLink, Copy, Check,
  Heart, Trash2, Calendar, Key, X, Fingerprint, ShieldCheck, Lock
} from 'lucide-react';
import { startRegistration } from '@simplewebauthn/browser';
import { ThemeToggle } from '@/components/ThemeProvider';
import { useToast } from '@/components/ToastProvider';

interface GalleryItem {
  id: string;
  slug: string;
  title: string;
  shoot_date: string;
  pin_code: string;
  welcome_text: string;
  max_selections: number;
  allow_zip_download: number;
  status: 'draft' | 'active' | 'submitted' | 'archived';
  cover_thumb?: string;
  fallback_thumb?: string;
  total_photos: number;
  selected_photos: number;
  submitted_at?: string;
  created_at: string;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [galleries, setGalleries] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // New gallery form state
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().split('T')[0]);
  const [formWelcome, setFormWelcome] = useState('Wybierz swoje ulubione kadry serduszkiem, aby przekazać je do autorskiego retuszu.');
  const [formPin, setFormPin] = useState(Math.floor(1000 + Math.random() * 9000).toString());
  const [formMax, setFormMax] = useState<number | ''>(20);
  const [formZip, setFormZip] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Security Modal (Password & Passkey)
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [securityTab, setSecurityTab] = useState<'password' | 'passkeys'>('password');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Passkey state
  const [passkeys, setPasskeys] = useState<any[]>([]);
  const [passkeyName, setPasskeyName] = useState('Mój komputer / Touch ID');
  const [registeringPasskey, setRegisteringPasskey] = useState(false);

  // Custom confirmation modals for deletions
  const [deleteGalleryTarget, setDeleteGalleryTarget] = useState<{ id: string; title: string } | null>(null);
  const [deletingGallery, setDeletingGallery] = useState(false);
  const [deletePasskeyTarget, setDeletePasskeyTarget] = useState<{ id: string; friendly_name: string } | null>(null);
  const [deletingPasskey, setDeletingPasskey] = useState(false);

  const fetchPasskeys = async () => {
    try {
      const res = await fetch('/api/admin/passkey/list');
      const data = await res.json();
      setPasskeys(data.keys || []);
    } catch {}
  };

  const handleOpenSecurity = (tab: 'password' | 'passkeys' = 'password') => {
    setSecurityTab(tab);
    fetchPasskeys();
    setSecurityModalOpen(true);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast('Nowe hasła nie są identyczne', 'error');
      return;
    }
    if (newPassword.length < 6) {
      toast('Nowe hasło musi mieć co najmniej 6 znaków', 'error');
      return;
    }

    setChangingPassword(true);
    try {
      const res = await fetch('/api/admin/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      const text = await res.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch {}

      if (!res.ok) throw new Error(data.error || 'Błąd zmiany hasła');

      toast('Hasło zostało pomyślnie zmienione', 'success');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSecurityModalOpen(false);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setRegisteringPasskey(true);
    try {
      const optRes = await fetch('/api/admin/passkey/register-options');
      const options = await optRes.json();
      if (!optRes.ok) throw new Error(options.error || 'Błąd generowania opcji');

      const registrationResponse = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch('/api/admin/passkey/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: registrationResponse,
          challenge: options.challenge,
          friendlyName: passkeyName,
        }),
      });

      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Błąd weryfikacji');

      toast('Klucz Passkey dodany do konta!', 'success');
      fetchPasskeys();
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        toast(err.message || 'Błąd rejestracji Passkey', 'error');
      }
    } finally {
      setRegisteringPasskey(false);
    }
  };

  const handleConfirmDeletePasskey = async () => {
    if (!deletePasskeyTarget) return;
    setDeletingPasskey(true);
    try {
      const res = await fetch('/api/admin/passkey/list', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deletePasskeyTarget.id }),
      });
      if (!res.ok) throw new Error('Błąd usuwania');
      toast('Klucz dostępu został usunięty', 'info');
      fetchPasskeys();
      setDeletePasskeyTarget(null);
    } catch {
      toast('Błąd usuwania klucza', 'error');
    } finally {
      setDeletingPasskey(false);
    }
  };

  const fetchGalleries = async () => {
    try {
      const res = await fetch('/api/admin/galleries');
      if (res.status === 401) {
        router.push('/admin/login');
        return;
      }
      const data = await res.json();
      setGalleries(data.galleries || []);
    } catch {
      toast('Nie udało się załadować galerii', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGalleries();
  }, []);

  const handleLogout = async () => {
    await fetch('/api/admin/login', { method: 'DELETE' });
    router.push('/admin/login');
  };

  const handleCreateGallery = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const res = await fetch('/api/admin/galleries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle,
          shoot_date: formDate,
          welcome_text: formWelcome,
          pin_code: formPin,
          max_selections: formMax || 0,
          allow_zip_download: formZip,
        }),
      });

      const text = await res.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(text || 'Błąd odpowiedzi serwera');
      }

      if (!res.ok) throw new Error(data.error || 'Błąd tworzenia sesji');

      setModalOpen(false);
      setFormTitle('');
      setFormPin(Math.floor(1000 + Math.random() * 9000).toString());
      fetchGalleries();
      router.push(`/admin/galleries/${data.gallery.id}`);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const copyClientLink = (slug: string, pin: string, id: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const link = `${origin}/g/${slug}`;
    const textToCopy = `Link do galerii: ${link}\nPIN: ${pin}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedId(id);
    toast('Skopiowano link i PIN', 'success');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleConfirmDeleteGallery = async () => {
    if (!deleteGalleryTarget) return;
    setDeletingGallery(true);

    try {
      const res = await fetch(`/api/admin/galleries/${deleteGalleryTarget.id}`, { method: 'DELETE' });
      const text = await res.text();
      let data: any = {};
      try { data = text ? JSON.parse(text) : {}; } catch {}
      if (!res.ok) throw new Error(data.error || 'Błąd usuwania');

      toast(`Sesja „${deleteGalleryTarget.title}” została usunięta`, 'info');
      setGalleries((prev) => prev.filter((g) => g.id !== deleteGalleryTarget.id));
      setDeleteGalleryTarget(null);
    } catch (err: any) {
      toast(err.message || 'Błąd usuwania galerii', 'error');
    } finally {
      setDeletingGallery(false);
    }
  };

  const totalPhotosCount = galleries.reduce((acc, g) => acc + (g.total_photos || 0), 0);
  const completedSelections = galleries.filter((g) => g.status === 'submitted').length;

  return (
    <div className="app-container">
      {/* Navigation */}
      <header className="navbar">
        <div className="brand">
          <span>photogal</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            onClick={() => handleOpenSecurity('password')}
            className="btn btn-secondary"
            style={{ padding: '0.45rem 0.8rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.45rem' }}
            title="Zmień hasło i zarządzaj kluczami Passkey"
          >
            <ShieldCheck size={14} color="var(--accent-heart)" />
            <span>Bezpieczeństwo</span>
          </button>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            className="btn btn-ghost"
            style={{ padding: '0.45rem 0.8rem', fontSize: '0.8rem' }}
          >
            <LogOut size={14} />
            <span>Wyloguj</span>
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content" style={{ padding: '2.5rem 2rem', maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
        {/* Top Header */}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '1.5rem', marginBottom: '2.5rem' }}>
          <div>
            <p className="mono-meta" style={{ marginBottom: '0.4rem' }}>
              {galleries.length} {galleries.length === 1 ? 'sesja' : 'sesji'} • {totalPhotosCount} zdjęć • {completedSelections} sfinalizowanych
            </p>
            <h1 className="serif-title" style={{ fontSize: '2.5rem', lineHeight: 1.1 }}>
              Sesje Zdjęciowe
            </h1>
          </div>

          <button
            onClick={() => setModalOpen(true)}
            className="btn btn-primary"
            style={{ padding: '0.65rem 1.25rem' }}
          >
            <Plus size={15} />
            Nowa sesja
          </button>
        </div>

        {/* Galleries List */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '5rem 0' }}>
            <p className="mono-meta">Ładowanie</p>
          </div>
        ) : galleries.length === 0 ? (
          <div
            className="clean-card"
            style={{
              padding: '4rem 2rem',
              textAlign: 'center',
            }}
          >
            <h3 className="serif-title" style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>Brak utworzonych sesji</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.5rem' }}>
              Utwórz sesję, wgraj pliki i wygeneruj link dla klienta.
            </p>
            <button onClick={() => setModalOpen(true)} className="btn btn-primary">
              <Plus size={15} /> Utwórz sesję
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
              gap: '1.5rem',
            }}
          >
            {galleries.map((item) => {
              const coverSrc = item.cover_thumb || item.fallback_thumb
                ? `/api/media/${item.cover_thumb || item.fallback_thumb}`
                : null;

              return (
                <div
                  key={item.id}
                  className="clean-card"
                  style={{
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Card Cover */}
                  <div
                    style={{
                      height: '190px',
                      position: 'relative',
                      backgroundColor: 'var(--bg-tertiary)',
                      overflow: 'hidden',
                    }}
                  >
                    {coverSrc ? (
                      <img
                        src={coverSrc}
                        alt={item.title}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'var(--text-muted)',
                          fontSize: '0.8rem',
                        }}
                      >
                        Brak zdjęć
                      </div>
                    )}

                    {/* Status Pill */}
                    <div style={{ position: 'absolute', top: '0.75rem', right: '0.75rem' }}>
                      {item.status === 'submitted' ? (
                        <span className="badge badge-submitted">
                          Zakończona
                        </span>
                      ) : (
                        <span className="badge badge-active">
                          W toku
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Card Body */}
                  <div style={{ padding: '1.25rem', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <h3 className="serif-title" style={{ fontSize: '1.45rem', marginBottom: '0.4rem', lineHeight: 1.2 }}>
                      {item.title}
                    </h3>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1rem',
                        fontSize: '0.78rem',
                        color: 'var(--text-muted)',
                        marginBottom: '1.25rem',
                        letterSpacing: '0.04em',
                      }}
                    >
                      <span>{item.shoot_date}</span>
                      <span>•</span>
                      <span>PIN: <strong>{item.pin_code}</strong></span>
                    </div>

                    {/* Stats strip */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0.65rem 0.85rem',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '0.8rem',
                        marginBottom: '1.25rem',
                      }}
                    >
                      <span style={{ color: 'var(--text-secondary)' }}>
                        Zdjęcia: <strong>{item.total_photos}</strong>
                      </span>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.35rem',
                          color: item.selected_photos > 0 ? 'var(--accent-heart)' : 'var(--text-secondary)',
                          fontWeight: 500,
                        }}
                      >
                        <Heart size={13} fill={item.selected_photos > 0 ? 'currentColor' : 'none'} />
                        {item.selected_photos} {item.max_selections ? `/ ${item.max_selections}` : 'wybranych'}
                      </span>
                    </div>

                    {/* Actions */}
                    <div style={{ marginTop: 'auto', display: 'flex', gap: '0.5rem' }}>
                      <Link
                        href={`/admin/galleries/${item.id}`}
                        className="btn btn-secondary"
                        style={{ flex: 1, fontSize: '0.8rem', padding: '0.5rem' }}
                      >
                        Zarządzaj
                      </Link>

                      <button
                        onClick={() => copyClientLink(item.slug, item.pin_code, item.id)}
                        className="btn btn-secondary btn-icon"
                        title="Kopiuj link i PIN"
                      >
                        {copiedId === item.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>

                      <Link
                        href={`/g/${item.slug}`}
                        target="_blank"
                        className="btn btn-secondary btn-icon"
                        title="Podgląd klienta"
                      >
                        <ExternalLink size={14} />
                      </Link>

                      <button
                        type="button"
                        onClick={() => setDeleteGalleryTarget({ id: item.id, title: item.title })}
                        className="btn btn-danger btn-icon"
                        title="Usuń sesję"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Creation Modal */}
      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2 className="serif-title" style={{ fontSize: '1.6rem' }}>Nowa sesja</h2>
              <button onClick={() => setModalOpen(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateGallery}>
              <div className="form-group">
                <label className="form-label">Tytuł sesji</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="np. Anna i Piotr"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">Data sesji</label>
                  <input
                    type="date"
                    className="form-input"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label" style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Kod PIN</span>
                    <button
                      type="button"
                      onClick={() => setFormPin(Math.floor(1000 + Math.random() * 9000).toString())}
                      style={{ color: 'var(--text-secondary)', fontSize: '0.72rem', textDecoration: 'underline' }}
                    >
                      Losuj
                    </button>
                  </label>
                  <input
                    type="text"
                    className="form-input"
                    value={formPin}
                    onChange={(e) => setFormPin(e.target.value)}
                    maxLength={8}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Wiadomość powitalna</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={formWelcome}
                  onChange={(e) => setFormWelcome(e.target.value)}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'center' }}>
                <div className="form-group">
                  <label className="form-label">Limit ujęć w cenie</label>
                  <input
                    type="number"
                    className="form-input"
                    value={formMax}
                    onChange={(e) => setFormMax(e.target.value === '' ? '' : Number(e.target.value))}
                    min={0}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Pobieranie ZIP</label>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      marginTop: '0.4rem',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={formZip}
                      onChange={(e) => setFormZip(e.target.checked)}
                      style={{ accentColor: 'var(--text-primary)' }}
                    />
                    <span>Zezwól na ZIP po selekcji</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '2rem' }}>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="btn btn-secondary"
                >
                  Anuluj
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={submitting}
                >
                  {submitting ? 'Tworzenie...' : 'Utwórz i przejdź do sesji'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Security & Access Management Modal */}
      {securityModalOpen && (
        <div className="modal-overlay" onClick={() => setSecurityModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <div>
                <h2 className="serif-title" style={{ fontSize: '1.6rem' }}>Bezpieczeństwo</h2>
                <p className="mono-meta" style={{ marginTop: '0.2rem' }}>
                  Hasło administratora & Klucze biometryczne Passkey
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSecurityModalOpen(false)}
                style={{ color: 'var(--text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Tab navigation */}
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                borderBottom: '1px solid var(--border-hairline)',
                marginBottom: '1.5rem',
              }}
            >
              <button
                type="button"
                onClick={() => setSecurityTab('password')}
                className="btn btn-ghost"
                style={{
                  padding: '0.5rem 0.85rem',
                  fontSize: '0.82rem',
                  borderRadius: 0,
                  borderBottom: securityTab === 'password' ? '2px solid var(--text-primary)' : '2px solid transparent',
                  color: securityTab === 'password' ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: securityTab === 'password' ? 600 : 400,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <Lock size={14} />
                <span>Zmień hasło</span>
              </button>

              <button
                type="button"
                onClick={() => setSecurityTab('passkeys')}
                className="btn btn-ghost"
                style={{
                  padding: '0.5rem 0.85rem',
                  fontSize: '0.82rem',
                  borderRadius: 0,
                  borderBottom: securityTab === 'passkeys' ? '2px solid var(--text-primary)' : '2px solid transparent',
                  color: securityTab === 'passkeys' ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: securityTab === 'passkeys' ? 600 : 400,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
              >
                <Fingerprint size={14} />
                <span>Klucze Passkey {passkeys.length > 0 && `(${passkeys.length})`}</span>
              </button>
            </div>

            {/* TAB 1: Password Change */}
            {securityTab === 'password' && (
              <form onSubmit={handleChangePassword}>
                <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.5 }}>
                  Wprowadź swoje obecne hasło, a następnie zdefiniuj nowe bezpieczne hasło do panelu fotografa.
                </p>

                <div className="form-group">
                  <label className="form-label">Aktualne hasło</label>
                  <input
                    type="password"
                    className="form-input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    placeholder="Wpisz obecne hasło"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Nowe hasło (min. 6 znaków)</label>
                  <input
                    type="password"
                    className="form-input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Wpisz nowe hasło"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Powtórz nowe hasło</label>
                  <input
                    type="password"
                    className="form-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    placeholder="Powtórz nowe hasło"
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem', marginTop: '1.75rem' }}>
                  <button
                    type="button"
                    onClick={() => setSecurityModalOpen(false)}
                    className="btn btn-secondary"
                  >
                    Anuluj
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={changingPassword}
                  >
                    {changingPassword ? 'Zapisywanie...' : 'Zmień hasło'}
                  </button>
                </div>
              </form>
            )}

            {/* TAB 2: Passkeys */}
            {securityTab === 'passkeys' && (
              <div>
                <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                  Klucze Passkey pozwalają logować się do panelu fotografa jednym dotknięciem (Touch ID, Face ID, Windows Hello) bez konieczności wpisywania hasła.
                </p>

                {/* List of registered passkeys */}
                <div style={{ marginBottom: '1.75rem' }}>
                  <label className="form-label">Zarejestrowane klucze</label>
                  {passkeys.length === 0 ? (
                    <div
                      style={{
                        padding: '1.25rem',
                        textAlign: 'center',
                        background: 'var(--bg-tertiary)',
                        borderRadius: 'var(--radius-xs)',
                        color: 'var(--text-muted)',
                        fontSize: '0.82rem',
                      }}
                    >
                      Brak zarejestrowanych kluczy. Zarejestruj to urządzenie poniżej.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      {passkeys.map((pk) => (
                        <div
                          key={pk.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.75rem 1rem',
                            background: 'var(--bg-tertiary)',
                            borderRadius: 'var(--radius-xs)',
                            border: '1px solid var(--border-hairline)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <Fingerprint size={18} color="var(--accent-heart)" />
                            <div>
                              <div style={{ fontSize: '0.88rem', fontWeight: 500 }}>{pk.friendly_name}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Dodano: {new Date(pk.created_at).toLocaleDateString()} • {pk.backed_up ? 'Synchronizowany w chmurze' : 'Lokalny'}
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setDeletePasskeyTarget({ id: pk.id, friendly_name: pk.friendly_name || 'Klucz' })}
                            className="btn btn-danger btn-icon"
                            style={{ width: '30px', height: '30px' }}
                            title="Usuń klucz"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Register new passkey section */}
                <div
                  style={{
                    padding: '1.25rem',
                    border: '1px dashed var(--border-subtle)',
                    borderRadius: 'var(--radius-xs)',
                    background: 'var(--bg-secondary)',
                  }}
                >
                  <div className="form-group" style={{ marginBottom: '0.85rem' }}>
                    <label className="form-label">Nazwa nowego klucza</label>
                    <input
                      type="text"
                      className="form-input"
                      value={passkeyName}
                      onChange={(e) => setPasskeyName(e.target.value)}
                      placeholder="np. MacBook Pro Touch ID"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleRegisterPasskey}
                    disabled={registeringPasskey}
                    className="btn btn-primary"
                    style={{ width: '100%', padding: '0.65rem', fontSize: '0.84rem' }}
                  >
                    <Fingerprint size={16} />
                    {registeringPasskey ? 'Oczekiwanie na potwierdzenie biometrii...' : 'Zarejestruj to urządzenie (Passkey)'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Gallery Confirmation Modal */}
      {deleteGalleryTarget && (
        <div className="modal-overlay" onClick={() => !deletingGallery && setDeleteGalleryTarget(null)}>
          <div className="modal-card" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 className="serif-title" style={{ fontSize: '1.45rem', color: '#ef4444' }}>
                Usuń sesję
              </h2>
              <button
                type="button"
                onClick={() => !deletingGallery && setDeleteGalleryTarget(null)}
                style={{ color: 'var(--text-muted)' }}
                disabled={deletingGallery}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Czy na pewno chcesz bezpowrotnie usunąć sesję <strong style={{ color: 'var(--text-primary)' }}>„{deleteGalleryTarget.title}”</strong>?
              Wszystkie zdjęcia, wygenerowane miniatury oraz selekcje klienta zostaną trwale usunięte.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => setDeleteGalleryTarget(null)}
                className="btn btn-secondary"
                disabled={deletingGallery}
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteGallery}
                className="btn btn-danger-solid"
                disabled={deletingGallery}
                style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}
              >
                <Trash2 size={14} />
                <span>{deletingGallery ? 'Usuwanie...' : 'Usuń sesję'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Passkey Confirmation Modal */}
      {deletePasskeyTarget && (
        <div className="modal-overlay" onClick={() => !deletingPasskey && setDeletePasskeyTarget(null)}>
          <div className="modal-card" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 className="serif-title" style={{ fontSize: '1.35rem', color: '#ef4444' }}>
                Usuń klucz dostępu
              </h2>
              <button
                type="button"
                onClick={() => !deletingPasskey && setDeletePasskeyTarget(null)}
                style={{ color: 'var(--text-muted)' }}
                disabled={deletingPasskey}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Czy na pewno chcesz usunąć klucz <strong style={{ color: 'var(--text-primary)' }}>„{deletePasskeyTarget.friendly_name}”</strong>?
              Nie będziesz już mógł logować się na tym urządzeniu za pomocą Touch ID / biometrii.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => setDeletePasskeyTarget(null)}
                className="btn btn-secondary"
                disabled={deletingPasskey}
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePasskey}
                className="btn btn-danger-solid"
                disabled={deletingPasskey}
              >
                <span>{deletingPasskey ? 'Usuwanie...' : 'Usuń klucz'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
