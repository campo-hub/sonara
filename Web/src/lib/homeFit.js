export function computeMixGridFit({ width, height, count, gap = 16, textHeight = 40, minCard = 120, maxCard = 190 }) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0 || count <= 0) {
    return { columns: 1, cardSize: minCard, fits: true };
  }

  const safeWidth = Math.max(width, 0);
  const safeHeight = Math.max(height, 0);
  let best = { columns: 1, cardSize: minCard, fits: true };

  for (let columns = 1; columns <= Math.min(count, 12); columns += 1) {
    const rows = Math.ceil(count / columns);
    const cardSize = Math.max(minCard, Math.min(maxCard, (safeHeight - textHeight - (rows - 1) * gap) / rows));
    const totalWidth = columns * cardSize + (columns - 1) * gap;
    const fits = totalWidth <= safeWidth;

    if (fits) {
      best = { columns, cardSize, fits: true };
    } else {
      const fallback = Math.max(minCard, (safeWidth - (columns - 1) * gap) / columns);
      best = { columns, cardSize: fallback, fits: false };
      break;
    }
  }

  return best;
}
