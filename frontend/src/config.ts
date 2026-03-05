const isProduction = window.location.hostname !== 'localhost';

export const API_URL = isProduction
  ? '' // Same origin on Fly.io
  : 'http://localhost:8000';
