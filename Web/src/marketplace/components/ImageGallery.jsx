import { useState } from 'react';

export function ImageGallery({ images = [], title }) {
  const [selected, setSelected] = useState(0);
  const current = images[selected] || images[0];
  return (
    <div className="image-gallery">
      {current?.url
        ? <img className="gallery-main" src={current.url} alt={title} width={current.width || 900} height={current.height || 700} />
        : <div className="image-placeholder gallery-main" role="img" aria-label={title}>🌱</div>}
      {images.length > 1 && <div className="gallery-thumbs">{images.map((image, index) => (
        <button type="button" aria-label={`Show image ${index + 1}`} aria-pressed={index === selected}
          onClick={() => setSelected(index)} key={`${image.url}-${index}`}>
          <img src={image.thumbUrl || image.url} alt="" loading="lazy" width="80" height="80" />
        </button>
      ))}</div>}
    </div>
  );
}
