'use client';

import React, { useEffect, useState, useRef, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Upload, Copy, Check, ExternalLink, Heart,
  Download, Trash2, FileText, Settings, X, Star, ShieldAlert, ShieldCheck
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeProvider';
import { useToast } from '@/components/ToastProvider';

interface PhotoItem {
  id: string;
  filename: string;
  thumb_path: string;
  preview_path: string;
  original_path: string;
  width: number;
  height: number;
  aspect_ratio: number;
  is_selected: number;
  order_index: number;
}

interface GalleryData {
  id: string;
  slug: string;
  title: string;
  shoot_date: string;
  welcome_text: string;
  pin_code: string;
  max_selections: number;
  allow_zip_download: number;
  status: 'draft' | 'active' | 'submitted' | 'archived';
  cover_photo_id?: string;
  client_notes?: string;
  submitted_at?: string;
}

export default function GalleryManagementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const galleryId = resolvedParams.id;
  const router = useRouter();
  const { toast } = useToast();

  const [gallery, setGallery] = useState<GalleryData | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [filterMode, setFilterMode] = useState<'all' | 'selected'>('all');

  // Export modal state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportData, setExportData] = useState<{
    commaSeparated: string;
    spaceSeparated: string;
    lineSeparated: string;
    withoutExtension: string;
    count: number;
  } | null>(null);
  const [copiedFormat, setCopiedFormat] = useState<string | null>(null);

  // Settings modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editPin, setEditPin] = useState('');
  const [editMax, setEditMax] = useState<number | ''>(0);
  const [editAllowZip, setEditAllowZip] = useState(false);
  const [editWelcome, setEditWelcome] = useState('');

  // Delete photo confirmation
  const [photoToDelete, setPhotoToDelete] = useState<{ id: string; filename: string } | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState(false);

  const [securityInfo, setSecurityInfo] = useState<{
    failedAttempts24h: number;
    isLocked: boolean;
    lockedUntil: string | null;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const fetchSecurityInfo = async () => {
    try {
      const res = await fetch(`/api/admin/galleries/${galleryId}/security`);
      if (res.ok) {
        const sec = await res.json();
        setSecurityInfo(sec);
      }
    } catch {}
  };

  const handleResetSecurity = async () => {
    try {
      const res = await fetch(`/api/admin/galleries/${galleryId}/security`, { method: 'POST' });
      if (!res.ok) throw new Error('Błąd');
      toast('Blokada PIN zdjęta, historia prób wyczyszczona', 'success');
      fetchSecurityInfo();
      fetchGalleryData();
    } catch {
      toast('Błąd resetowania blokady', 'error');
    }
  };

  const fetchGalleryData = async () => {
    try {
      const res = await fetch(`/api/admin/galleries/${galleryId}`);
      if (res.status === 401) {
        router.push('/admin/login');
        return;
      }
      if (!res.ok) throw new Error('Nie znaleziono galerii');
      const data = await res.json();
      setGallery(data.gallery);
      setPhotos(data.photos || []);

      setEditTitle(data.gallery.title);
      setEditPin(data.gallery.pin_code);
      setEditMax(data.gallery.max_selections);
      setEditAllowZip(data.gallery.allow_zip_download === 1);
      setEditWelcome(data.gallery.welcome_text || '');
    } catch {
      toast('Błąd ładowania danych sesji', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGalleryData();
    fetchSecurityInfo();
  }, [galleryId]);

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setUploading(true);
    setUploadProgress({ current: 0, total: fileList.length });

    let totalUploaded = 0;
    let failedCount = 0;
    const CHUNK_SIZE = 2; // Chunk upload in batches of 2 to avoid memory spike and reverse-proxy 413

    try {
      for (let i = 0; i < fileList.length; i += CHUNK_SIZE) {
        const chunk = fileList.slice(i, i + CHUNK_SIZE);
        const formData = new FormData();
        for (const file of chunk) {
          formData.append('files', file);
        }

        try {
          const res = await fetch(`/api/admin/galleries/${galleryId}/upload`, {
            method: 'POST',
            body: formData,
          });

          const data = await res.json();
          if (res.ok) {
            totalUploaded += data.count || chunk.length;
          } else {
            failedCount += chunk.length;
          }
        } catch {
          failedCount += chunk.length;
        }

        setUploadProgress({ current: Math.min(i + CHUNK_SIZE, fileList.length), total: fileList.length });
      }

      if (failedCount === 0) {
        toast(`Wgrano pomyślnie ${totalUploaded} zdjęć`, 'success');
      } else {
        toast(`Wgrano ${totalUploaded} zdjęć (${failedCount} z błędami)`, 'info');
      }

      fetchGalleryData();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleConfirmDeletePhoto = async () => {
    if (!photoToDelete) return;
    setDeletingPhoto(true);

    try {
      const res = await fetch(`/api/admin/galleries/${galleryId}/photos/${photoToDelete.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Błąd usuwania');
      toast('Usunięto zdjęcie', 'info');
      setPhotos((prev) => prev.filter((p) => p.id !== photoToDelete.id));
      setPhotoToDelete(null);
    } catch {
      toast('Błąd usuwania zdjęcia', 'error');
    } finally {
      setDeletingPhoto(false);
    }
  };

  const handleSetCover = async (photoId: string) => {
    try {
      const res = await fetch(`/api/admin/galleries/${galleryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cover_photo_id: photoId }),
      });
      if (!res.ok) throw new Error('Błąd ustawiania okładki');
      toast('Ustawiono jako okładkę', 'success');
      setGallery((prev) => (prev ? { ...prev, cover_photo_id: photoId } : null));
    } catch {
      toast('Błąd zapisu', 'error');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/admin/galleries/${galleryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          pin_code: editPin,
          max_selections: editMax || 0,
          allow_zip_download: editAllowZip ? 1 : 0,
          welcome_text: editWelcome,
        }),
      });

      if (!res.ok) throw new Error('Błąd zapisu');
      toast('Zaktualizowano ustawienia', 'success');
      setSettingsOpen(false);
      fetchGalleryData();
    } catch {
      toast('Błąd zapisu zmian', 'error');
    }
  };

  const handleOpenExport = async () => {
    try {
      const res = await fetch(`/api/admin/galleries/${galleryId}/export`);
      const data = await res.json();
      setExportData(data);
      setExportModalOpen(true);
    } catch {
      toast('Błąd eksportu', 'error');
    }
  };

  const copyToClipboard = (text: string, formatName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedFormat(formatName);
    toast(`Skopiowano (${formatName})`, 'success');
    setTimeout(() => setCopiedFormat(null), 2000);
  };

  const copyClientShare = () => {
    if (!gallery) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const shareText = `Link do galerii: ${origin}/g/${gallery.slug}\nPIN: ${gallery.pin_code}`;
    navigator.clipboard.writeText(shareText);
    toast('Skopiowano link i PIN', 'success');
  };

  if (loading || !gallery) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p className="mono-meta">Ładowanie</p>
      </div>
    );
  }

  const selectedPhotos = photos.filter((p) => p.is_selected === 1);
  const displayPhotos = filterMode === 'selected' ? selectedPhotos : photos;

  return (
    <div className="app-container">
      {/* Top Navbar */}
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/admin" className="btn btn-ghost btn-icon" title="Powrót">
            <ArrowLeft size={16} />
          </Link>
          <div className="brand">
            <span>{gallery.title}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <ThemeToggle />
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn btn-secondary btn-icon"
            title="Ustawienia"
          >
            <Settings size={15} />
          </button>
          <Link
            href={`/g/${gallery.slug}`}
            target="_blank"
            className="btn btn-secondary"
            style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
          >
            <ExternalLink size={13} />
            <span>Podgląd</span>
          </Link>
        </div>
      </header>

      {/* Main Content */}
      <main className="main-content" style={{ padding: '2.5rem 2rem', maxWidth: '1600px', margin: '0 auto', width: '100%' }}>
        {/* Gallery Info Strip */}
        <div
          className="clean-card"
          style={{
            padding: '1.5rem',
            marginBottom: '2rem',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1.25rem',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
              <h1 className="serif-title" style={{ fontSize: '1.8rem', lineHeight: 1.1 }}>
                {gallery.title}
              </h1>
              {gallery.status === 'submitted' ? (
                <span className="badge badge-submitted">Zakończona</span>
              ) : (
                <span className="badge badge-active">W trakcie</span>
              )}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', color: 'var(--text-muted)', fontSize: '0.8rem', letterSpacing: '0.04em' }}>
              <span>Data: <strong style={{ color: 'var(--text-primary)' }}>{gallery.shoot_date}</strong></span>
              <span>PIN: <strong style={{ color: 'var(--text-primary)' }}>{gallery.pin_code}</strong></span>
              <span>Limit: <strong style={{ color: 'var(--text-primary)' }}>{gallery.max_selections ? `${gallery.max_selections}` : 'Brak'}</strong></span>
              <span>ZIP: <strong style={{ color: 'var(--text-primary)' }}>{gallery.allow_zip_download ? 'Tak' : 'Nie'}</strong></span>
            </div>

            {securityInfo && (securityInfo.isLocked || securityInfo.failedAttempts24h > 0) && (
              <div
                style={{
                  marginTop: '0.85rem',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-xs)',
                  background: securityInfo.isLocked ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-tertiary)',
                  border: `1px solid ${securityInfo.isLocked ? '#ef4444' : 'var(--border-subtle)'}`,
                  fontSize: '0.82rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '1rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  {securityInfo.isLocked ? (
                    <ShieldAlert size={16} color="#ef4444" />
                  ) : (
                    <ShieldCheck size={16} color="var(--text-muted)" />
                  )}
                  <span>
                    {securityInfo.isLocked
                      ? '⚠️ Galeria zablokowana ze względów bezpieczeństwa (wykryto próby brute-force na PIN).'
                      : `Błędne próby wpisania PIN (ostatnie 24h): ${securityInfo.failedAttempts24h}`}
                  </span>
                </div>

                <button
                  onClick={handleResetSecurity}
                  className="btn btn-secondary"
                  style={{ padding: '0.25rem 0.6rem', fontSize: '0.74rem' }}
                >
                  Odblokuj i zresetuj
                </button>
              </div>
            )}

            {gallery.client_notes && (
              <div
                style={{
                  marginTop: '0.85rem',
                  padding: '0.65rem 0.85rem',
                  borderRadius: 'var(--radius-xs)',
                  background: 'var(--bg-tertiary)',
                  fontSize: '0.82rem',
                  color: 'var(--text-secondary)',
                  borderLeft: '2px solid var(--text-primary)',
                }}
              >
                Notatka od klienta: {gallery.client_notes}
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            <button onClick={copyClientShare} className="btn btn-secondary" style={{ fontSize: '0.8rem' }}>
              <Copy size={13} /> Link i PIN
            </button>

            <button
              onClick={handleOpenExport}
              className="btn btn-primary"
              disabled={selectedPhotos.length === 0}
              style={{ fontSize: '0.8rem' }}
            >
              <FileText size={13} /> Eksportuj wybrane ({selectedPhotos.length})
            </button>

            <a
              href={`/api/admin/galleries/${gallery.id}/zip?selected=true`}
              download
              className={`btn btn-secondary ${selectedPhotos.length === 0 ? 'disabled' : ''}`}
              style={{
                pointerEvents: selectedPhotos.length === 0 ? 'none' : 'auto',
                opacity: selectedPhotos.length === 0 ? 0.4 : 1,
                fontSize: '0.8rem',
              }}
            >
              <Download size={13} /> ZIP (wybrane)
            </a>

            <a
              href={`/api/admin/galleries/${gallery.id}/zip`}
              download
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem' }}
            >
              <Download size={13} /> ZIP (wszystkie)
            </a>
          </div>
        </div>

        {/* Minimal Dropzone */}
        <div
          className={`dropzone ${uploading ? 'active' : ''}`}
          style={{ marginBottom: '2.5rem' }}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFileUpload(e.dataTransfer.files);
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/jpeg,image/jpg,image/png,image/webp,image/heic,image/tiff"
            style={{ display: 'none' }}
            onChange={(e) => handleFileUpload(e.target.files)}
          />

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <Upload size={18} color="var(--text-muted)" />
            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>
              {uploading
                ? uploadProgress
                  ? `Wgrywanie: ${uploadProgress.current} z ${uploadProgress.total} (${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%)...`
                  : 'Przetwarzanie i konwersja WebP...'
                : 'Przeciągnij zdjęcia tutaj (JPG, PNG, WebP) lub kliknij, aby wybrać'}
            </p>
            <p className="mono-meta">
              Automatyczna generacja miniatur WebP i bezpieczny transfer
            </p>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              onClick={() => setFilterMode('all')}
              className={`btn ${filterMode === 'all' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            >
              Wszystkie ({photos.length})
            </button>
            <button
              onClick={() => setFilterMode('selected')}
              className={`btn ${filterMode === 'selected' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.85rem' }}
            >
              Wybrane ({selectedPhotos.length})
            </button>
          </div>

          <span className="mono-meta">
            {displayPhotos.length} zdjęć
          </span>
        </div>

        {/* Photos Grid */}
        {displayPhotos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
            <p className="mono-meta">Brak zdjęć do wyświetlenia</p>
          </div>
        ) : (
          <div className="masonry-container">
            {displayPhotos.map((photo) => {
              const isCover = gallery.cover_photo_id === photo.id;
              const isSelected = photo.is_selected === 1;

              return (
                <div
                  key={photo.id}
                  className={`masonry-item ${isSelected ? 'is-selected' : ''}`}
                >
                  <img
                    src={`/api/media/${photo.thumb_path}`}
                    alt={photo.filename}
                    loading="lazy"
                  />

                  {/* Badges */}
                  <div
                    style={{
                      position: 'absolute',
                      top: '0.6rem',
                      left: '0.6rem',
                      display: 'flex',
                      gap: '0.35rem',
                    }}
                  >
                    {isCover && (
                      <span className="badge badge-submitted" style={{ padding: '0.15rem 0.45rem' }}>
                        Okładka
                      </span>
                    )}
                    {isSelected && (
                      <span
                        className="badge"
                        style={{
                          background: 'var(--accent-heart)',
                          color: '#fff',
                          border: 'none',
                          padding: '0.15rem 0.45rem',
                        }}
                      >
                        Wybrane
                      </span>
                    )}
                  </div>

                  {/* Overlay Controls */}
                  <div className="photo-overlay">
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.35rem' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetCover(photo.id);
                        }}
                        className="btn btn-secondary btn-icon"
                        style={{ width: '32px', height: '32px', background: 'rgba(0,0,0,0.6)' }}
                        title="Ustaw jako okładkę"
                      >
                        <Star size={13} color="#fff" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPhotoToDelete({ id: photo.id, filename: photo.filename });
                        }}
                        className="btn btn-danger btn-icon"
                        style={{ width: '32px', height: '32px', background: 'rgba(0,0,0,0.6)' }}
                        title="Usuń zdjęcie"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>

                    <div className="photo-filename">{photo.filename}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Export Modal */}
      {exportModalOpen && exportData && (
        <div className="modal-overlay" onClick={() => setExportModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '600px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <div>
                <h2 className="serif-title" style={{ fontSize: '1.6rem' }}>Eksport selekcji</h2>
                <p className="mono-meta" style={{ marginTop: '0.2rem' }}>
                  {exportData.count} wybranych kadrów
                </p>
              </div>
              <button onClick={() => setExportModalOpen(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginBottom: '1.75rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Przecinki (Capture One / Lightroom)
                  </label>
                  <button
                    onClick={() => copyToClipboard(exportData.commaSeparated, 'Przecinki')}
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem' }}
                  >
                    {copiedFormat === 'Przecinki' ? <Check size={11} /> : <Copy size={11} />}
                    Kopiuj
                  </button>
                </div>
                <textarea
                  readOnly
                  className="form-textarea"
                  rows={3}
                  value={exportData.commaSeparated}
                  style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Spacje (Filtr Lightroom)
                  </label>
                  <button
                    onClick={() => copyToClipboard(exportData.spaceSeparated, 'Spacje')}
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem' }}
                  >
                    {copiedFormat === 'Spacje' ? <Check size={11} /> : <Copy size={11} />}
                    Kopiuj
                  </button>
                </div>
                <textarea
                  readOnly
                  className="form-textarea"
                  rows={2}
                  value={exportData.spaceSeparated}
                  style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                  <label className="form-label" style={{ marginBottom: 0 }}>
                    Bez rozszerzeń (.JPG)
                  </label>
                  <button
                    onClick={() => copyToClipboard(exportData.withoutExtension, 'Bez rozszerzeń')}
                    className="btn btn-secondary"
                    style={{ padding: '0.25rem 0.6rem', fontSize: '0.72rem' }}
                  >
                    {copiedFormat === 'Bez rozszerzeń' ? <Check size={11} /> : <Copy size={11} />}
                    Kopiuj
                  </button>
                </div>
                <textarea
                  readOnly
                  className="form-textarea"
                  rows={2}
                  value={exportData.withoutExtension}
                  style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <a
                href={`/api/admin/galleries/${gallery.id}/export?download=true`}
                download
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem' }}
              >
                <Download size={13} /> Pobierz selekcja.txt
              </a>

              <button onClick={() => setExportModalOpen(false)} className="btn btn-primary" style={{ fontSize: '0.8rem' }}>
                Zamknij
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {settingsOpen && (
        <div className="modal-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2 className="serif-title" style={{ fontSize: '1.6rem' }}>Ustawienia sesji</h2>
              <button onClick={() => setSettingsOpen(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveSettings}>
              <div className="form-group">
                <label className="form-label">Tytuł</label>
                <input
                  type="text"
                  className="form-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label className="form-label">PIN</label>
                  <input
                    type="text"
                    className="form-input"
                    value={editPin}
                    onChange={(e) => setEditPin(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Limit ujęć</label>
                  <input
                    type="number"
                    className="form-input"
                    value={editMax}
                    onChange={(e) => setEditMax(e.target.value === '' ? '' : Number(e.target.value))}
                    min={0}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Wiadomość powitalna</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  value={editWelcome}
                  onChange={(e) => setEditWelcome(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer',
                    fontSize: '0.82rem',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={editAllowZip}
                    onChange={(e) => setEditAllowZip(e.target.checked)}
                    style={{ accentColor: 'var(--text-primary)' }}
                  />
                  <span>Zezwalaj na pobieranie ZIP po zakończonej selekcji</span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem', marginTop: '1.75rem' }}>
                <button
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                  className="btn btn-secondary"
                >
                  Anuluj
                </button>
                <button type="submit" className="btn btn-primary">
                  Zapisz
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Photo Confirmation Modal */}
      {photoToDelete && (
        <div className="modal-overlay" onClick={() => !deletingPhoto && setPhotoToDelete(null)}>
          <div className="modal-card" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
              <h2 className="serif-title" style={{ fontSize: '1.35rem', color: '#ef4444' }}>
                Usuń zdjęcie
              </h2>
              <button
                type="button"
                onClick={() => !deletingPhoto && setPhotoToDelete(null)}
                style={{ color: 'var(--text-muted)' }}
                disabled={deletingPhoto}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.5rem' }}>
              Czy na pewno chcesz usunąć plik <strong style={{ color: 'var(--text-primary)' }}>{photoToDelete.filename}</strong>?
              Zdjęcie oraz jego zoptymalizowane miniatury zostaną trwale wykasowane z serwera.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.65rem' }}>
              <button
                type="button"
                onClick={() => setPhotoToDelete(null)}
                className="btn btn-secondary"
                disabled={deletingPhoto}
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleConfirmDeletePhoto}
                className="btn btn-danger-solid"
                disabled={deletingPhoto}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Trash2 size={14} />
                <span>{deletingPhoto ? 'Usuwanie...' : 'Usuń zdjęcie'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
