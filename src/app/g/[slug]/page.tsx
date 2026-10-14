'use client';

import React, { useEffect, useState, useRef, use, useCallback } from 'react';
import {
  Heart, X, ChevronLeft, ChevronRight, Check, Send, Download,
  Lock, ArrowRight, CheckCircle2
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeProvider';
import { useToast } from '@/components/ToastProvider';

interface PhotoItem {
  id: string;
  filename: string;
  thumb_path: string;
  preview_path: string;
  aspect_ratio: number;
  width: number;
  height: number;
  is_selected: number;
}

interface GalleryPublicData {
  id: string;
  slug: string;
  title: string;
  shoot_date: string;
  welcome_text?: string;
  max_selections: number;
  allow_zip_download: number;
  status: 'draft' | 'active' | 'submitted' | 'archived';
  cover_thumb?: string;
  submitted_at?: string;
}

async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || 'Błąd odpowiedzi serwera' };
  }
}

export default function ClientGalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const resolvedParams = use(params);
  const slug = resolvedParams.slug;
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [verifying, setVerifying] = useState(false);

  const [gallery, setGallery] = useState<GalleryPublicData | null>(null);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filter tabs: all vs selected
  const [filterMode, setFilterMode] = useState<'all' | 'selected'>('all');

  // Lightbox state
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Finalize modal state
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [clientNotes, setClientNotes] = useState('');
  const [submittingFinal, setSubmittingFinal] = useState(false);

  // Touch swipe support for Lightbox
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const getClientToken = useCallback(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(`photogal_token_${slug}`);
  }, [slug]);

  const loadGallery = useCallback(async (token?: string | null) => {
    try {
      const activeToken = token || getClientToken();
      const headers: Record<string, string> = {};
      if (activeToken) {
        headers['x-client-token'] = activeToken;
      }

      const res = await fetch(`/api/client/galleries/${slug}`, { headers });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Nie znaleziono galerii');

      if (data.unlocked) {
        setUnlocked(true);
        setGallery(data.gallery);
        setPhotos(data.photos || []);
        setSelectedIds(new Set(data.selectedIds || []));
      } else {
        setUnlocked(false);
        setGallery(data.gallery);
      }
    } catch {
      toast('Nie udało się załadować galerii', 'error');
    } finally {
      setLoading(false);
    }
  }, [slug, getClientToken, toast]);

  useEffect(() => {
    loadGallery();
  }, [loadGallery]);

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pinInput.trim()) return;

    setVerifying(true);
    setPinError('');

    try {
      const res = await fetch(`/api/client/galleries/${slug}/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput.trim() }),
      });

      const data = await parseJsonResponse(res);
      if (!res.ok) {
        setPinError(data.error || 'Nieprawidłowy PIN');
        return;
      }

      localStorage.setItem(`photogal_token_${slug}`, data.token);
      loadGallery(data.token);
    } catch {
      setPinError('Wystąpił błąd weryfikacji');
    } finally {
      setVerifying(false);
    }
  };

  const handleToggleSelection = async (photoId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (gallery?.status === 'submitted') {
      toast('Selekcja została już zatwierdzona.', 'info');
      return;
    }

    const token = getClientToken();
    if (!token) return;

    let isCurrentlySelected = false;
    setSelectedIds((prev) => {
      isCurrentlySelected = prev.has(photoId);
      const next = new Set(prev);
      if (isCurrentlySelected) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });

    try {
      const res = await fetch(`/api/client/galleries/${slug}/selections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': token,
        },
        body: JSON.stringify({
          photoId,
          action: isCurrentlySelected ? 'unlike' : 'like',
        }),
      });

      const data = await parseJsonResponse(res);
      if (!res.ok) {
        // Rollback this toggle
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (isCurrentlySelected) next.add(photoId);
          else next.delete(photoId);
          return next;
        });
        throw new Error(data.error || 'Błąd zapisu wyboru');
      }

      if (Array.isArray(data.selectedIds)) {
        setSelectedIds(new Set(data.selectedIds));
      }
    } catch (err: any) {
      toast(err.message, 'error');
    }
  };

  // Keyboard navigation for Lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;

    const currentList = filterMode === 'selected'
      ? photos.filter((p) => selectedIds.has(p.id))
      : photos;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (currentList.length === 0) {
        setLightboxIndex(null);
        return;
      }
      if (e.key === 'Escape') {
        setLightboxIndex(null);
      } else if (e.key === 'ArrowRight') {
        if (currentList.length <= 1) return;
        setLightboxIndex((prev) => (prev !== null && prev < currentList.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowLeft') {
        if (currentList.length <= 1) return;
        setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : currentList.length - 1));
      } else if (e.key === ' ' || e.key === 'f') {
        e.preventDefault();
        const currentPhoto = currentList[lightboxIndex];
        if (currentPhoto) handleToggleSelection(currentPhoto.id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxIndex, filterMode, photos, selectedIds, gallery?.status]);

  // Touch swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null || lightboxIndex === null) return;
    const diff = touchStartX.current - touchEndX.current;
    const currentList = filterMode === 'selected'
      ? photos.filter((p) => selectedIds.has(p.id))
      : photos;

    if (currentList.length <= 1) {
      touchStartX.current = null;
      touchEndX.current = null;
      return;
    }

    if (diff > 50) {
      setLightboxIndex((prev) => (prev !== null && prev < currentList.length - 1 ? prev + 1 : 0));
    } else if (diff < -50) {
      setLightboxIndex((prev) => (prev !== null && prev > 0 ? prev - 1 : currentList.length - 1));
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  const handleFinalize = async () => {
    const token = getClientToken();
    if (!token) return;

    setSubmittingFinal(true);
    try {
      const res = await fetch(`/api/client/galleries/${slug}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': token,
        },
        body: JSON.stringify({ notes: clientNotes }),
      });

      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || 'Błąd finalizacji');

      toast('Selekcja została pomyślnie przesłana.', 'success');
      setFinalizeOpen(false);
      setGallery((prev) => (prev ? { ...prev, status: 'submitted' } : null));
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setSubmittingFinal(false);
    }
  };

  if (loading) {
    return (
      <div className="app-container" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <p className="mono-meta">Ładowanie galerii</p>
      </div>
    );
  }

  // ==========================================
  // SCREEN 1: MINIMALIST PIN GATE SCREEN
  // ==========================================
  if (!unlocked) {
    return (
      <div className="pin-gate-wrap">
        <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
          <ThemeToggle />
        </div>

        <div className="pin-card">
          <p className="mono-meta" style={{ marginBottom: '0.85rem' }}>Prywatna Galeria</p>
          <h1 className="serif-title" style={{ fontSize: '2.5rem', marginBottom: '0.5rem', lineHeight: 1.15 }}>
            {gallery?.title || 'Kolekcja Zdjęć'}
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginBottom: '2.5rem', fontWeight: 300 }}>
            Wprowadź kod PIN przekazany przez fotografa
          </p>

          <form onSubmit={handleVerifyPin} style={{ maxWidth: '320px', margin: '0 auto' }}>
            <div style={{ marginBottom: '1.25rem' }}>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                maxLength={8}
                value={pinInput}
                onChange={(e) => setPinInput(e.target.value)}
                placeholder="• • • •"
                className="form-input"
                style={{
                  fontSize: '1.6rem',
                  letterSpacing: '0.35em',
                  textAlign: 'center',
                  padding: '0.8rem 1rem',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-secondary)',
                }}
              />
            </div>

            {pinError && (
              <p style={{ color: 'var(--accent-heart)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                {pinError}
              </p>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', padding: '0.75rem', fontSize: '0.86rem' }}
              disabled={verifying || !pinInput.trim()}
            >
              {verifying ? 'Weryfikacja...' : 'Otwórz galerię'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==========================================
  // SCREEN 2: UNLOCKED GALLERY VIEW
  // ==========================================
  const selectedCount = selectedIds.size;
  const maxLimit = gallery?.max_selections || 0;
  const isSubmitted = gallery?.status === 'submitted';

  const currentDisplayPhotos = filterMode === 'selected'
    ? photos.filter((p) => selectedIds.has(p.id))
    : photos;

  useEffect(() => {
    if (lightboxIndex !== null) {
      if (currentDisplayPhotos.length === 0) {
        setLightboxIndex(null);
      } else if (lightboxIndex >= currentDisplayPhotos.length) {
        setLightboxIndex(Math.max(0, currentDisplayPhotos.length - 1));
      }
    }
  }, [lightboxIndex, currentDisplayPhotos.length]);

  const currentLightboxPhoto = lightboxIndex !== null && lightboxIndex < currentDisplayPhotos.length
    ? currentDisplayPhotos[lightboxIndex]
    : null;

  return (
    <div className="app-container" style={{ paddingBottom: '7rem' }}>
      {/* Editorial Minimal Navbar */}
      <header className="navbar">
        <div className="brand">
          <span>{gallery?.title}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <ThemeToggle />
        </div>
      </header>

      {/* Gallery Header / Statement */}
      <section
        style={{
          padding: '4.5rem 1.5rem 3rem',
          maxWidth: '1000px',
          margin: '0 auto',
          textAlign: 'center',
        }}
      >
        <p className="mono-meta" style={{ marginBottom: '0.75rem' }}>
          {gallery?.shoot_date}
        </p>

        <h1 className="serif-title" style={{ fontSize: 'clamp(2.4rem, 5vw, 3.8rem)', marginBottom: '1.5rem', lineHeight: 1.1 }}>
          {gallery?.title}
        </h1>

        {gallery?.welcome_text && (
          <p
            style={{
              maxWidth: '620px',
              margin: '0 auto 2rem',
              color: 'var(--text-secondary)',
              fontSize: '0.98rem',
              lineHeight: 1.7,
              fontWeight: 300,
            }}
          >
            {gallery.welcome_text}
          </p>
        )}

        {isSubmitted && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-full)',
              padding: '0.35rem 1rem',
              fontSize: '0.78rem',
              color: 'var(--text-secondary)',
              letterSpacing: '0.04em',
              marginBottom: '1.5rem',
            }}
          >
            <Check size={13} />
            <span>Wybór został zatwierdzony</span>
          </div>
        )}

        {/* Clean Filter Tabs */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1.5rem' }}>
          <button
            onClick={() => setFilterMode('all')}
            className={`btn ${filterMode === 'all' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }}
          >
            Wszystkie ({photos.length})
          </button>
          <button
            onClick={() => setFilterMode('selected')}
            className={`btn ${filterMode === 'selected' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }}
          >
            Wybrane ({selectedCount})
          </button>
        </div>
      </section>

      {/* Masonry Layout */}
      <main className="main-content">
        {currentDisplayPhotos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem 1.5rem', color: 'var(--text-muted)' }}>
            <p className="mono-meta">Brak zdjęć w tym widoku</p>
          </div>
        ) : (
          <div className="masonry-container">
            {currentDisplayPhotos.map((photo, index) => {
              const isSelected = selectedIds.has(photo.id);

              return (
                <div
                  key={photo.id}
                  className={`masonry-item ${isSelected ? 'is-selected' : ''}`}
                  onClick={() => setLightboxIndex(index)}
                >
                  <img
                    src={`/api/media/${photo.thumb_path}`}
                    alt={photo.filename}
                    loading="lazy"
                  />

                  {/* Minimalist Overlay */}
                  <div className="photo-overlay">
                    <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
                      <button
                        onClick={(e) => handleToggleSelection(photo.id, e)}
                        className={`heart-button ${isSelected ? 'selected' : ''}`}
                        title={isSelected ? 'Usuń' : 'Wybierz'}
                      >
                        <Heart size={16} fill={isSelected ? '#ffffff' : 'none'} strokeWidth={2} />
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

      {/* Discreet Sticky Bottom Dock */}
      <div className="selection-dock-container">
        <div className="selection-dock">
          <div className="selection-dock-info">
            <span
              style={{
                color: selectedCount > 0 ? 'var(--accent-heart)' : 'var(--text-muted)',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <Heart size={15} fill={selectedCount > 0 ? 'currentColor' : 'none'} strokeWidth={2} />
            </span>

            <div className="selection-count-pill">
              Wybrano {selectedCount} {maxLimit > 0 ? `z ${maxLimit}` : ''}
            </div>

            {maxLimit > 0 && (
              <div className="selection-progress-bar">
                <div
                  className="selection-progress-fill"
                  style={{
                    width: `${Math.min(100, (selectedCount / maxLimit) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {gallery?.allow_zip_download === 1 && isSubmitted && (
              <a
                href={`/api/client/galleries/${slug}/zip?token=${getClientToken()}`}
                download
                className="btn btn-secondary"
                style={{ fontSize: '0.8rem', padding: '0.45rem 0.85rem' }}
              >
                <Download size={13} />
                Pobierz ZIP
              </a>
            )}

            {!isSubmitted ? (
              <button
                onClick={() => setFinalizeOpen(true)}
                disabled={selectedCount === 0}
                className="btn btn-primary"
                style={{
                  fontSize: '0.82rem',
                  padding: '0.45rem 1rem',
                  borderRadius: 'var(--radius-full)',
                }}
              >
                Wyślij wybór
              </button>
            ) : (
              <span
                style={{
                  fontSize: '0.78rem',
                  letterSpacing: '0.04em',
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                }}
              >
                Wysłano
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Lightbox */}
      {lightboxIndex !== null && currentLightboxPhoto && (
        <div
          className="lightbox-backdrop"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {/* Header */}
          <div className="lightbox-header">
            <div className="lightbox-counter">
              {String(lightboxIndex + 1).padStart(2, '0')} / {String(currentDisplayPhotos.length).padStart(2, '0')} • {currentLightboxPhoto.filename}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button
                onClick={() => handleToggleSelection(currentLightboxPhoto.id)}
                className={`heart-button ${selectedIds.has(currentLightboxPhoto.id) ? 'selected' : ''}`}
                style={{ width: '36px', height: '36px' }}
              >
                <Heart size={16} fill={selectedIds.has(currentLightboxPhoto.id) ? '#ffffff' : 'none'} strokeWidth={2} />
              </button>

              <button
                onClick={() => setLightboxIndex(null)}
                className="btn btn-ghost btn-icon"
                style={{ color: '#ffffff', opacity: 0.8 }}
                title="Zamknij"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Central Image Container */}
          <div className="lightbox-content">
            <button
              onClick={() =>
                setLightboxIndex((prev) =>
                  prev !== null && prev > 0 ? prev - 1 : Math.max(0, currentDisplayPhotos.length - 1)
                )
              }
              className="lightbox-nav-btn lightbox-prev"
            >
              <ChevronLeft size={22} />
            </button>

            <div className="lightbox-image-wrap">
              <img
                src={`/api/media/${currentLightboxPhoto.preview_path}`}
                alt={currentLightboxPhoto.filename}
                className="lightbox-image"
              />
            </div>

            <button
              onClick={() =>
                setLightboxIndex((prev) =>
                  prev !== null && prev < currentDisplayPhotos.length - 1 ? prev + 1 : 0
                )
              }
              className="lightbox-nav-btn lightbox-next"
            >
              <ChevronRight size={22} />
            </button>
          </div>

          {/* Minimal Lightbox Footer */}
          <div className="lightbox-footer">
            <span style={{ fontSize: '0.74rem', color: 'rgba(255, 255, 255, 0.45)', letterSpacing: '0.04em' }}>
              Klawisze: ← Poprzednie • → Następne • Spacja / F Wybór • Esc Zamknij
            </span>

            <span
              style={{
                fontSize: '0.74rem',
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                color: selectedIds.has(currentLightboxPhoto.id) ? 'var(--accent-heart)' : 'rgba(255, 255, 255, 0.5)',
              }}
            >
              {selectedIds.has(currentLightboxPhoto.id) ? 'Wybrane' : 'Niewybrane'}
            </span>
          </div>
        </div>
      )}

      {/* Minimal Finalize Modal */}
      {finalizeOpen && (
        <div className="modal-overlay" onClick={() => setFinalizeOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
              <h2 className="serif-title" style={{ fontSize: '1.6rem' }}>Zatwierdzenie wyboru</h2>
              <button onClick={() => setFinalizeOpen(false)} style={{ color: 'var(--text-muted)' }}>
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', lineHeight: 1.6 }}>
              Liczba wybranych zdjęć: <strong>{selectedCount}</strong> {maxLimit > 0 ? `(w pakiecie: ${maxLimit})` : ''}.
              Po przesłaniu selekcja zostanie zamknięta do edycji i skierowana do obróbki.
            </p>

            <div className="form-group" style={{ marginBottom: '1.5rem' }}>
              <label className="form-label">Wiadomość lub uwagi (opcjonalnie)</label>
              <textarea
                className="form-textarea"
                rows={3}
                value={clientNotes}
                onChange={(e) => setClientNotes(e.target.value)}
                placeholder="Np. dodatkowy retusz, ujęcia czarno-białe..."
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                onClick={() => setFinalizeOpen(false)}
                className="btn btn-secondary"
              >
                Wróć
              </button>

              <button
                type="button"
                onClick={handleFinalize}
                disabled={submittingFinal}
                className="btn btn-primary"
              >
                {submittingFinal ? 'Przesyłanie...' : 'Potwierdź i wyślij'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
