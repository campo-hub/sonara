export function computeMixGridFit({ width, count, gap = 16, minCard = 120, maxCard = 190 }) {
  if (!Number.isFinite(width) || width <= 0 || count <= 0) {
    return { columns: 1, cardSize: minCard, fits: true };
  }

  const safeWidth = Math.max(width, 0);
  const fittingColumns = Math.max(1, Math.floor((safeWidth + gap) / (minCard + gap)));
  const columns = Math.min(5, fittingColumns);
  const availableCardWidth = (safeWidth - (columns - 1) * gap) / columns;

  return {
    columns,
    cardSize: Math.min(maxCard, availableCardWidth),
    fits: true
  };
}
