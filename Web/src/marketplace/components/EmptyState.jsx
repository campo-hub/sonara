export function EmptyState({ title, action }) {
  return <section className="empty-state" role="status"><p>{title}</p>{action}</section>;
}
