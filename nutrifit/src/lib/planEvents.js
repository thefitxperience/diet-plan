// How a plan_events row reads in a timeline.
//
// `actor` is nullable (009) and NULL means the system acted, not that a user is
// missing. Both logs used to render the actor as `profiles?.full_name || '—'`,
// so an automatic release printed as "— approved the plan for Rayne Milan":
// it looked like a data bug and gave no hint that no human had reviewed it.
//
// Two system events exist today, distinguished by action:
//   generated  — a client submitted the public intake form
//   submitted  — auto_approve_stale_plans() released a clean, stale plan
//
// Shared so the activity log and a plan's own history can't drift apart.

export const isSystemEvent = (ev) => !ev?.actor
export const isIntakeEvent = (ev) => isSystemEvent(ev) && ev.action === 'generated'
export const isAutoApproval = (ev) => isSystemEvent(ev) && ev.action === 'submitted'

/**
 * Describe one event for rendering.
 *
 * @returns {{kind: 'intake'|'auto'|'user', who: string, what: string, auto: boolean}}
 *   `kind` picks the layout; `auto` flags entries that should carry the badge.
 */
export function describeEvent(ev, { t, profileId }) {
  if (isIntakeEvent(ev)) {
    return { kind: 'intake', who: '', what: t('event.intake'), auto: false }
  }
  if (isAutoApproval(ev)) {
    return { kind: 'auto', who: t('event.system'), what: t('event.autoApproved'), auto: true }
  }
  const you = ev.actor && ev.actor === profileId
  return {
    kind: 'user',
    who: you ? t('event.you') : (ev.profiles?.full_name || t('event.unknownUser')),
    what: t(`${you ? 'eventYou' : 'event'}.${ev.action}`),
    auto: false,
  }
}
