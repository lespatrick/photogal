'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pl">
      <body style={{
        margin: 0,
        padding: '3rem 1.5rem',
        backgroundColor: '#0a0b0e',
        color: '#e2e8f0',
        fontFamily: 'Inter, system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '480px' }}>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 600, marginBottom: '1rem', color: '#f8fafc' }}>
            Wystąpił nieoczekiwany błąd
          </h2>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', lineHeight: 1.6, marginBottom: '2rem' }}>
            Przepraszamy, wystąpił problem podczas przetwarzania żądania. Spróbuj odświeżyć stronę lub powrócić za chwilę.
          </p>
          <button
            onClick={() => reset()}
            style={{
              padding: '0.75rem 1.5rem',
              backgroundColor: '#d4af37',
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.9rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Spróbuj ponownie
          </button>
        </div>
      </body>
    </html>
  );
}

