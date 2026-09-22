import JSZip from 'jszip'

/** Synthetic Word shape: nine declared levels, only level zero referenced. */
export async function nineLevelNumberingFixture(referencedLevel = 0): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  const definition = (id: number, format: string) => `<w:abstractNum w:abstractNumId="${id}">${Array.from({ length: 9 }, (_, level) => `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${level === 0 ? format : 'ideographTraditional'}"/><w:lvlText w:val="%${level + 1})"/>${level ? '<w:lvlRestart w:val="1"/>' : '<w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr>'}</w:lvl>`).join('')}</w:abstractNum><w:num w:numId="${id}"><w:abstractNumId w:val="${id}"/></w:num>`
  zip.file('word/numbering.xml', `<w:numbering>${definition(1, 'upperRoman')}${definition(2, 'upperLetter')}</w:numbering>`)
  const paragraph = (id: number, index: number) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${referencedLevel}"/><w:numId w:val="${id}"/></w:numPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="20"/><w:w w:val="80"/></w:rPr><w:t>Section ${index}</w:t></w:r></w:p>`
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body>${paragraph(1, 1)}${paragraph(1, 2)}${paragraph(2, 3)}<w:tbl><w:tr><w:tc>${paragraph(2, 4)}</w:tc></w:tr></w:tbl>${paragraph(2, 5)}${paragraph(2, 6)}</w:body></w:document>`)
  return zip.generateAsync({ type: 'uint8array' })
}
