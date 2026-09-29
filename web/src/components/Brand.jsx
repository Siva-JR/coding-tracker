// RMK branding: the "31 years" mark (top left), the college crest and the product name, and the
// copyright line shown at the bottom of every page.
export const PRODUCT = 'RMK Coding Board';
export const COLLEGE = 'R.M.K. Engineering College';

const asset = (name) => `${import.meta.env.BASE_URL}brand/${name}`;

export function YearsMark({ className = '', height = 56 }) {
  return (
    <img
      className={`years-mark ${className}`}
      src={asset('rmk-31-years.png')}
      alt="31 years of academic excellence"
      height={height}
      width={Math.round(height * 0.868)}
    />
  );
}

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

/** Top strip of every signed-in page: 31-years mark on the left, crest and name on the right. */
export function BrandBar() {
  return (
    <div className="brandbar">
      <YearsMark />
      <div className="who">
        <div className="who-text">
          <b>{PRODUCT}</b>
          <span>{COLLEGE}</span>
        </div>
        <Crest />
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
