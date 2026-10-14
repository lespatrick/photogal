'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Fingerprint, KeyRound } from 'lucide-react';
import { startAuthentication } from '@simplewebauthn/browser';
import { ThemeToggle } from '@/components/ThemeProvider';
import { useToast } from '@/components/ToastProvider';

async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text || 'Błąd odpowiedzi serwera' };
  }
}

export default function AdminLoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [hasPasskeys, setHasPasskeys] = useState(false);

  useEffect(() => {
    // Check if any passkeys are registered
    fetch('/api/admin/passkey/login-options')
      .then(parseJsonResponse)
      .then((data) => {
        if (data?.hasRegisteredPasskeys) {
          setHasPasskeys(true);
        }
      })
      .catch(() => {});
  }, []);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await parseJsonResponse(res);

      if (!res.ok) {
        throw new Error(data.error || 'Błąd logowania');
      }

      router.push('/admin');
      router.refresh();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setPasskeyLoading(true);
    try {
      // 1. Get options from server
      const optRes = await fetch('/api/admin/passkey/login-options');
      const optData = await parseJsonResponse(optRes);
      if (!optRes.ok) throw new Error(optData.error || 'Błąd pobierania opcji logowania');

      if (!optData.hasRegisteredPasskeys || !optData.options) {
        toast('Brak zarejestrowanych kluczy Passkey na tym koncie. Zaloguj się hasłem.', 'info');
        return;
      }

      // 2. Trigger native WebAuthn biometric prompt (Touch ID / Face ID)
      const authResponse = await startAuthentication({
        optionsJSON: optData.options,
      });

      // 3. Verify on server
      const verifyRes = await fetch('/api/admin/passkey/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: authResponse,
          challenge: optData.options.challenge,
        }),
      });

      const verifyData = await parseJsonResponse(verifyRes);
      if (!verifyRes.ok) throw new Error(verifyData.error || 'Weryfikacja biometryczna nie powiodła się');

      toast('Zalogowano pomyślnie za pomocą Passkey!', 'success');
      router.push('/admin');
      router.refresh();
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        toast(err.message || 'Błąd logowania Passkey', 'error');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1.5rem',
        backgroundColor: 'var(--bg-primary)',
      }}
    >
      <div style={{ position: 'absolute', top: '1.5rem', right: '1.5rem' }}>
        <ThemeToggle />
      </div>

      <div style={{ width: '100%', maxWidth: '360px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <p className="mono-meta" style={{ marginBottom: '0.6rem' }}>Studio Access</p>
          <h1 className="serif-title" style={{ fontSize: '2.2rem', marginBottom: '0.35rem' }}>
            Panel Fotografa
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem' }}>
            Bezpieczne logowanie biometryczne lub hasłem
          </p>
        </div>

        {/* 1-Click Passkey Login Button */}
        <div style={{ marginBottom: '1.5rem' }}>
          <button
            type="button"
            onClick={handlePasskeyLogin}
            disabled={passkeyLoading}
            className="btn btn-secondary"
            style={{
              width: '100%',
              padding: '0.75rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.6rem',
              fontSize: '0.86rem',
              borderColor: 'var(--border-strong)',
            }}
          >
            <Fingerprint size={18} color="var(--accent-heart)" />
            <span>{passkeyLoading ? 'Oczekiwanie na biometrię...' : 'Zaloguj z Passkey / Touch ID'}</span>
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              margin: '1.5rem 0',
              color: 'var(--text-muted)',
              fontSize: '0.72rem',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
            }}
          >
            <div style={{ flex: 1, height: '1px', background: 'var(--border-hairline)' }} />
            <span style={{ padding: '0 0.75rem' }}>lub hasłem</span>
            <div style={{ flex: 1, height: '1px', background: 'var(--border-hairline)' }} />
          </div>
        </div>

        <form onSubmit={handlePasswordLogin}>
          <div className="form-group">
            <label className="form-label">Użytkownik</label>
            <input
              type="text"
              className="form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="form-group" style={{ marginBottom: '1.75rem' }}>
            <label className="form-label">Hasło</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.75rem', fontSize: '0.86rem' }}
            disabled={loading}
          >
            {loading ? 'Logowanie...' : 'Zaloguj się hasłem'}
            <ArrowRight size={14} />
          </button>
        </form>

      </div>
    </div>
  );
}
