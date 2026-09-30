import { isSample } from '../api/index.js';

/** Shown only when the app is wired to the live backend but this section's endpoint isn't built yet. */
export default function SampleBadge({ feature }) {
  if (!isSample(feature)) return null;
  return <span className="chip warn" title="The backend doesn't serve this yet, so these numbers are made up.">Sample data</span>;
}
