import { app } from 'electron';
import path from 'path';
import { promises as fs } from 'fs';

/**
 * @typedef {import('../types.ts').IndexedImage} IndexedImage
 */

const FAVORITES_FILE_NAME = 'favorites.json';

/**
 * Returns the path to the favorites.json file.
 * @returns {string}
 */
function getFavoritesPath() {
  return path.join(app.getPath('userData'), FAVORITES_FILE_NAME);
}

/**
 * Reads the favorites from the JSON file.
 * If the file doesn't exist, it returns an empty array.
 * @returns {Promise<IndexedImage[]>}
 */
async function readFavorites() {
  const filePath = getFavoritesPath();
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []; // File doesn't exist, return empty array
    }
    console.error('Error reading favorites file:', error);
    throw error;
  }
}

/**
 * Writes the given favorites to the JSON file.
 * @param {IndexedImage[]} favorites
 */
async function writeFavorites(favorites) {
  const filePath = getFavoritesPath();
  try {
    await fs.writeFile(filePath, JSON.stringify(favorites, null, 2));
  } catch (error) {
    console.error('Error writing favorites file:', error);
    throw error;
  }
}

/**
 * Adds a new image to the favorites.
 * @param {IndexedImage} image
 * @returns {Promise<IndexedImage[]>} The updated list of favorites.
 */
async function addFavorite(image) {
  const favorites = await readFavorites();
  // Avoid duplicates
  if (!favorites.some((fav) => fav.id === image.id)) {
    favorites.push(image);
    await writeFavorites(favorites);
  }
  return favorites;
}

/**
 * Removes an image from the favorites.
 * @param {string} imageId
 * @returns {Promise<IndexedImage[]>} The updated list of favorites.
 */
async function removeFavorite(imageId) {
  let favorites = await readFavorites();
  const initialLength = favorites.length;
  favorites = favorites.filter((fav) => fav.id !== imageId);

  if (favorites.length < initialLength) {
    await writeFavorites(favorites);
  }
  return favorites;
}

export const favoritesManager = {
  getFavoritesPath,
  readFavorites,
  addFavorite,
  removeFavorite,
};
