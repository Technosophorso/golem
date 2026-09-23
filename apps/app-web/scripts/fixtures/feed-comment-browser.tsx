import { useRef, useState } from 'react';
import { CompositionEditor, type FeedEditorSelection } from '@/components/feed/composition-editor';
import { FeedEditorPanel } from '@/components/feed/editor-panel';
import { DraftCommentPanel, type FeedCommentComposer } from '@/components/feed/draft-comment-panel';
import { createFeedAnchor, importLegacyFeed } from '@use-brian/doc-model';
const composition = importLegacyFeed({ text: Array.from({length:20}, (_, i) => `Paragraph ${i + 1}. A fictional orchard grows apples and pears.`).join('\n\n'), postFormat:'post', threadSegments:[], media:[] });
const noop = () => {};
const commands: unknown[] = [];
Object.assign(window, { feedCommentFixture: { commands } });
export function FeedCommentFixture() {
 const [open,setOpen] = useState(false); const [selection,setSelection] = useState<FeedEditorSelection|null>(null); const [composer,setComposer] = useState<FeedCommentComposer|null>(null); const anchor = useRef<HTMLButtonElement>(null);
 return <main className="h-dvh overflow-y-auto p-8"><header className="bg-background"><button ref={anchor} onClick={()=>setOpen(true)}>Comments</button></header><CompositionEditor composition={composition} threads={[]} draftAnchor={composer?.anchor} onEdit={noop} onSelection={next => setSelection(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)} onOpenThread={noop} onAction={kind => {if(kind==='ask')return;setComposer({kind,anchor:createFeedAnchor(composition,selection?.target??{kind:'post'},2)});setOpen(true)}}/><FeedEditorPanel open={open} title="Comments" anchor={anchor.current} onClose={()=>setOpen(false)}><DraftCommentPanel workspaceId="fictional-workspace" assistantId="fictional-writer" assistantName="Writer" sessionId="fictional-draft" composition={composition} revision={2} snapshot={{copy:null,threads:[],suggestions:[]}} pending={false} offline={false} readOnly={false} composer={composer} onComposer={setComposer} selectedThread={null} onThread={noop} onAskBrian={noop} onCommand={async value => {commands.push(value);return true}} onRefresh={noop}/></FeedEditorPanel></main>;
}
