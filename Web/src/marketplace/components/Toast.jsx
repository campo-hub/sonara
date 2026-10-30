export function Toast({ message }) {
  return <div className="toast" aria-live="polite" aria-atomic="true">{message}</div>;
}
