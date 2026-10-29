import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { fetchLeads, fetchSuppliers, fetchCatalogItems, fetchCurrencies, fetchPeople, fetchSettings } from '../../lib/pricing/client'

// The Pricing pages load the same things first: the opportunities, suppliers
// and catalog items a pricing user may pick from (without holding the CRM,
// Contacts or Catalog), the currencies, the people for "by", and the
// company's minimum margin.

export { field, fieldInline } from '../contacts/useContactsBook'

export const sheetHref = id => `/pricing/sheet?id=${id}`
export const quoteHref = id => `/pricing/quote?id=${id}`

const byId = rows => Object.fromEntries((rows || []).map(r => [r.id, r]))

export function usePricingBase() {
  const { activeWorkspaceId: ws } = useAuth()
  const [base, setBase] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    if (!ws) return
    const [leads, suppliers, items, currencies, people, settings] = await Promise.all([
      fetchLeads(ws), fetchSuppliers(ws), fetchCatalogItems(ws), fetchCurrencies(), fetchPeople(ws), fetchSettings(ws),
    ])
    setBase({ leads: leads.rows, suppliers: suppliers.rows, items: items.rows, currencies: currencies.rows, people: people.rows, minMargin: settings.minMargin })
    setError(leads.error || suppliers.error || items.error || currencies.error || people.error || settings.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])
  const maps = useMemo(() => ({
    leadsById: byId(base?.leads), suppliersById: byId(base?.suppliers), itemsById: byId(base?.items),
    peopleById: Object.fromEntries((base?.people || []).map(p => [p.user_id, p.name])),
  }), [base])
  return { ws, base, ...maps, error, reload: load }
}
