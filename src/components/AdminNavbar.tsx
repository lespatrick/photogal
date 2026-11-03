'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowLeft, Settings, LogOut } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeProvider';

export interface AdminNavbarProps {
  title?: string;
  backHref?: string;
  onOpenSettings?: () => void;
  settingsTitle?: string;
  onLogout?: () => void;
  extraActions?: React.ReactNode;
}

export function AdminNavbar({
  title = 'photogal',
  backHref,
  onOpenSettings,
  settingsTitle = 'Ustawienia',
  onLogout,
  extraActions,
}: AdminNavbarProps) {
  return (
    <header className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: '1 1 auto' }}>
        {backHref && (
          <Link href={backHref} className="btn btn-ghost btn-icon" title="Powrót do listy sesji">
            <ArrowLeft size={16} />
          </Link>
        )}
        <div className="brand" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span>{title}</span>
        </div>
      </div>

      <div className="nav-actions">
        {extraActions}
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="btn btn-secondary nav-btn-responsive"
            title={settingsTitle}
          >
            <Settings size={15} />
            <span className="nav-btn-text">Ustawienia</span>
          </button>
        )}
        <ThemeToggle />
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="btn btn-ghost nav-btn-responsive"
            title="Wyloguj z panelu fotografa"
          >
            <LogOut size={15} />
            <span className="nav-btn-text">Wyloguj</span>
          </button>
        )}
      </div>
    </header>
  );
}

