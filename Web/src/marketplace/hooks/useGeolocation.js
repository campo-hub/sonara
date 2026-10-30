import { useState } from 'react';

export function useGeolocation() {
  const [position, setPosition] = useState(null);
  const [error, setError] = useState('');
  const locate = () => {
    if (!navigator.geolocation) {
      setError('Location is not available in this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setPosition({ lat: Number(coords.latitude.toFixed(2)), lng: Number(coords.longitude.toFixed(2)) });
        setError('');
      },
      (reason) => setError(reason.message || 'Location permission was not granted.'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  };
  return { position, error, locate };
}
