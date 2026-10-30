export function Skeletons({ count = 6 }) {
  return <div className="product-grid" role="status" aria-label="Loading products">
    {Array.from({ length: count }, (_, index) => <div className="skeleton-card" key={index} aria-hidden="true" />)}
  </div>;
}
