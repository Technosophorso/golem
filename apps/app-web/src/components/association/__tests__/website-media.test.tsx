// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const api=vi.hoisted(()=>({module:vi.fn(),list:vi.fn(),upload:vi.fn(),url:vi.fn(),remove:vi.fn(),confirm:vi.fn()}));
vi.mock('@/lib/api/association',async original=>({...await original<typeof import('@/lib/api/association')>(),getAssociationModuleSnapshot:api.module,listWebsiteMedia:api.list,uploadWebsiteMedia:api.upload,websiteMediaPreviewUrl:api.url,deleteWebsiteMedia:api.remove}));
vi.mock('@/components/ui/confirm-dialog',()=>({confirmDialog:api.confirm}));
vi.mock('@/lib/surface-prefetch',()=>({associationModuleCacheKey:(w:string)=>`association-module:${w}:viewer`,associationPageCacheKey:(w:string,r:string)=>`crm:${w}:viewer:${r}`}));
import { WebsiteMediaPanel } from '../website-media';
import { I18nProvider } from '@/lib/i18n/client';
import { en } from '@/lib/i18n/dictionaries/en';
import { resetSurfaceCache } from '@/lib/surface-cache';
const c=en.associationPage.media;
const photo={id:'11111111-1111-4111-8111-111111111111',name:'hero.jpg',mime:'image/jpeg',sizeBytes:2_400_000,updatedAt:'2026-09-24T00:00:00.000Z'};
const pdf={id:'22222222-2222-4222-8222-222222222222',name:'brochure.pdf',mime:'application/pdf',sizeBytes:40_000,updatedAt:'2026-09-24T00:00:00.000Z'};
let host:HTMLDivElement,root:Root;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
async function render(){await act(async()=>root.render(<I18nProvider locale="en" dict={en}><WebsiteMediaPanel workspaceId="w"/></I18nProvider>));}
const button=(name:string)=>[...host.querySelectorAll('button')].filter(b=>b.textContent===name);
beforeEach(()=>{resetSurfaceCache();vi.resetAllMocks();api.module.mockResolvedValue({canManage:true,module:{state:'enabled'}});api.list.mockResolvedValue([photo,pdf]);api.url.mockResolvedValue('https://acct.blob.core.windows.net/files/x?sig=1');api.confirm.mockResolvedValue(true);api.remove.mockResolvedValue(undefined);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();resetSurfaceCache();});
describe('[COMP:app-web/association] website media library',()=>{
 it('lists files with signed previews for images only',async()=>{await render();expect(host.textContent).toContain('hero.jpg');expect(host.textContent).toContain('2.3 MB');expect(api.url).toHaveBeenCalledTimes(1);expect(api.url).toHaveBeenCalledWith('w',photo.id);expect(host.querySelector('img')?.getAttribute('src')).toContain('blob.core.windows.net');});
 it('uploads the chosen files and refuses oversized ones before sending',async()=>{api.upload.mockResolvedValue([{name:'ok.png',media:{...photo,name:'ok.png'}}]);await render();const input=host.querySelector('input[type=file]') as HTMLInputElement;const ok=new File([new Uint8Array(10)],'ok.png',{type:'image/png'});const big=new File([new Uint8Array(1)],'big.png',{type:'image/png'});Object.defineProperty(big,'size',{value:16*1024*1024});Object.defineProperty(input,'files',{value:[ok,big]});await act(async()=>input.dispatchEvent(new Event('change',{bubbles:true})));expect(api.upload).toHaveBeenCalledWith('w',[ok]);expect(host.textContent).toContain(`${c.rejected}: big.png`);});
 it('confirms before removing and does nothing when cancelled',async()=>{await render();api.confirm.mockResolvedValueOnce(false);await act(async()=>button(c.remove)[0]!.click());expect(api.remove).not.toHaveBeenCalled();await act(async()=>button(c.remove)[0]!.click());expect(api.remove).toHaveBeenCalledWith('w',photo.id);});
 it('lets ordinary members browse but not upload or remove',async()=>{api.module.mockResolvedValue({canManage:false,module:{state:'enabled'}});await render();expect(host.textContent).toContain('hero.jpg');expect(button(c.upload)).toHaveLength(0);expect(button(c.remove)).toHaveLength(0);});
});
