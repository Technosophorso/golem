// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n/client";
import { en } from "@/lib/i18n/dictionaries/en";
import { DesktopAddAccountProvider, openDesktopAddAccount } from "../desktop-add-account";
import type { DesktopBridge } from "@/lib/desktop-auth-source";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const t = en.workspaceSwitcher.addAccountDialog;
let progress: Parameters<NonNullable<DesktopBridge["onAccessAuthState"]>>[0];
let openFromMenu: (url: string) => void;
const runLocal = vi.fn(), addAccount = vi.fn(), unsubscribe = vi.fn();
const button = (label: string) => [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
const click = async (label: string) => { await act(async () => button(label).click()); };
const field = () => document.querySelector('input')!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field(), value);
    field().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function selfHosted() {
  await act(async () => openDesktopAddAccount());
  const choice = [...document.querySelectorAll('button')].find(b => b.textContent?.includes(t.selfHosted))!;
  await act(async () => choice.click());
}
beforeEach(async () => {
  runLocal.mockReset().mockResolvedValue({ ok: false, error: 'unreachable' });
  addAccount.mockReset(); unsubscribe.mockReset();
  window.usebrianDesktop = { signIn: vi.fn(), addAccount, runLocal,
    listAccounts: vi.fn().mockResolvedValue({ accounts: [], canSwitch: true, localAppUrl: 'https://brain.example.com' }),
    onChooseDeployment: callback => { openFromMenu = callback; return unsubscribe; },
    onAccessAuthState: callback => { progress = callback; return vi.fn(); },
  };
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<I18nProvider locale="en" dict={en}><DesktopAddAccountProvider /></I18nProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); delete window.usebrianDesktop; });

describe('[COMP:app-web/desktop-add-account] shared desktop account dialog', () => {
  it('chooses OSS and connects the remembered address only on explicit submit', async () => {
    await selfHosted();
    expect(field().value).toBe('https://brain.example.com');
    expect(runLocal).not.toHaveBeenCalled();
    expect(addAccount).not.toHaveBeenCalled();
    await click(t.connect);
    expect(runLocal).toHaveBeenCalledExactlyOnceWith('https://brain.example.com');
    expect(document.querySelector('[role=alert]')?.textContent).toBe(t.unreachable);
    expect(field().disabled).toBe(false);
    expect(document.querySelector('[role=dialog]')).not.toBeNull();
  });
  it('validates locally, retains editable input on auth failure, and uses the edited address on retry', async () => {
    await selfHosted(); await type('file:///etc/passwd'); await click(t.connect);
    expect(runLocal).not.toHaveBeenCalled();
    expect(document.querySelector('[role=alert]')?.textContent).toBe(t.invalidUrl);
    runLocal.mockResolvedValue({ ok: false, error: 'auth' });
    await type('https://other.example.com'); await click(t.connect);
    expect(runLocal).toHaveBeenLastCalledWith('https://other.example.com');
    expect(document.querySelector('[role=alert]')?.textContent).toBe(t.authError);
    runLocal.mockResolvedValue({ ok: true }); await click(t.connect);
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('shows browser approval while pending, blocks dismissal and duplicate submission, and recovers on rejection', async () => {
    let finish!: (value: unknown) => void;
    runLocal.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await selfHosted(); await click(t.connect);
    await act(async () => progress('browser'));
    expect(document.querySelector('[role=status]')?.textContent).toBe(t.browserApproval);
    expect(button(t.cancel).disabled).toBe(true);
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(runLocal).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: false, error: 'access-auth-failed' }));
    expect(document.querySelector('[role=alert]')?.textContent).toBe(t.approvalError);
    await click(t.cancel);
    expect(document.querySelector('[role=dialog]')).toBeNull();
  });
  it('goes back to Cloud without any self-host request and uses native add-account', async () => {
    await selfHosted(); await click(t.back);
    const cloud = [...document.querySelectorAll('button')].find(b => b.textContent?.includes(t.cloud))!;
    await act(async () => cloud.click());
    expect(addAccount).toHaveBeenCalledOnce();
    expect(runLocal).not.toHaveBeenCalled();
  });
  it('opens the same self-hosted step for a native menu request and preserves thrown transport errors inline', async () => {
    runLocal.mockRejectedValue(new Error('shell unavailable'));
    await act(async () => openFromMenu('http://localhost:3003'));
    expect(field().value).toBe('http://localhost:3003');
    await click(t.connect);
    expect(document.querySelector('[role=alert]')?.textContent).toBe(t.connectionError);
    expect(button(t.connect).disabled).toBe(false);
  });
});
