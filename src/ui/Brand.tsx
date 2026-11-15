/** The logo at the top left of every screen. Clicking it goes back to the home screen. */
export function Brand({ onHome, title }: { onHome: () => void; title?: string }) {
  return (
    <div className="brand">
      <button className="brand-home" onClick={onHome} title="Back to the home screen">
        <span className="brand-mark" aria-hidden="true" />
        Fretsense
      </button>
      {title && <span className="brand-title">{title}</span>}
    </div>
  );
}
