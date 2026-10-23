/**
 * The person filter on the Appointments page and Today: the booking team (the
 * active logins, bookingTeamStore.ts), then, apart, names on appointments of
 * people no longer on the team ("Former team members"). Values are
 * bookingTeamModel.ts keys: '' everyone, 'u:<login id>', 'n:<name>'.
 */
import { memberKey, formerKey, type TeamMember } from './bookingTeamModel'

export default function PersonFilter({ team, former, value, onChange, everyoneFirst = false, className }: {
  team: TeamMember[]; former: string[]; value: string; onChange: (key: string) => void; everyoneFirst?: boolean; className?: string
}) {
  const everyone = <option value="">Everyone</option>
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={className} data-person-filter aria-label="Person">
      {everyoneFirst && everyone}
      {team.map(m => <option key={m.userId} value={memberKey(m)}>{m.name}</option>)}
      {!everyoneFirst && everyone}
      {former.length > 0 && (
        <optgroup label="Former team members" data-former-group>
          {former.map(n => <option key={n} value={formerKey(n)}>{n}</option>)}
        </optgroup>
      )}
    </select>
  )
}
