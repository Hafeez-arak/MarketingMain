// The phishing "Request for Quotation" that came out QUALIFIED / Verified
// (lead 8bfaffbe, info@ Junk folder, 2026-10-23). Kept as it arrived, with
// the hijacked school's address and the tracking ids swapped for made-up
// ones: this repo is public. The shape is what matters: the From "address"
// was a chain of tracking redirects ending in someone's mailbox, the body
// named nothing, and the model read the sender as a psychotherapy school
// and still said Verified.

/** The tail of the chain: the hijacked mailbox (made up, same shape). */
export const HIJACKED = 'r.rossi@psicoterapia-scuola.it'

/** The From value as Graph handed it over (the stored `email` column). */
export const RAW_FROM = '49527/x1abc2d3.r.us_west_2.awstrack.me/l0/%2f%2fspectrumbusiness.net%2fbilling%2f/2/0101019000000000000000000000000000000000000000000000000/abcdefghijklmnopqrstuvwxyz=439/us02web.zoom.no/j/81100000000?pwd=abcdefghijklmnopqrstuvwxyzabcd.1-'
  + HIJACKED

export const BODY = 'We have an upcoming project and are currently looking for pricing. Could you please confirm whether you are available to provide a quote?\n\nIf so, we will be happy to send over the full project details.\n\nLooking forward to your reply.\n\nTerry Ferreira\nProject Manager'

/** The Graph message, as /me/messages returns it. */
export const message = (over = {}) => ({
  id: 'phish-1', internetMessageId: '<phish-1@mail.example.com>', conversationId: 'conv-phish',
  subject: 'Request for Quotation',
  from: { emailAddress: { name: 'Terry Ferreira', address: RAW_FROM } },
  replyTo: [],
  hasAttachments: false,
  receivedDateTime: '2026-10-06T02:44:40Z',
  parentFolderId: 'junkemail-id',
  body: { contentType: 'text', content: BODY },
  internetMessageHeaders: [], webLink: 'https://outlook.office.com/phish-1', isDraft: false,
  ...over,
})

/** What the model actually answered for it (lead 8bfaffbe's stored reading). */
export const MODEL_REPLY = {
  category: 'quotation_request',
  confidence: 'medium',
  reason: 'They ask whether Arak can provide pricing for an upcoming project, but do not identify any products or scope.',
  summary: 'Wants to confirm Arak can quote for an upcoming project before sending the details.',
  details: { products: '', brands: '', quantity: '', location: '', stage: 'Upcoming project; stage not specified', urgency: '' },
  ask_next: [],
  sender_type: 'end_client', sender_confidence: 'medium',
  sender_evidence: 'Signature: "Project Manager"; the website identifies the organisation as a school specializing in Gestalt psychotherapy.',
  source_check: 'verified', source_evidence: 'The domain matches the organisation identified on its website.',
  project_type: 'not_stated', project_evidence: '', request_type: 'requirement', philips: 'none',
}
