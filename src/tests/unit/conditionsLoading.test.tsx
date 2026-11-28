import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const api = vi.fn();
vi.mock('@/services/apiClient', async importActual => ({
  ...(await importActual<typeof import('@/services/apiClient')>()),
  api: (...a: unknown[]) => api(...a),
  ensureSession: async () => true,
  getSession: () => ({ token: 't', userId: 'u1', mode: 'local-dev' }),
}));
import { useConditions } from '@/services/conditions';

const Card: React.FC = () => { const s = useConditions(); return <span>{s.state}</span>; };

describe('destination conditions loading', () => {
  it('one request for every card on screen, even when the profile refresh fires auth-change', async () => {
    let resolve!: (v: unknown) => void;
    api.mockImplementation(() => new Promise(r => { resolve = r; }));
    const { getAllByText } = render(<React.StrictMode><Card /><Card /></React.StrictMode>);
    act(() => { window.dispatchEvent(new Event('auth-change')); window.dispatchEvent(new Event('auth-change')); });
    expect(api).toHaveBeenCalledTimes(1);                      // was 5 before the fix
    await act(async () => resolve({ places: [{ place_id: 'paris' }] }));
    await waitFor(() => expect(getAllByText('ready')).toHaveLength(2));
    act(() => { window.dispatchEvent(new Event('auth-change')); });
    expect(api).toHaveBeenCalledTimes(1);                      // same user, fresh data: no refetch
  });
});
