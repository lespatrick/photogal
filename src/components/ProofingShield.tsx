'use client';

import React from 'react';
import { Shield, Lock } from 'lucide-react';

interface ProofingDecoyLightboxProps {
  galleryTitle?: string;
  slug?: string;
}

export function ProofingDecoyLightbox({ galleryTitle, slug }: ProofingDecoyLightboxProps) {
  const sessionHash = slug ? slug.toUpperCase().slice(0, 8) : 'PROOF';

  return (
    <div className="proofing-decoy-lightbox" aria-hidden="true">
      <div className="proofing-watermark-pattern" />

      <div className="proofing-card">
        <div className="proofing-card-icon">
          <Shield size={28} strokeWidth={1.5} />
        </div>

        <p className="proofing-card-kicker">Photogal Studio • Proofing Shield</p>
        <h3 className="proofing-card-title">Podgląd Autorski</h3>
        <p className="proofing-card-subtitle">Tryb zabezpieczenia przed zrzutem ekranu</p>

        <p className="proofing-card-text">
          Wykryto próbę wykonania zrzutu ekranu lub kopiowania obrazu. Prezentowane materiały
          podlegają ochronie prawnej. Dostęp do plików w pełnej jakości następuje po zatwierdzeniu selekcji.
        </p>

        <div className="proofing-card-divider" />

        <div className="proofing-card-footer">
          <span className="mono-meta">
            {galleryTitle ? `${galleryTitle} • ` : ''}ID: SEC-{sessionHash}
          </span>
          <span className="mono-meta">CHRONIONY ZNAKIEM WODNYM</span>
        </div>
      </div>
    </div>
  );
}

export function ProofingDecoyGrid({ slug }: { slug?: string }) {
  return (
    <div className="proofing-decoy-grid" aria-hidden="true">
      <div className="proofing-watermark-pattern" />
      <div className="proofing-grid-badge">
        <Lock size={16} strokeWidth={1.75} />
        <span className="proofing-grid-text">PODGLĄD AUTORSKI</span>
        <span className="proofing-grid-subtext">CHRONIONY</span>
      </div>
    </div>
  );
}

export function PrintProofingNotice({ galleryTitle, slug }: ProofingDecoyLightboxProps) {
  return (
    <div className="print-proofing-notice" aria-hidden="true">
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '2rem', fontStyle: 'italic', marginBottom: '0.5rem' }}>
        photogal
      </h2>
      <p style={{ letterSpacing: '0.15em', textTransform: 'uppercase', fontSize: '0.75rem', marginBottom: '2rem', opacity: 0.7 }}>
        Studio Proofing & Selection System
      </p>

      <div style={{ borderTop: '1px solid #000', borderBottom: '1px solid #000', padding: '2rem 1rem', margin: '2rem 0' }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem', marginBottom: '1rem' }}>
          Podgląd Autorski — Druk Zablokowany
        </h3>
        <p style={{ fontSize: '0.9rem', lineHeight: 1.6, maxWidth: '520px', margin: '0 auto' }}>
          Prezentowane w galerii materiały fotograficzne stanowią wyłączną własność intelektualną autora.
          Wydruk próbny, kopiowanie oraz nieautoryzowane powielanie bez licencji komercyjnej jest prawnie zabronione.
        </p>
      </div>

      <p className="mono-meta" style={{ fontSize: '0.75rem' }}>
        {galleryTitle ? `Galeria: ${galleryTitle} • ` : ''}Ref: {slug ? slug.toUpperCase() : 'STUDIO'}
      </p>
    </div>
  );
}

