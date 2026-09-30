// RMK branding: the college crest and the product name (top left of every page), and the copyright line
// shown at the bottom of every page.
export const PRODUCT = 'RMK Coding Board';
export const COLLEGE = 'R.M.K. Engineering College';

const asset = (name) => `${import.meta.env.BASE_URL}brand/${name}`;

export function Crest({ height = 56, className = '' }) {
  return (
    <img
      className={`crest ${className}`}
      src={asset('rmk-crest.png')}
      alt={`${COLLEGE} crest`}
      height={height}
      width={Math.round(height * 0.774)}
    />
  );
}

/** Top strip of every signed-in page: the college crest and the product name, on the left. */
export function BrandBar() {
  return (
    <div className="brandbar">
      <Crest />
      <div className="who-text">
        <b>{PRODUCT}</b>
        <span>{COLLEGE}</span>
      </div>
    </div>
  );
}

export function Footer({ floating = false }) {
  return (
    <footer className={`legal${floating ? ' floating' : ''}`}>
      &copy; {new Date().getFullYear()} {COLLEGE}
    </footer>
  );
}
