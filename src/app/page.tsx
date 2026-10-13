'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeProvider';

export default function HomePage() {
  const router = useRouter();
  const [gallerySlug, setGallerySlug] = useState('');

  const handleOpenGallery = (e: React.FormEvent) => {
    e.preventDefault();
    if (gallerySlug.trim()) {
      router.push(`/g/${gallerySlug.trim().toLowerCase()}`);
    }
  };

  return (
    <div className="app-container">
      {/* Navbar */}
      <header className="navbar">
        <div className="brand">
          <span>photogal</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <ThemeToggle />
          <Link href="/admin" className="btn btn-secondary" style={{ fontSize: '0.8rem', padding: '0.4rem 0.85rem' }}>
            Panel Fotografa
          </Link>
        </div>
      </header>

      {/* Main Editorial Hero */}
      <main className="main-content" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <section
          style={{
            width: '100%',
            maxWidth: '960px',
            padding: '6rem 1.5rem 4rem',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
          }}
        >
          <p className="mono-meta" style={{ marginBottom: '1.25rem' }}>
            System Selekcji Zdjęć
          </p>

          <h1
            className="serif-title"
            style={{
              fontSize: 'clamp(2.8rem, 6vw, 4.8rem)',
              lineHeight: 1.08,
              maxWidth: '800px',
              marginBottom: '1.75rem',
            }}
          >
            Fotografia w centrum uwagi. Czysta forma selekcji.
          </h1>

          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '1.05rem',
              maxWidth: '560px',
              lineHeight: 1.7,
              fontWeight: 300,
              marginBottom: '3rem',
            }}
          >
            Prywatne galerie z kodem PIN, responsywna siatka kadrów, pełnoekranowy podgląd z gestami oraz natychmiastowy eksport do Lightroom i Capture One.
          </p>

          {/* Quiet Client Access Box */}
          <div
            style={{
              width: '100%',
              maxWidth: '420px',
              marginBottom: '4rem',
            }}
          >
            <form onSubmit={handleOpenGallery} style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="text"
                placeholder="Identyfikator galerii (np. anna-i-piotr-slub)"
                value={gallerySlug}
                onChange={(e) => setGallerySlug(e.target.value)}
                className="form-input"
                style={{
                  flex: 1,
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.86rem',
                }}
              />
              <button
                type="submit"
                className="btn btn-primary"
                style={{ padding: '0.65rem 1.1rem', fontSize: '0.84rem' }}
              >
                Otwórz
                <ArrowRight size={14} />
              </button>
            </form>
          </div>
        </section>

        {/* Minimal Feature Columns */}
        <section
          style={{
            width: '100%',
            maxWidth: '1100px',
            padding: '2rem 1.5rem 6rem',
            borderTop: '1px solid var(--border-hairline)',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '2.5rem',
            }}
          >
            <div>
              <p className="mono-meta" style={{ marginBottom: '0.5rem' }}>01 • Selekcja</p>
              <h3 className="serif-title" style={{ fontSize: '1.4rem', marginBottom: '0.4rem' }}>
                Przejrzysta siatka i Lightbox
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.6, fontWeight: 300 }}>
                Responsywny układ masonry, obsługa gestów swipe na urządzeniach mobilnych oraz strzałek na klawiaturze.
              </p>
            </div>

            <div>
              <p className="mono-meta" style={{ marginBottom: '0.5rem' }}>02 • Eksport</p>
              <h3 className="serif-title" style={{ fontSize: '1.4rem', marginBottom: '0.4rem' }}>
                Lightroom & Capture One
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.6, fontWeight: 300 }}>
                Jedno kliknięcie generuje listę nazw plików gotową do wklejenia w filtrze wyszukiwania programu do retuszu.
              </p>
            </div>

            <div>
              <p className="mono-meta" style={{ marginBottom: '0.5rem' }}>03 • Technologia</p>
              <h3 className="serif-title" style={{ fontSize: '1.4rem', marginBottom: '0.4rem' }}>
                WebP & PWA
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', lineHeight: 1.6, fontWeight: 300 }}>
                Automatyczna kompresja miniatur przy zachowaniu bezstratnych oryginałów do paczki ZIP i druku.
              </p>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-hairline)',
          padding: '2rem 1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.76rem',
          letterSpacing: '0.06em',
        }}
      >
        <p>© 2026 photogal</p>
      </footer>
    </div>
  );
}
