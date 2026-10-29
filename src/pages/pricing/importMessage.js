// An import's problems in words (the BOQ import on the lines page).

export function importMessage(w, errors = []) {
  const E = w.importErrors
  const text = e => {
    switch (e.code) {
      case 'missingColumn': return E.missingColumn(w.columnNames[e.value] || e.value)
      case 'noRows': return E.noRows
      case 'tooMany': return E.tooMany(e.value)
      case 'noDescription': return E.noDescription(e.row)
      case 'noUnit': return E.noUnit(e.row)
      case 'badQuantity': return E.badQuantity(e.row, e.value)
      case 'badCategory': return E.badCategory(e.row, e.value)
      default: return e.code
    }
  }
  const shown = errors.slice(0, 15).map(text)
  const rowed = errors.some(e => e.row)
  return `${rowed ? `${E.nothingImported} ` : ''}${shown.join(' ')}${errors.length > 15 ? ` ${E.moreErrors(errors.length - 15)}` : ''}`
}
