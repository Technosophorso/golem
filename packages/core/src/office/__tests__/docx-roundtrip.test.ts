import JSZip from 'jszip'
import { snapshotToYDoc, yDocToSnapshot, type DocumentSnapshot } from '@use-brian/office-model'
import { describe, expect, it } from 'vitest'
import { exportOfficeDocument, importOfficeDocument, reparseOfficeDocument } from '../docx/index.js'
import { completeDocumentSnapshot, id, resolveFixtureResource } from './fixtures.js'

describe('[COMP:office/docx-engine] DOCX engine', () => {
  it('exports, safely reparses, and preserves canonical semantics plus layout', async () => {
    const source = completeDocumentSnapshot()
    const exported = await exportOfficeDocument(source, resolveFixtureResource)
    const imported = await importOfficeDocument(exported.bytes, { artifactId: source.artifactId, workspaceId: source.workspaceId, templateVersionId: source.templateVersionId, locale: source.locale, defaultLanguage: source.defaultLanguage, title: source.title })
    const reopened = await reparseOfficeDocument(exported.bytes)
    expect(imported.ok).toBe(true)
    expect(imported.snapshot).toEqual(source)
    expect(reopened.snapshot).toEqual(source)
    expect(reopened.semanticHash).toBe(exported.semanticHash)
    expect(reopened.layoutSerialization).toBe(exported.layoutSerialization)
    const zip = await JSZip.loadAsync(exported.bytes)
    expect(zip.file('word/document.xml')).not.toBeNull()
    expect(zip.file('customXml/brian-office.json')).not.toBeNull()
  })

  it('resolves defaults and style chains and preserves cell paragraphs, tabs and spacing in native XML', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/styles.xml', `<w:styles xmlns:w="w">
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:eastAsia="Synthetic CJK"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:styleId="Base"><w:pPr><w:jc w:val="center"/><w:spacing w:before="40"/></w:pPr><w:rPr><w:b/><w:color w:val="123456"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:basedOn w:val="Base"/><w:pPr><w:spacing w:after="0"/></w:pPr></w:style>
      <w:style w:type="character" w:styleId="Emphasis"><w:rPr><w:i/></w:rPr></w:style>
      <w:style w:type="table" w:styleId="TableBase"><w:tblPr><w:tblCellMar><w:top w:w="0"/><w:left w:w="100"/><w:bottom w:w="20"/><w:right w:w="60"/></w:tblCellMar><w:tblBorders><w:top w:val="single" w:sz="4" w:color="334455"/><w:insideV w:val="single" w:sz="6" w:color="445566"/></w:tblBorders></w:tblPr></w:style>
      <w:style w:type="table" w:default="1" w:styleId="TableDefault"><w:basedOn w:val="TableBase"/></w:style>
    </w:styles>`)
    zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body>
      <w:p><w:r><w:t>Inherited</w:t></w:r></w:p><w:p/>
      <w:tbl><w:tblPr><w:tblBorders><w:top w:val="nil"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1600"/><w:gridCol w:w="3200"/></w:tblGrid><w:tr><w:trPr><w:trHeight w:val="720"/></w:trPr>
        <w:tc><w:tcPr><w:tcMar><w:left w:w="0"/></w:tcMar></w:tcPr>
          <w:p><w:pPr><w:spacing w:line="280" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rStyle w:val="Emphasis"/><w:b w:val="0"/></w:rPr><w:t>Alpha</w:t><w:tab/><w:t>Beta</w:t><w:br/><w:t>Gamma</w:t></w:r></w:p>
          <w:p/><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:line="400" w:lineRule="atLeast" w:before="0"/></w:pPr><w:r><w:t>Delta</w:t></w:r></w:p>
        </w:tc><w:tc><w:p><w:r><w:t>Other</w:t></w:r></w:p></w:tc>
      </w:tr></w:tbl></w:body></w:document>`)
    const context = { artifactId: id(60), workspaceId: id(2), templateVersionId: null, locale: 'en-US', defaultLanguage: 'en-US', title: 'Synthetic formatting' }
    const result = await importOfficeDocument(await zip.generateAsync({ type: 'nodebuffer' }), context)
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    if (result.snapshot?.family !== 'document') throw new Error('document required')
    expect(result.snapshot.sections[0].nodes[0]).toMatchObject({ alignment: 'center', spacingBeforePt: 2, spacingAfterPt: 0, lineSpacingMultiple: 1.5, runs: [expect.objectContaining({ style: expect.objectContaining({ fontFamily: 'Georgia', fontSizePt: 12, bold: true, color: '#123456' }) })] })
    expect(result.snapshot.sections[0].nodes[1].kind).toBe('paragraph')
    const table = result.snapshot.sections[0].nodes[2]
    if (table.kind !== 'table') throw new Error('table required')
    expect(table).toMatchObject({ columnWidthsPt: [80, 160], margins: { topPt: 0, rightPt: 3, bottomPt: 1, leftPt: 5 }, borders: { top: { style: 'none' }, insideVertical: { widthPt: 0.75 } } })
    expect(table.rows[0].cells[0].margins?.leftPt).toBe(0)
    const runs = table.rows[0].cells[0].runs
    expect(runs.map((run) => run.text)).toEqual(['Alpha\tBeta\nGamma', '', 'Delta'])
    expect(runs[0]).toMatchObject({ style: { bold: false, italic: true, eastAsianFontFamily: 'Synthetic CJK' }, paragraphStart: { lineSpacingPt: 14, lineSpacingRule: 'exact', spacingAfterPt: 0 } })
    expect(runs[2].paragraphStart).toMatchObject({ alignment: 'end', lineSpacingPt: 20, lineSpacingRule: 'atLeast', spacingBeforePt: 0 })
    const collaborative = snapshotToYDoc(result.snapshot)
    expect(yDocToSnapshot(collaborative)).toEqual(result.snapshot)
    collaborative.destroy()
    const exported = await exportOfficeDocument(result.snapshot, resolveFixtureResource)
    expect((await reparseOfficeDocument(exported.bytes)).snapshot).toEqual(result.snapshot)
    const nativeZip = await JSZip.loadAsync(exported.bytes)
    const native = await nativeZip.file('word/document.xml')!.async('string')
    expect(native).toContain('w:lineRule="exact"')
    expect(native).toContain('w:lineRule="atLeast"')
    expect(native).toContain('w:eastAsia="Synthetic CJK"')
    expect(native).toMatch(/<w:bottom[^>]*w:val="none"/)
    expect(native).toContain('<w:tab/>')
    expect(native).toContain('<w:cr/>')
    const firstCell = native.match(/<w:tc>[\s\S]*?<\/w:tc>/)![0]
    expect([...firstCell.matchAll(/<w:p[ >]/g)]).toHaveLength(3)
    // Do not let the embedded canonical part conceal a native-export regression.
    nativeZip.remove('customXml/brian-office.json')
    const nativeImport = await importOfficeDocument(await nativeZip.generateAsync({ type: 'nodebuffer' }), context)
    expect(nativeImport.ok, JSON.stringify(nativeImport.diagnostics)).toBe(true)
    const nativeTable = nativeImport.snapshot?.family === 'document' ? nativeImport.snapshot.sections[0].nodes.find((node) => node.kind === 'table') : undefined
    expect(nativeTable?.kind === 'table' && nativeTable.rows[0].cells[0].runs.map((run) => run.text).join('')).toBe('Alpha\tBeta\nGammaDelta')
  })

  it.each([false, true])('applies inherited bold/italic as toggles and direct values absolutely (defaults=%s)', async (defaultOn) => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/styles.xml', `<w:styles><w:docDefaults><w:rPrDefault><w:rPr><w:b w:val="${defaultOn ? 1 : 0}"/><w:i w:val="${defaultOn ? 1 : 0}"/></w:rPr></w:rPrDefault></w:docDefaults>
      <w:style w:styleId="Base" w:type="paragraph"><w:rPr><w:b/><w:i/></w:rPr></w:style>
      <w:style w:styleId="Derived" w:type="paragraph"><w:basedOn w:val="Base"/><w:rPr><w:b/><w:i/></w:rPr></w:style>
      <w:style w:styleId="NoToggle" w:type="paragraph"><w:basedOn w:val="Base"/><w:rPr><w:b w:val="0"/><w:i w:val="false"/></w:rPr></w:style>
      <w:style w:styleId="CharBase" w:type="character"><w:rPr><w:b/><w:i/></w:rPr></w:style>
      <w:style w:styleId="CharDerived" w:type="character"><w:basedOn w:val="CharBase"/><w:rPr><w:b/><w:i/></w:rPr></w:style>
    </w:styles>`)
    const cases: Array<[string, string, boolean]> = [
      ['Derived', '', defaultOn], ['Derived', '<w:b/><w:i/>', true], ['Derived', '<w:b w:val="0"/><w:i w:val="off"/>', false],
      ['Base', '<w:b w:val="false"/><w:i w:val="0"/>', false], ['NoToggle', '', !defaultOn],
      ['Base', '<w:rStyle w:val="CharDerived"/>', !defaultOn], ['Base', '<w:rStyle w:val="CharBase"/>', defaultOn],
    ]
    zip.file('word/document.xml', `<w:document><w:body>${cases.map(([style, direct], index) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:rPr>${direct}</w:rPr><w:t>Sample ${index}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`)
    const context = { artifactId: id(60), workspaceId: id(2), templateVersionId: null, locale: 'en-US', defaultLanguage: 'en-US', title: 'Synthetic toggles' }
    const result = await importOfficeDocument(await zip.generateAsync({ type: 'nodebuffer' }), context)
    expect(result.ok, JSON.stringify(result.diagnostics)).toBe(true)
    if (result.snapshot?.family !== 'document') throw new Error('document required')
    const expected = cases.map(([, , value]) => ({ bold: value, italic: value }))
    const emphasis = (snapshot: DocumentSnapshot) => snapshot.sections[0].nodes.filter((node) => node.kind === 'paragraph').map((node) => ({ bold: node.runs[0].style.bold, italic: node.runs[0].style.italic }))
    expect(emphasis(result.snapshot)).toEqual(expected)
    const exported = await exportOfficeDocument(result.snapshot, resolveFixtureResource)
    const native = await JSZip.loadAsync(exported.bytes)
    native.remove('customXml/brian-office.json')
    const reopened = await importOfficeDocument(await native.generateAsync({ type: 'nodebuffer' }), context)
    expect(reopened.ok).toBe(true)
    if (reopened.snapshot?.family !== 'document') throw new Error('document required')
    expect(emphasis(reopened.snapshot)).toEqual(expected)
  })

  it('bounds cyclic styles and reports unsupported formatting without copying source content', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/styles.xml', '<w:styles><w:style w:styleId="A" w:type="paragraph" w:default="1"><w:basedOn w:val="B"/></w:style><w:style w:styleId="B"><w:basedOn w:val="A"/></w:style></w:styles>')
    zip.file('word/document.xml', '<w:document><w:body><w:p><w:pPr><w:tabs><w:tab w:pos="1000"/></w:tabs></w:pPr><w:r><w:rPr><w:w w:val="80"/></w:rPr><w:t>Example</w:t></w:r></w:p></w:body></w:document>')
    const result = await importOfficeDocument(await zip.generateAsync({ type: 'nodebuffer' }), { artifactId: id(60), workspaceId: id(2), templateVersionId: null, locale: 'en-US', defaultLanguage: 'en-US', title: 'Synthetic limits' })
    expect(result.ok).toBe(true)
    expect(result.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['docx.formatting.tab_stops', 'docx.formatting.style_chain']))
    expect(JSON.stringify(result.diagnostics)).not.toContain('Example')
    expect(result.snapshot?.family === 'document' && result.snapshot.sections[0].nodes[0]).toMatchObject({ spacingAfterPt: 0, runs: [expect.objectContaining({ style: expect.objectContaining({ widthScalePercent: 80 }) })] })
  })

  it('normalizes a conventional external DOCX and never partially admits active content', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/document.xml', '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Hello Office</w:t></w:r></w:p></w:body></w:document>')
    const bytes = await zip.generateAsync({ type: 'nodebuffer' })
    const result = await importOfficeDocument(bytes, { artifactId: id(60), workspaceId: id(2), templateVersionId: id(3), locale: 'en-US', defaultLanguage: 'en-US', title: 'Imported' })
    expect(result.ok).toBe(true)
    expect(result.snapshot?.family).toBe('document')

    zip.file('word/vbaProject.bin', Buffer.from('macro'))
    const rejected = await importOfficeDocument(await zip.generateAsync({ type: 'nodebuffer' }), { artifactId: id(61), workspaceId: id(2), templateVersionId: id(3), locale: 'en-US', defaultLanguage: 'en-US', title: 'Rejected' })
    expect(rejected.ok).toBe(false)
    expect(rejected.diagnostics).toContainEqual(expect.objectContaining({ code: 'package.active_content' }))
  })

  it.each([
    ['hyperlink', 'http://example.com/reference', true],
    ['hyperlink', 'https://example.com/reference', true],
    ['hyperlink', 'mailto:writer@example.com', true],
    ['hyperlink', 'javascript:alert(1)', false],
    ['hyperlink', 'file:///tmp/reference', false],
    ['hyperlink', 'data:text/plain,reference', false],
    ['image', 'http://example.com/image.png', false],
    ['attachedTemplate', 'https://example.com/template.dotx', false],
    ['unknown', 'https://example.com/resource', false],
  ])('validates conventional external relationship %s %s (allowed=%s)', async (type, target, allowed) => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/document.xml', '<w:document xmlns:w="w" xmlns:r="r"><w:body><w:p><w:hyperlink r:id="rLink"><w:r><w:t>Reference</w:t></w:r></w:hyperlink></w:p></w:body></w:document>')
    zip.file('word/_rels/document.xml.rels', `<Relationships><Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}" TargetMode="External"/></Relationships>`)
    const result = await importOfficeDocument(await zip.generateAsync({ type: 'nodebuffer' }), { artifactId: id(60), workspaceId: id(2), templateVersionId: null, locale: 'en-US', defaultLanguage: 'en-US', title: 'Linked document' })
    expect(result.ok).toBe(allowed)
    if (!allowed) expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'package.external_relationship' }))
  })

  it('round-trips canonical HTTP hyperlinks without rewriting their targets', async () => {
    const source = completeDocumentSnapshot()
    const paragraph = source.sections[0].nodes.find((node) => node.kind === 'paragraph')!
    if (paragraph.kind !== 'paragraph') throw new Error('Expected paragraph')
    paragraph.runs[0].href = 'http://example.com/reference'
    const exported = await exportOfficeDocument(source, resolveFixtureResource)
    const reopened = await reparseOfficeDocument(exported.bytes)
    expect(reopened.snapshot).toEqual(source)
  })

  it('preserves conventional Word table grids, merged cells, fills, borders, margins, and alignment', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body><w:tbl>
      <w:tblPr><w:tblW w:w="6400" w:type="dxa"/><w:jc w:val="center"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/>
        <w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:start w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:end w:w="80" w:type="dxa"/></w:tblCellMar>
        <w:tblBorders><w:top w:val="single" w:sz="5" w:color="DCE9EE"/><w:start w:val="single" w:sz="5" w:color="DCE9EE"/><w:bottom w:val="single" w:sz="9" w:color="34D3FF"/><w:end w:val="single" w:sz="5" w:color="DCE9EE"/><w:insideH w:val="single" w:sz="5" w:color="DCE9EE"/><w:insideV w:val="single" w:sz="5" w:color="DCE9EE"/></w:tblBorders>
      </w:tblPr>
      <w:tblGrid><w:gridCol w:w="1600"/><w:gridCol w:w="3200"/><w:gridCol w:w="1600"/></w:tblGrid>
      <w:tr><w:trPr><w:tblHeader/><w:trHeight w:val="360" w:hRule="atLeast"/></w:trPr>
        <w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="131A24"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New"/><w:b/><w:color w:val="34D3FF"/><w:sz w:val="15"/></w:rPr><w:t>INVOICE</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:shd w:fill="E8F8FC"/></w:tcPr><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="17"/></w:rPr><w:t>INV-001</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge w:val="restart"/><w:shd w:fill="131A24"/></w:tcPr><w:p><w:r><w:t>TOTAL</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="E8F8FC"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:t>100.00</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="34D3FF"/></w:tcPr><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:b/><w:t>BALANCE 100.00</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`)

    const result = await importOfficeDocument(await zip.generateAsync({ type: 'nodebuffer' }), { artifactId: id(80), workspaceId: id(2), templateVersionId: id(3), locale: 'en-US', defaultLanguage: 'en-US', title: 'Styled invoice' })
    expect(result.ok).toBe(true)
    expect(result.snapshot?.family).toBe('document')
    if (result.snapshot?.family !== 'document') throw new Error('Expected document')
    const table = result.snapshot.sections[0].nodes[0]
    expect(table).toMatchObject({ kind: 'table', headerRows: 1, columnWidthsPt: [80, 160, 80], widthPt: 320, alignment: 'center', indentPt: 6, layout: 'fixed', margins: { topPt: 2, rightPt: 4, bottomPt: 2, leftPt: 4 }, borders: { bottom: { color: '#34D3FF', widthPt: 1.125, style: 'solid' } } })
    if (table.kind !== 'table') throw new Error('Expected table')
    expect(table.rows[0].minHeightPt).toBe(18)
    expect(table.rows[0].cells[0]).toMatchObject({ colSpan: 2, fill: '#131A24', alignment: 'center', verticalAlignment: 'middle', runs: [expect.objectContaining({ style: expect.objectContaining({ fontFamily: 'Courier New', fontSizePt: 7.5, bold: true, color: '#34D3FF' }) })] })
    expect(table.rows[1].cells[0]).toMatchObject({ rowSpan: 2, fill: '#131A24' })
    expect(table.rows[2].cells).toHaveLength(1)
    expect(table.rows[2].cells[0]).toMatchObject({ colSpan: 2, fill: '#34D3FF', alignment: 'end' })

    const exported = await exportOfficeDocument(result.snapshot)
    const exportedXml = await (await JSZip.loadAsync(exported.bytes)).file('word/document.xml')!.async('string')
    expect(exportedXml).toContain('w:w="1600"')
    expect(exportedXml).toContain('w:fill="131A24"')
    expect(exportedXml).toContain('w:gridSpan w:val="2"')
    expect(exportedXml).toContain('w:vMerge w:val="restart"')
    expect(exportedXml).toContain('w:tblHeader')
  })

  it('preserves conventional letterhead geometry, typography, logo, and rules through canonical export', async () => {
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('word/document.xml', `<w:document xmlns:w="w" xmlns:r="r"><w:body>
      <w:p><w:pPr><w:pStyle w:val="LetterDate"/><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="19"/></w:rPr><w:t>{{LETTER_DATE}}</w:t></w:r></w:p>
      <w:p><w:pPr><w:pStyle w:val="LetterSubject"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:color w:val="10202C"/><w:sz w:val="21"/></w:rPr><w:t>{{SUBJECT}}</w:t></w:r></w:p>
      <w:sectPr><w:titlePg/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2268" w:right="1247" w:bottom="1361" w:left="1247"/><w:headerReference w:type="default" r:id="rHeader"/><w:footerReference w:type="first" r:id="rFooterFirst"/><w:footerReference w:type="default" r:id="rFooterDefault"/></w:sectPr>
    </w:body></w:document>`)
    zip.file('word/styles.xml', `<w:styles xmlns:w="w">
      <w:style w:type="paragraph" w:styleId="LetterDate"><w:pPr><w:spacing w:before="0" w:after="320" w:line="240"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="LetterSubject"><w:pPr><w:spacing w:before="260" w:after="200" w:line="240"/></w:pPr></w:style>
    </w:styles>`)
    zip.file('word/_rels/document.xml.rels', '<Relationships><Relationship Id="rHeader" Target="header1.xml"/><Relationship Id="rFooterFirst" Target="footer1.xml"/><Relationship Id="rFooterDefault" Target="footer2.xml"/></Relationships>')
    zip.file('word/header1.xml', '<w:hdr xmlns:w="w" xmlns:r="r" xmlns:a="a" xmlns:wp="wp"><w:tbl><w:tblPr><w:tblBorders><w:bottom w:val="single" w:sz="12" w:color="34D3FF"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:p><w:r><w:drawing><wp:inline><wp:extent cx="270000" cy="270000"/><wp:docPr descr="Company logo"/><a:blip r:embed="rImage"/></wp:inline></w:drawing></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:b/><w:color w:val="10202C"/><w:sz w:val="25"/></w:rPr><w:t>Use Brian</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:hdr>')
    zip.file('word/_rels/header1.xml.rels', '<Relationships><Relationship Id="rImage" Target="media/logo.png"/></Relationships>')
    const logo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64')
    zip.file('word/media/logo.png', logo)
    zip.file('word/footer1.xml', '<w:ftr xmlns:w="w"><w:p><w:pPr><w:jc w:val="left"/></w:pPr></w:p><w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="6" w:color="DCE9EE"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Courier New"/><w:b/><w:color w:val="0EA5E9"/><w:sz w:val="15"/></w:rPr><w:t>USEBRIAN.AI</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:ftr>')
    zip.file('word/footer2.xml', '<w:ftr xmlns:w="w"><w:p><w:r><w:t>PAGE 2</w:t></w:r></w:p></w:ftr>')
    const result = await importOfficeDocument(await zip.generateAsync({ type: 'nodebuffer' }), { artifactId: id(70), workspaceId: id(2), templateVersionId: id(3), locale: 'en-US', defaultLanguage: 'en-US', title: 'Letterhead' })
    expect(result.ok).toBe(true)
    expect(result.resources).toHaveLength(1)
    expect(result.snapshot?.family).toBe('document')
    if (result.snapshot?.family !== 'document') throw new Error('Expected document')
    const section = result.snapshot.sections[0]
    expect(section.page).toMatchObject({ widthPt: 595.3, heightPt: 841.9, marginTopPt: 113.4, marginLeftPt: 62.35 })
    expect(section.header.map((run) => run.text).join('')).toBe('Use Brian')
    expect(section.headerImage).toMatchObject({ altText: 'Company logo' })
    expect(section.headerImage?.widthPt).toBeCloseTo(21.26, 1)
    expect(section.headerBorderBottom).toEqual({ color: '#34D3FF', widthPt: 1.5 })
    expect(section.footer.map((run) => run.text).join('')).toBe('USEBRIAN.AI')
    expect(section.footerAlignment).toBe('end')
    expect(section.footerBorderTop).toEqual({ color: '#DCE9EE', widthPt: 0.75 })
    expect(section.nodes[0]).toMatchObject({ kind: 'paragraph', alignment: 'end', styleName: 'LetterDate', spacingAfterPt: 16, lineSpacingMultiple: 1, runs: [expect.objectContaining({ style: expect.objectContaining({ fontFamily: 'Arial', fontSizePt: 9.5 }) })] })
    expect(section.nodes[1]).toMatchObject({ kind: 'paragraph', styleName: 'LetterSubject', spacingBeforePt: 13, spacingAfterPt: 10, lineSpacingMultiple: 1, runs: [expect.objectContaining({ style: expect.objectContaining({ bold: true, color: '#10202C', fontSizePt: 10.5 }) })] })
    const resource = result.resources[0]
    const exported = await exportOfficeDocument(result.snapshot, async (resourceId) => resourceId === resource.ref.id ? { bytes: resource.bytes, mime: resource.ref.mime } : null)
    const exportedZip = await JSZip.loadAsync(exported.bytes)
    const exportedXml = await exportedZip.file('word/document.xml')!.async('string')
    expect(exportedXml).toContain('w:after="320"')
    expect(exportedXml).not.toContain('w:pStyle w:val="LetterDate"')
    const reopened = await reparseOfficeDocument(exported.bytes)
    expect(reopened.snapshot).toEqual(result.snapshot)
  })
})
