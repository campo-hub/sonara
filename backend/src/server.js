import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

const catalog = [
  {
    id: '1',
    title: 'Midnight Drive',
    artist: 'Nova Echo',
    album: 'Afterglow',
    duration: 205,
    cover: 'https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=800&q=80',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'
  },
  {
    id: '2',
    title: 'Velvet Static',
    artist: 'Aster Vale',
    album: 'Night Bloom',
    duration: 248,
    cover: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?auto=format&fit=crop&w=800&q=80',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3'
  },
  {
    id: '3',
    title: 'Neon Horizon',
    artist: 'Prism Avenue',
    album: 'City Lights',
    duration: 222,
    cover: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=800&q=80',
    audioUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3'
  }
];

app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', service: 'sonara-backend' });
});

app.get('/api/catalog', (_, res) => {
  res.json({ songs: catalog });
});

app.get('/api/catalog/:id', (req, res) => {
  const song = catalog.find((item) => item.id === req.params.id);
  if (!song) {
    return res.status(404).json({ message: 'Song not found' });
  }
  return res.json(song);
});

app.get('/api/featured', (_, res) => {
  res.json({
    curated: [catalog[0], catalog[2]],
    trending: catalog,
    mood: 'Late-night glow'
  });
});

app.listen(port, () => {
  console.log(`Sonara backend running on http://localhost:${port}`);
});
