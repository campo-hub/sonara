export function ErrorMessage({ message }) {
  return message ? <p className="error-message" role="alert">{message}</p> : null;
}
