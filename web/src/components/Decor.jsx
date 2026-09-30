// Corner washes and the hand-drawn underline that give the board its look.
export function Blobs() {
  return (
    <>
      <svg className="blob tl" viewBox="0 0 230 200" aria-hidden="true">
        <path d="M0 0h230c-30 30-40 70-90 90S40 120 0 190z" fill="#c4e6d0" opacity=".7" />
        <path d="M0 0h150c-20 26-30 56-70 70S20 100 0 140z" fill="#8fcaa5" opacity=".75" />
      </svg>
      <svg className="blob br" viewBox="0 0 330 240" aria-hidden="true">
        <path d="M330 0c-10 60-70 70-120 110S130 200 60 240H330z" fill="#c4e6d0" opacity=".75" />
        <path d="M330 60c-20 50-60 60-100 100s-40 60-90 80H330z" fill="#8fcaa5" opacity=".8" />
      </svg>
    </>
  );
}

export function Scribble({ width = 300 }) {
  return (
    <svg className="scribble" viewBox="0 0 300 14" style={{ width }} preserveAspectRatio="none" aria-hidden="true">
      <path d="M3 9 C 40 3, 90 12, 140 7 S 240 4, 297 8" />
    </svg>
  );
}
