/** Page-like authoring over the portable Feed schema. [COMP:app-web/feed-editor-markdown] */
import { InputRule, inputRules, wrappingInputRule } from '@tiptap/pm/inputrules';
import { Plugin } from '@tiptap/pm/state';
import { Fragment, Slice } from '@tiptap/pm/model';
import { feedSchema, importFeedMarkdown, parseFeedInline, validateFeedComposition } from '@use-brian/doc-model';

export function feedMarkdownInputRules() {
  const { nodes, marks } = feedSchema;
  return inputRules({ rules: [
    new InputRule(/^(#{1,6})\s$/, (state, match, start, end) => {
      const block = state.selection.$from.parent;
      if (block.type !== nodes.paragraph) return null;
      return state.tr.delete(start, end).setBlockType(start, start, nodes.heading!, { id: block.attrs.id, level: match[1]!.length });
    }),
    wrappingInputRule(/^\s*([-+*])\s$/, nodes.bulletList!),
    wrappingInputRule(/^([1-9]\d{0,8})\.\s$/, nodes.orderedList!, match => ({ start: Number(match[1]) }), (match, before) => before.attrs.start + before.childCount === Number(match[1])),
    wrappingInputRule(/^>\s$/, nodes.blockquote!),
    new InputRule(/\*\*([^*\n]+)\*\*$/, (state, match, start, end) =>
      state.tr.insertText(match[1]!, start, end).addMark(start, start + match[1]!.length, marks.bold!.create()).removeStoredMark(marks.bold!)),
    new InputRule(/(?<!\*)\*([^*\n]+)\*$/, (state, match, start, end) =>
      state.tr.insertText(match[1]!, start, end).addMark(start, start + match[1]!.length, marks.italic!.create()).removeStoredMark(marks.italic!)),
    new InputRule(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/, (state, match, start, end) => {
      if (match[2]!.length > 2048) return null;
      try { new URL(match[2]!); } catch { return null; }
      return state.tr.insertText(match[1]!, start, end).addMark(start, start + match[1]!.length, marks.link!.create({ href: match[2] })).removeStoredMark(marks.link!);
    }),
  ] });
}

/** Unsupported blocks stay literal instead of being reinterpreted piecemeal. */
export function feedMarkdownSlice(text: string): Slice | null {
  if (!text.trim() || text.length > 100_000 || /(^|\n)\s*(```|~~~|\|)|(^|\n)\s*[-+*] \[[ xX]\]|(^|\n)\s*:?-{3,}:?\s*\||<\/?[a-z][^>]*>|!\[/i.test(text)) return null;
  const blockSyntax = /(^|\n)(#{1,6} |[-*+] |\d+\. |> ?)/.test(text) || /\n\s*\n/.test(text);
  if (blockSyntax) {
    const content = importFeedMarkdown(text.replace(/(^|\n)\+ /g, '$1- '));
    try { validateFeedComposition({ version: 1, segments: [{ id: crypto.randomUUID(), content }] }); } catch { return null; }
    const doc = feedSchema.nodeFromJSON({ type: 'doc', content });
    return new Slice(doc.content, 0, 0);
  }
  const inline = parseFeedInline(text);
  if (!inline.some(node => node.type === 'text' && node.marks?.length)) return null;
  try { validateFeedComposition({ version: 1, segments: [{ id: crypto.randomUUID(), content: [{ type: 'paragraph', attrs: { id: crypto.randomUUID() }, content: inline }] }] }); } catch { return null; }
  return new Slice(Fragment.fromArray(inline.map(node => feedSchema.nodeFromJSON(node))), 0, 0);
}

export function feedMarkdownPaste() {
  let plainPaste = false;
  return new Plugin({ props: {
    handleKeyDown(_view, event) {
      plainPaste = (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'v';
      return false;
    },
    handleDOMEvents: { keyup() { plainPaste = false; return false; } },
    handlePaste(view, event) {
      const literal = plainPaste; plainPaste = false;
      if (!view.editable || literal || event.clipboardData?.getData('text/html').trim()) return false;
      const slice = feedMarkdownSlice(event.clipboardData?.getData('text/plain') ?? '');
      if (!slice) return false;
      view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
      return true;
    },
  } });
}
